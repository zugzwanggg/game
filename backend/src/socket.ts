import type { Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import crypto from 'node:crypto'
import { verifyToken } from './auth/token.js'
import { AUTH_COOKIE_NAME, getAuthSecret } from './auth/middleware.js'
import { applyPlayerLeftRoom, deleteRoom, getRoom, tickRoomTimers, touchRoom } from './rooms/store.js'
import { clearSpectatorFlagsForMatchStart } from './rooms/spectators.js'
import type { RoomPlayer, RoomState } from './rooms/types.js'
import { normalizeGuess, pickRandomWord, toHint } from './games/drawing/words.js'
import { startMemeMatch } from './games/meme/engine.js'
import { sanitizeMemeGif } from './games/meme/sanitize.js'
import { castSpyVote, requestEarlyVote, spyGuess, startSpyMatch } from './games/spy/engine.js'
import {
  MAFIA_GHOST_CHAT,
  MAFIA_MAX,
  MAFIA_MIN,
  startMafiaMatch,
  tryDayVote,
  tryDetectiveInvestigate,
  tryDoctorSave,
  tryMafiaKillVote,
  tryDetectiveKill,
  requestMafiaDaySkip,
  requestNightSkip,
} from './games/mafia/engine.js'
import {
  getActiveLiarPlayerId,
  LIAR_MAX_PLAYERS,
  LIAR_MIN_PLAYERS,
  startLiarMatch,
  tryCallLiar,
  tryPlayCards,
} from './games/liar/engine.js'
import {
  MEMORY_MAX_PLAYERS,
  MEMORY_MIN_PLAYERS,
  startMemoryMatch,
  tryMemoryTap,
} from './games/memory/engine.js'
import {
  pickItemsForPlayerCount,
  pickMixedItemsForPlayerCount,
  startWhoAmIMatch,
  toItemInputsFromRows,
  tryWhoAmIGuess,
  WHOAMI_MAX_PLAYERS,
  WHOAMI_MIN_PLAYERS,
} from './games/whoami/engine.js'
import { fetchRandomGameItems } from './db/gameItems.js'
import type { WhoAmIItemInput } from './games/whoami/types.js'
import { whoAmILargeImageUrl } from './games/whoami/imageUrl.js'
import { getCorsOrigins } from './corsOrigins.js'

let io: Server | null = null

const startedTurnByRoom = new Map<string, string>()
const revealedTurnByRoom = new Map<string, string>()
const startedSpyByRoom = new Map<string, number>()
const startedMafiaByRoom = new Map<string, number>()
const startedLiarByRoom = new Map<string, number>()
const startedMemoryByRoom = new Map<string, number>()
const startedWhoAmIByRoom = new Map<string, number>()

function roomIsInActiveMatch(room: RoomState): boolean {
  switch (room.game) {
    case 'drawing':
      return Boolean(room.drawingGame && room.drawingGame.status !== 'lobby')
    case 'spy':
      return Boolean(room.spyGame && room.spyGame.status !== 'lobby')
    case 'mafia':
      return Boolean(room.mafiaGame && room.mafiaGame.status !== 'lobby')
    case 'liar':
      return Boolean(room.liarGame && room.liarGame.status !== 'lobby')
    case 'meme':
      return Boolean(room.memeGame && room.memeGame.status !== 'lobby')
    case 'memory':
      return Boolean(room.memoryGame && room.memoryGame.status !== 'lobby')
    case 'whoami':
      return Boolean(room.whoamiGame && room.whoamiGame.status !== 'lobby')
    default:
      return false
  }
}

function roomIsInLobby(room: RoomState): boolean {
  return !roomIsInActiveMatch(room)
}

function playerIsSpectator(room: RoomState | undefined, playerId: string | null | undefined): boolean {
  if (!room || !playerId) return false
  return room.players.some((p) => p.id === playerId && p.spectator)
}

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: getCorsOrigins(),
      methods: ['GET', 'POST'],
      credentials: true,
    },
  })

  /** Last player alone in an active match: cancel match, notify, delete room. */
  function dissolveRoomIfOnlyPlayerLeftDuringMatch(code: string): boolean {
    const room = getRoom(code)
    if (!room || room.players.length !== 1) return false
    if (!roomIsInActiveMatch(room)) return false
    const payload = {
      reason: 'everyone_left' as const,
      message: 'Everyone else left the game. The match was cancelled.',
    }
    for (const s of io!.sockets.sockets.values()) {
      if (!s.rooms?.has(code)) continue
      s.emit('room:match_abandoned', payload)
      void s.leave(code)
    }
    deleteRoom(code)
    startedTurnByRoom.delete(code)
    revealedTurnByRoom.delete(code)
    startedSpyByRoom.delete(code)
    startedMafiaByRoom.delete(code)
    startedLiarByRoom.delete(code)
    startedMemoryByRoom.delete(code)
    startedWhoAmIByRoom.delete(code)
    return true
  }

  function getCookie(header: string | undefined, name: string): string | null {
    if (!header) return null
    const parts = header.split(';')
    for (const part of parts) {
      const [k, ...rest] = part.trim().split('=')
      if (k === name) return decodeURIComponent(rest.join('=') ?? '')
    }
    return null
  }

  io.use((socket, next) => {
    const cookieHeader = socket.handshake.headers.cookie as string | undefined
    const cookieToken = getCookie(cookieHeader, AUTH_COOKIE_NAME)
    const authPayload = socket.handshake.auth as { token?: string } | undefined
    const authToken =
      typeof authPayload?.token === 'string' ? authPayload.token.trim() : ''
    const headerBearer = (socket.handshake.headers['authorization'] as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    )
    const raw =
      cookieToken ||
      headerBearer ||
      authToken ||
      null
    if (!raw) return next()
    const payload = verifyToken(String(raw), getAuthSecret())
    if (payload) {
      ; (socket.data as any).token = payload
        ; (socket.data as any).principal =
          payload.typ === 'user'
            ? { kind: 'user', id: payload.sub, displayName: payload.name }
            : { kind: 'guest', id: payload.sub, displayName: payload.name }
    }
    next()
  })

  io.on('connection', (socket) => {
    console.log('[socket] connected', socket.id)

    let joinedCode: string | null = null
    let joinedPlayerId: string | null = null

    const emitSpyRole = (room: any, targetPlayerId: string, sock: any, opts?: { force?: boolean }) => {
      const sg = room.spyGame
      if (!sg || room.game !== 'spy') return
      if (!sg.matchId || sg.status === 'lobby') return
      if (room.players?.some((pl: RoomPlayer) => pl.id === targetPlayerId && pl.spectator)) {
        sock.emit('game:spy:role', { role: 'spectator' })
        return
      }
      const last = (sock.data as any).lastSpyRoleMatchIdSent as number | undefined
      if (!opts?.force && last === sg.matchId) return
        ; (sock.data as any).lastSpyRoleMatchIdSent = sg.matchId
      if (sg.spyPlayerId && targetPlayerId === sg.spyPlayerId) {
        sock.emit('game:spy:role', { role: 'spy' })
      } else {
        sock.emit('game:spy:role', { role: 'agent', word: sg.word })
      }
    }

    const emitSpyRolesToRoom = (code: string, room: any) => {
      const sg = room.spyGame
      if (!sg || room.game !== 'spy') return
      if (!sg.matchId || sg.status === 'lobby') return
      for (const s of io!.sockets.sockets.values()) {
        if (!s.rooms?.has(code)) continue
        const pid = (s.data as any).playerId as string | undefined
        if (!pid) continue
        emitSpyRole(room, pid, s)
      }
    }

    const emitMafiaRole = (room: any, targetPlayerId: string, sock: any, opts?: { force?: boolean }) => {
      const g = room.mafiaGame
      if (!g || room.game !== 'mafia') return
      if (!g.matchId || g.status === 'lobby') return
      if (room.players?.some((pl: RoomPlayer) => pl.id === targetPlayerId && pl.spectator)) {
        sock.emit('game:mafia:role', { role: 'spectator' })
        return
      }
      const last = (sock.data as any).lastMafiaRoleMatchIdSent as number | undefined
      if (!opts?.force && last === g.matchId) return
        ; (sock.data as any).lastMafiaRoleMatchIdSent = g.matchId
      const role = g.roles[targetPlayerId]
      if (!role) {
        sock.emit('game:mafia:role', { role: null as null })
        return
      }
      if (role === 'mafia') {
        const teammateIds = Object.entries(g.roles)
          .filter(([id, r]) => r === 'mafia' && id !== targetPlayerId)
          .map(([id]) => id)
        sock.emit('game:mafia:role', { role: 'mafia' as const, teammateIds })
      } else {
        sock.emit('game:mafia:role', { role })
      }
    }

    const emitMafiaRolesToRoom = (code: string, room: any) => {
      const g = room.mafiaGame
      if (!g || room.game !== 'mafia') return
      if (!g.matchId || g.status === 'lobby') return
      for (const s of io!.sockets.sockets.values()) {
        if (!s.rooms?.has(code)) continue
        const pid = (s.data as any).playerId as string | undefined
        if (!pid) continue
        emitMafiaRole(room, pid, s)
      }
    }

    const emitWhoAmIView = (room: RoomState, sock: any, opts?: { force?: boolean }) => {
      const wg = room.whoamiGame
      if (!wg || wg.status === 'lobby' || room.game !== 'whoami' || !wg.matchId) return
      const pid = (sock.data as any).playerId as string | undefined
      if (!pid) return
      const last = (sock.data as any).lastWhoAmIMatchIdSent as number | undefined
      if (!opts?.force && last === wg.matchId) return
        ; (sock.data as any).lastWhoAmIMatchIdSent = wg.matchId

      const pl = room.players.find((p) => p.id === pid)
      const asg = wg.assignments

      const cardFor = (playerId: string) => {
        const a = asg[playerId]
        return a
          ? { playerId, name: a.name, imageUrl: whoAmILargeImageUrl(a.imageUrl) }
          : null
      }

      if (pl?.spectator) {
        const others = room.players
          .filter((p) => !p.spectator)
          .map((p) => cardFor(p.id))
          .filter(Boolean) as { playerId: string; name: string; imageUrl: string | null }[]
        sock.emit('game:whoami:view', { matchId: wg.matchId, mode: 'spectator' as const, others })
        return
      }

      const others = room.players
        .filter((p) => !p.spectator && p.id !== pid)
        .map((p) => cardFor(p.id))
        .filter(Boolean) as { playerId: string; name: string; imageUrl: string | null }[]

      sock.emit('game:whoami:view', { matchId: wg.matchId, mode: 'player' as const, others })
    }

    const emitWhoAmIViewsToRoom = (code: string, room: RoomState) => {
      const wg = room.whoamiGame
      if (!wg || wg.status === 'lobby' || room.game !== 'whoami') return
      for (const s of io!.sockets.sockets.values()) {
        if (!s.rooms?.has(code)) continue
        emitWhoAmIView(room, s)
      }
    }

    const emitRoomState = (code: string) => {
      const room = getRoom(code)
      if (!room) return
      tickRoomTimers(code)
      if (roomIsInLobby(room)) {
        for (const p of room.players) {
          if (p.spectator) p.spectator = false
        }
      }
      const now = Date.now()
      const dg = room.drawingGame
      if (room.game === 'drawing' && dg && dg.status !== 'lobby' && dg.matchRosterIds.length > 0) {
        const roster = new Set(dg.matchRosterIds)
        for (const p of room.players) {
          if (roster.has(p.id)) p.spectator = false
        }
      }
      const drawSecLeft =
        dg?.status === 'playing' && dg.endsAt
          ? Math.max(0, Math.ceil((dg.endsAt - now) / 1000))
          : dg?.status === 'lobby'
            ? 60
            : Math.max(0, Math.ceil((room.round.endsAt - now) / 1000))
      const revealSecLeft =
        dg?.status === 'reveal' && dg.revealEndsAt
          ? Math.max(0, Math.ceil((dg.revealEndsAt - now) / 1000))
          : room.round.phase === 'reveal' && room.round.revealEndsAt
            ? Math.max(0, Math.ceil((room.round.revealEndsAt - now) / 1000))
            : 0

      const mg = room.memeGame
      const memePhaseSecLeft =
        mg?.phaseEndsAt != null ? Math.max(0, Math.ceil((mg.phaseEndsAt - now) / 1000)) : 0
      const memeRevealSecLeft =
        mg?.revealEndsAt != null ? Math.max(0, Math.ceil((mg.revealEndsAt - now) / 1000)) : 0
      const memeLeaderboardSecLeft =
        mg?.leaderboardEndsAt != null
          ? Math.max(0, Math.ceil((mg.leaderboardEndsAt - now) / 1000))
          : 0
      const memeRoundBreakSecLeft =
        mg?.roundBreakEndsAt != null
          ? Math.max(0, Math.ceil((mg.roundBreakEndsAt - now) / 1000))
          : 0

      const sg = room.spyGame
      const spyDiscussionSecLeft =
        sg?.status === 'discussion' && sg.discussionEndsAt != null
          ? Math.max(0, Math.ceil((sg.discussionEndsAt - now) / 1000))
          : 0
      const spyVoteSecLeft =
        sg?.status === 'voting' && sg.votingEndsAt != null
          ? Math.max(0, Math.ceil((sg.votingEndsAt - now) / 1000))
          : 0
      const spyGuessSecLeft =
        sg?.status === 'spy_guess' && sg.spyGuessEndsAt != null
          ? Math.max(0, Math.ceil((sg.spyGuessEndsAt - now) / 1000))
          : 0

      const mfg = room.mafiaGame
      const mafiaNightSecLeft =
        mfg?.status === 'night' && mfg.nightEndsAt != null
          ? Math.max(0, Math.ceil((mfg.nightEndsAt - now) / 1000))
          : 0
      const mafiaDaySecLeft =
        mfg?.status === 'day' && mfg.dayEndsAt != null
          ? Math.max(0, Math.ceil((mfg.dayEndsAt - now) / 1000))
          : 0
      const mafiaVoteSecLeft =
        mfg?.status === 'voting' && mfg.voteEndsAt != null
          ? Math.max(0, Math.ceil((mfg.voteEndsAt - now) / 1000))
          : 0
      const mafiaResultsSecLeft =
        mfg?.status === 'results' && mfg.resultsEndsAt != null
          ? Math.max(0, Math.ceil((mfg.resultsEndsAt - now) / 1000))
          : 0

      const lg = room.liarGame
      const liarBluffSecLeft =
        lg?.phase === 'bluff' && lg.bluffEndsAt != null
          ? Math.max(0, Math.ceil((lg.bluffEndsAt - now) / 1000))
          : 0

      const memg = room.memoryGame
      const memoryPlaybackSecLeft =
        memg?.status === 'playback' && memg.phaseEndsAt != null
          ? Math.max(0, Math.ceil((memg.phaseEndsAt - now) / 1000))
          : 0
      const memoryInputSecLeft =
        memg?.status === 'input' && memg.inputEndsAt != null
          ? Math.max(0, Math.ceil((memg.inputEndsAt - now) / 1000))
          : 0
      const memoryCountdownSecLeft =
        memg?.status === 'countdown' && memg.phaseEndsAt != null
          ? Math.max(0, Math.ceil((memg.phaseEndsAt - now) / 1000))
          : 0

      const mafiaGamePublic =
        mfg && room.game === 'mafia'
          ? mfg.status === 'results'
            ? {
              matchId: mfg.matchId,
              round: mfg.round,
              status: mfg.status,
              alive: mfg.alive,
              phaseEndsAt: mfg.phaseEndsAt,
              resultsEndsAt: mfg.resultsEndsAt,
              winner: mfg.winner,
              lastAnnouncement: mfg.lastAnnouncement,
              roles: { ...mfg.roles },
            }
            : {
              matchId: mfg.matchId,
              round: mfg.round,
              status: mfg.status,
              alive: mfg.alive,
              phaseEndsAt: mfg.phaseEndsAt,
              nightEndsAt: mfg.nightEndsAt,
              dayEndsAt: mfg.dayEndsAt,
              voteEndsAt: mfg.voteEndsAt,
              resultsEndsAt: mfg.resultsEndsAt,
              winner: mfg.winner,
              lastAnnouncement: mfg.lastAnnouncement,
              mafiaKillVoteCount: Object.keys(mfg.mafiaKillVotes ?? {}).length,
              dayVoteCount: Object.keys(mfg.dayVotes ?? {}).length,
              daySkipYesCount: Object.keys(mfg.daySkipYes ?? {}).filter(
                (id) => mfg.daySkipYes[id] && mfg.alive[id],
              ).length,
              nightSkipYesCount: Object.keys(mfg.nightSkipYes ?? {}).filter(
                (id) => mfg.nightSkipYes[id] && mfg.alive[id],
              ).length,
              nightActorsRequiredCount: (() => {
                const mafiaAlive = Object.entries(mfg.roles).filter(
                  ([id, r]) => r === 'mafia' && mfg.alive[id],
                ).length
                const doc = Object.entries(mfg.roles).some(
                  ([id, r]) => r === 'doctor' && mfg.alive[id],
                )
                const det = Object.entries(mfg.roles).some(
                  ([id, r]) => r === 'detective' && mfg.alive[id],
                )
                return mafiaAlive + (doc ? 1 : 0) + (det ? 1 : 0)
              })(),
            }
          : undefined

      const liarGamePublic =
        lg && room.game === 'liar'
          ? {
            matchId: lg.matchId,
            status: lg.status,
            phase: lg.phase,
            round: lg.round,
            order: lg.order,
            turnIndex: lg.turnIndex,
            activePlayerId: lg.phase === 'turn' ? getActiveLiarPlayerId(lg) : null,
            declarerId: lg.lastPlay?.playerId ?? null,
            handSizes: Object.fromEntries(
              room.players.map((p) => [p.id, lg.hands[p.id]?.length ?? 0]),
            ),
            pileCardCount: lg.pile.reduce((a, s) => a + s.cards.length, 0),
            lastPlay: lg.lastPlay
              ? {
                playerId: lg.lastPlay.playerId,
                playedCount: lg.lastPlay.cards.length,
                claimedRank: lg.lastPlay.claimedRank,
                claimedCount: lg.lastPlay.claimedCount,
              }
              : null,
            bluffEndsAt: lg.bluffEndsAt,
            resolving: lg.resolving
              ? {
                accuserId: lg.resolving.accuserId,
                wasLying: lg.resolving.wasLying,
                shooterId: lg.resolving.shooterId,
                revealedCards: lg.resolving.revealedCards,
                claimedRank: lg.resolving.claimedRank,
                claimedCount: lg.resolving.claimedCount,
                endsAt: lg.resolving.endsAt,
              }
              : null,
            shotResult: lg.shotResult,
            revolvers: Object.fromEntries(
              Object.entries(lg.revolvers).map(([id, r]) => [
                id,
                {
                  pullCount: r.pullCount,
                  eliminated: r.eliminated,
                  immune: r.immune,
                  pullHistory: [...r.pullHistory],
                },
              ]),
            ),
            stats: { ...lg.stats },
            winnerId: lg.winnerId,
            log: lg.log.slice(-80),
          }
          : undefined

      const memoryGamePublic =
        memg && room.game === 'memory'
          ? {
            status: memg.status,
            matchId: memg.matchId,
            countdownReason: memg.countdownReason,
            round: memg.round,
            sequenceLength: memg.sequence.length,
            alive: { ...memg.alive },
            highlightTile: memg.status === 'playback' ? memg.highlightTile : null,
            phaseEndsAt: memg.phaseEndsAt,
            inputEndsAt: memg.inputEndsAt,
            inputProgress: { ...memg.inputProgress },
            winnerId: memg.winnerId,
            lastEliminatedPlayerId: memg.lastEliminatedPlayerId,
          }
          : undefined

      const wmg = room.whoamiGame
      const whoamiGamePublic =
        wmg && room.game === 'whoami'
          ? {
            status: wmg.status,
            matchId: wmg.matchId,
            categoryFilter: wmg.categoryFilter,
            difficultyFilter: wmg.difficultyFilter,
            solved: { ...wmg.solved },
          }
          : undefined

      const roomStateBase = {
        code: room.code,
        game: room.game,
        createdByUserId: room.createdByUserId,
        players: room.players,
        drawing: { strokes: room.drawing.strokes },
        chat: room.chat.slice(-100),
        round: room.round,
        memeGame: mg,
        mafiaGame: mafiaGamePublic,
        liarGame: liarGamePublic,
        memoryGame: memoryGamePublic,
        whoamiGame: whoamiGamePublic,
        spyGame: sg
          ? sg.status === 'reveal'
            ? {
              status: sg.status,
              matchId: sg.matchId,
              // reveal payload
              revealedSpyPlayerId: sg.revealedSpyPlayerId,
              revealedWord: sg.revealedWord,
              winner: sg.winner,
              selectedPlayerId: sg.selectedPlayerId,
              tie: sg.tie,
              spyGuessedCorrectly: sg.spyGuessedCorrectly,
              votes: sg.votes,
            }
            : {
              status: sg.status,
              matchId: sg.matchId,
              discussionEndsAt: sg.discussionEndsAt,
              votingEndsAt: sg.votingEndsAt,
              spyGuessEndsAt: sg.spyGuessEndsAt,
              earlyVoteYesCount: Object.keys(sg.earlyVoteYes ?? {}).length,
              voteCount: Object.keys(sg.votes ?? {}).length,
            }
          : undefined,
        drawingGame: dg
          ? {
            status: dg.status,
            matchId: dg.matchId,
            matchRound: dg.matchRound,
            turnIndex: dg.turnIndex,
            orderSize: dg.order.length,
            drawerPlayerId: dg.drawerPlayerId,
            wordHint: dg.wordHint,
            endsAt: dg.endsAt,
            revealEndsAt: dg.revealEndsAt,
            leaderboardEndsAt: dg.leaderboardEndsAt,
            solvedByPlayerId: dg.solvedByPlayerId,
            scores: dg.scores,
          }
          : undefined,
        timers: {
          drawSecLeft,
          revealSecLeft,
          memePhaseSecLeft,
          memeRevealSecLeft,
          memeLeaderboardSecLeft,
          memeRoundBreakSecLeft,
          spyDiscussionSecLeft,
          spyVoteSecLeft,
          spyGuessSecLeft,
          mafiaNightSecLeft,
          mafiaDaySecLeft,
          mafiaVoteSecLeft,
          mafiaResultsSecLeft,
          liarBluffSecLeft,
          memoryPlaybackSecLeft,
          memoryInputSecLeft,
          memoryCountdownSecLeft,
        },
      }

      const roomSockets = io!.sockets.adapter.rooms.get(code)
      if (roomSockets && roomSockets.size > 0) {
        for (const socketId of roomSockets) {
          const s = io!.sockets.sockets.get(socketId)
          if (!s) continue
          const pid = (s.data as any).playerId as string | undefined
          s.emit('room:state', { ...roomStateBase, youPlayerId: pid ?? null })
        }
      } else {
        io!.to(code).emit('room:state', { ...roomStateBase, youPlayerId: null })
      }

      // Mafia: detective learns investigation result at dawn (private, not in room state).
      if (room.game === 'mafia' && room.mafiaGame?.pendingDetectiveReveal) {
        const pr = room.mafiaGame.pendingDetectiveReveal
        for (const s of io!.sockets.sockets.values()) {
          if (!s.rooms?.has(code)) continue
          const pid = (s.data as any).playerId as string | undefined
          if (pid !== pr.detectiveId) continue
          s.emit('game:mafia:investigate_reveal', {
            targetPlayerId: pr.targetId,
            role: pr.role,
          })
        }
        room.mafiaGame.pendingDetectiveReveal = null
      }

      // Broadcast transitions and deliver secret word to drawer.
      if (room.game === 'drawing' && dg) {
        if (dg.status === 'playing') {
          const turnKey = `${dg.matchId}-${dg.matchRound}-${dg.turnIndex}`
          const lastStarted = startedTurnByRoom.get(code)
          if (lastStarted !== turnKey) {
            startedTurnByRoom.set(code, turnKey)
            io!.to(code).emit('game:drawing:started', { code, game: 'drawing' as const })
          }
          // Send the word only to drawer sockets (once per round per socket).
          if (dg.drawerPlayerId && dg.word) {
            for (const s of io!.sockets.sockets.values()) {
              if (!s.rooms?.has(code)) continue
              const pid = (s.data as any).playerId as string | undefined
              if (pid !== dg.drawerPlayerId) continue
              const lastWordTurn = (s.data as any).lastWordTurnSent as string | undefined
              if (lastWordTurn === turnKey) continue
                ; (s.data as any).lastWordTurnSent = turnKey
              s.emit('game:drawing:word', { word: dg.word })
            }
          }
        } else if (dg.status === 'reveal' && dg.word) {
          const turnKey = `${dg.matchId}-${dg.matchRound}-${dg.turnIndex}`
          const lastRevealed = revealedTurnByRoom.get(code)
          if (lastRevealed !== turnKey) {
            revealedTurnByRoom.set(code, turnKey)
            io!.to(code).emit('game:drawing:reveal', { word: dg.word })
          }
        }
      }

      if (room.game === 'spy' && sg && sg.status !== 'lobby') {
        const last = startedSpyByRoom.get(code) ?? 0
        if (sg.matchId !== last) {
          startedSpyByRoom.set(code, sg.matchId)
          io!.to(code).emit('game:spy:started', { code, game: 'spy' as const })
        }
        // Private role delivery (safe to attempt every tick; per-socket dedup).
        emitSpyRolesToRoom(code, room as any)
      }

      if (room.game === 'mafia' && mfg && mfg.status !== 'lobby') {
        const last = startedMafiaByRoom.get(code) ?? 0
        if (mfg.matchId !== last) {
          startedMafiaByRoom.set(code, mfg.matchId)
          io!.to(code).emit('game:mafia:started', { code, game: 'mafia' as const })
        }
        emitMafiaRolesToRoom(code, room as any)
      }

      if (room.game === 'liar' && lg && lg.status !== 'lobby') {
        const last = startedLiarByRoom.get(code) ?? 0
        if (lg.matchId !== last) {
          startedLiarByRoom.set(code, lg.matchId)
          io!.to(code).emit('game:liar:started', { code, game: 'liar' as const })
        }
        for (const s of io!.sockets.sockets.values()) {
          if (!s.rooms?.has(code)) continue
          const pid = (s.data as any).playerId as string | undefined
          if (!pid) continue
          s.emit('game:liar:hand', { cards: lg.hands[pid] ?? [] })
        }
      }

      if (room.game === 'memory' && memg && memg.status !== 'lobby') {
        const last = startedMemoryByRoom.get(code) ?? 0
        if (memg.matchId !== last) {
          startedMemoryByRoom.set(code, memg.matchId)
          io!.to(code).emit('game:memory:started', { code, game: 'memory' as const })
        }
      }

      if (room.game === 'whoami' && wmg && wmg.status !== 'lobby') {
        const last = startedWhoAmIByRoom.get(code) ?? 0
        if (wmg.matchId !== last) {
          startedWhoAmIByRoom.set(code, wmg.matchId)
          io!.to(code).emit('game:whoami:started', { code, game: 'whoami' as const })
        }
        emitWhoAmIViewsToRoom(code, room)
      }

      if (room.game === 'mafia' && mfg && mfg.status === 'night') {
        const docId = Object.entries(mfg.roles).find(([, r]) => r === 'doctor')?.[0]
        if (docId && mfg.alive[docId]) {
          const cannotProtectPlayerId = mfg.doctorPreviousNightProtectTarget ?? null
          for (const s of io!.sockets.sockets.values()) {
            if (!s.rooms?.has(code)) continue
            const pid = (s.data as any).playerId as string | undefined
            if (pid !== docId) continue
            s.emit('game:mafia:doctor_restriction', { cannotProtectPlayerId })
          }
        }
      }
    }

    socket.on(
      'room:join',
      (payload: { code?: string; nickname?: string }, cb?: (res: any) => void) => {
        const code = String(payload?.code ?? '')
          .trim()
          .toUpperCase()
        const room = getRoom(code)
        if (!room) {
          cb?.({ ok: false, error: 'room_not_found' })
          return
        }

        const principal = (socket.data as any).principal as
          | { kind: 'user' | 'guest'; id: string; displayName?: string }
          | undefined

        const displayName =
          String(payload?.nickname ?? '').trim().slice(0, 20) ||
          principal?.displayName ||
          `Guest-${crypto.randomInt(1000, 9999)}`

        const playerId = principal?.id ?? crypto.randomUUID()
        const existing = room.players.find((p) => p.id === playerId)
        const dgJoin = room.drawingGame
        const inDrawingMatchRoster =
          room.game === 'drawing' &&
          dgJoin &&
          dgJoin.status !== 'lobby' &&
          dgJoin.matchRosterIds.length > 0 &&
          dgJoin.matchRosterIds.includes(playerId)
        // Match roster members are never spectators (reconnect / duplicate join must clear stale flag).
        const spectator = inDrawingMatchRoster
          ? false
          : existing
            ? Boolean(existing.spectator)
            : roomIsInActiveMatch(room)
        const player: RoomPlayer = {
          id: playerId,
          kind: principal?.kind === 'user' ? 'user' : 'guest',
          displayName,
          joinedAt: existing?.joinedAt ?? Date.now(),
          spectator,
        }

        // upsert by id
        room.players = [
          ...room.players.filter((p) => p.id !== playerId),
          player,
        ]
        touchRoom(code)

        joinedCode = code
        joinedPlayerId = playerId
          ; (socket.data as any).playerId = playerId

        void socket.join(code)
        cb?.({ ok: true, room: { code, game: room.game }, player })
        emitRoomState(code)

        if (!player.spectator) {
          // If a drawing round is already running, make sure the drawer receives the word
          // even if they missed the initial event (e.g. navigated after start).
          if (
            room.game === 'drawing' &&
            room.drawingGame &&
            room.drawingGame.status !== 'lobby' &&
            room.drawingGame.drawerPlayerId === playerId &&
            room.drawingGame.word
          ) {
            socket.emit('game:drawing:word', { word: room.drawingGame.word })
          }
          // If the round is in reveal, ensure late joiners see the revealed word too.
          if (
            room.game === 'drawing' &&
            room.drawingGame &&
            room.drawingGame.status === 'reveal' &&
            room.drawingGame.word
          ) {
            socket.emit('game:drawing:reveal', { word: room.drawingGame.word })
          }

          // If Spy match is running, deliver private role info to the joining player.
          if (
            room.game === 'spy' &&
            room.spyGame &&
            room.spyGame.status !== 'lobby' &&
            room.spyGame.matchId
          ) {
            emitSpyRole(room as any, playerId, socket as any)
          }

          if (
            room.game === 'mafia' &&
            room.mafiaGame &&
            room.mafiaGame.status !== 'lobby' &&
            room.mafiaGame.matchId
          ) {
            emitMafiaRole(room as any, playerId, socket as any)
          }

          if (
            room.game === 'liar' &&
            room.liarGame &&
            room.liarGame.status !== 'lobby'
          ) {
            socket.emit('game:liar:hand', { cards: room.liarGame.hands[playerId] ?? [] })
          }
        }

        if (
          room.game === 'whoami' &&
          room.whoamiGame &&
          room.whoamiGame.status !== 'lobby' &&
          room.whoamiGame.matchId
        ) {
          emitWhoAmIView(room, socket as any, { force: true })
        }
      },
    )

    socket.on('game:drawing:start', () => {
      if (!joinedCode) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'drawing' || !room.drawingGame) return

      // Only the room creator (authenticated user) can start.
      const principal = (socket.data as any).principal as { kind: 'user' | 'guest'; id: string } | undefined
      if (!principal || principal.kind !== 'user' || principal.id !== room.createdByUserId) return

      const players = [...room.players].sort((a, b) => a.joinedAt - b.joinedAt)
      if (players.length < 2) return

      clearSpectatorFlagsForMatchStart(room)

      const g = room.drawingGame
      // Start / restart the match from round 1.
      g.matchId += 1
      g.status = 'playing'
      g.matchRound = 1
      g.turnIndex = 0
      g.order = players.map((p) => p.id)
      g.matchRosterIds = [...g.order]
      g.scores = {}
      for (const id of g.order) {
        g.scores[id] = 0
      }
      const drawerPlayerId = g.order[0]!
      g.drawerPlayerId = drawerPlayerId

      const word = pickRandomWord()
      const now = Date.now()
      g.word = word
      g.wordHint = toHint(word)
      g.endsAt = now + 60_000
      g.revealEndsAt = null
      g.leaderboardEndsAt = null
      g.solvedByPlayerId = null
      room.drawing.strokes = []
      room.chat = []
      touchRoom(joinedCode)

      io!.to(joinedCode).emit('drawing:clear')
      io!.to(joinedCode).emit('chat:clear')

      // Send the word only to the drawer socket(s).
      for (const s of io!.sockets.sockets.values()) {
        const pid = (s.data as any).playerId as string | undefined
        if (!pid || pid !== drawerPlayerId) continue
        if (!(s.rooms?.has(joinedCode))) continue
        s.emit('game:drawing:word', { word })
      }

      emitRoomState(joinedCode)
    })

    socket.on('game:meme:start', () => {
      if (!joinedCode) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'meme' || !room.memeGame) return
      const principal = (socket.data as any).principal as
        | { kind: 'user' | 'guest'; id: string }
        | undefined
      if (!principal || principal.kind !== 'user' || principal.id !== room.createdByUserId) return
      if (room.players.length < 2) return
      startMemeMatch(room, Date.now())
      touchRoom(joinedCode)
      io!.to(joinedCode).emit('game:meme:started', { code: joinedCode, game: 'meme' as const })
      emitRoomState(joinedCode)
    })

    socket.on('game:spy:start', () => {
      if (!joinedCode) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'spy' || !room.spyGame) return
      const principal = (socket.data as any).principal as
        | { kind: 'user' | 'guest'; id: string }
        | undefined
      if (!principal || principal.kind !== 'user' || principal.id !== room.createdByUserId) return
      if (room.players.length < 3 || room.players.length > 10) return
      room.chat = []
      startSpyMatch(room, Date.now())
      touchRoom(joinedCode)
      io!.to(joinedCode).emit('chat:clear')
      emitSpyRolesToRoom(joinedCode, room as any)
      io!.to(joinedCode).emit('game:spy:started', { code: joinedCode, game: 'spy' as const })
      emitRoomState(joinedCode)
    })

    socket.on('game:spy:request_vote', () => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'spy' || !room.spyGame) return
      if (playerIsSpectator(room, joinedPlayerId)) return
      const already = Boolean(room.spyGame.earlyVoteYes?.[joinedPlayerId])
      requestEarlyVote(room, room.spyGame, joinedPlayerId, Date.now())
      if (!already) {
        const caller = room.players.find((p) => p.id === joinedPlayerId)
        const name = caller?.displayName ?? 'Player'
        const active = room.players.filter((p) => !p.spectator)
        const yes = active.filter((p) => room.spyGame!.earlyVoteYes?.[p.id]).length
        const total = active.length
        io!.to(joinedCode).emit('chat:message', {
          id: crypto.randomUUID(),
          author: 'Game',
          text: `${name} called a vote (${yes}/${total})`,
          ts: Date.now(),
          variant: 'system',
        })
      }
      touchRoom(joinedCode)
      emitRoomState(joinedCode)
    })

    socket.on('game:spy:vote', (payload: { targetPlayerId?: string }) => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'spy' || !room.spyGame) return
      if (playerIsSpectator(room, joinedPlayerId)) return
      const target = String(payload?.targetPlayerId ?? '').trim()
      if (!target) return
      castSpyVote(room, room.spyGame, joinedPlayerId, target, Date.now())
      touchRoom(joinedCode)
      emitRoomState(joinedCode)
    })

    socket.on('game:spy:guess', (payload: { guess?: string }) => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'spy' || !room.spyGame) return
      if (playerIsSpectator(room, joinedPlayerId)) return
      const guess = String(payload?.guess ?? '').trim().slice(0, 60)
      if (!guess) return
      spyGuess(room, room.spyGame, joinedPlayerId, guess)
      touchRoom(joinedCode)
      emitRoomState(joinedCode)
    })

    socket.on('game:spy:role:request', () => {
      if (!joinedCode) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'spy' || !room.spyGame) return
      if (room.spyGame.status === 'lobby') return
      const pid = joinedPlayerId ?? ((socket.data as any).playerId as string | undefined)
      if (!pid) return
      emitSpyRole(room as any, pid, socket as any, { force: true })
    })

    socket.on('game:liar:start', () => {
      if (!joinedCode) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'liar' || !room.liarGame) return
      const principal = (socket.data as any).principal as
        | { kind: 'user' | 'guest'; id: string }
        | undefined
      if (!principal || principal.kind !== 'user' || principal.id !== room.createdByUserId) return
      if (room.players.length < LIAR_MIN_PLAYERS || room.players.length > LIAR_MAX_PLAYERS) return
      room.chat = []
      startLiarMatch(room, Date.now())
      touchRoom(joinedCode)
      io!.to(joinedCode).emit('chat:clear')
      io!.to(joinedCode).emit('game:liar:started', { code: joinedCode, game: 'liar' as const })
      emitRoomState(joinedCode)
    })

    socket.on('game:memory:start', () => {
      if (!joinedCode) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'memory' || !room.memoryGame) return
      const principal = (socket.data as any).principal as
        | { kind: 'user' | 'guest'; id: string }
        | undefined
      if (!principal || principal.kind !== 'user' || principal.id !== room.createdByUserId) return
      if (room.players.length < MEMORY_MIN_PLAYERS || room.players.length > MEMORY_MAX_PLAYERS) return
      room.chat = []
      if (!startMemoryMatch(room, Date.now())) return
      touchRoom(joinedCode)
      io!.to(joinedCode).emit('chat:clear')
      io!.to(joinedCode).emit('game:memory:started', { code: joinedCode, game: 'memory' as const })
      emitRoomState(joinedCode)
    })

    socket.on('game:memory:tap', (payload: { tileIndex?: number }) => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'memory' || !room.memoryGame) return
      if (playerIsSpectator(room, joinedPlayerId)) return
      const tileIndex = Number(payload?.tileIndex)
      if (!Number.isFinite(tileIndex)) return
      if (tryMemoryTap(room, joinedPlayerId, Math.floor(tileIndex), Date.now())) {
        touchRoom(joinedCode)
        emitRoomState(joinedCode)
      }
    })

    socket.on('game:whoami:set_config', (payload: { category?: string; difficulty?: string }) => {
      if (!joinedCode) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'whoami' || !room.whoamiGame) return
      if (room.whoamiGame.status !== 'lobby') return
      const principal = (socket.data as any).principal as
        | { kind: 'user' | 'guest'; id: string }
        | undefined
      if (!principal || principal.kind !== 'user' || principal.id !== room.createdByUserId) return
      let changed = false
      const c = String(payload?.category ?? '').trim()
      if (c === 'person' || c === 'character' || c === 'mixed') {
        room.whoamiGame.categoryFilter = c
        changed = true
      }
      const d = String(payload?.difficulty ?? '').trim()
      if (d === 'easy' || d === 'medium' || d === 'hard' || d === 'any') {
        room.whoamiGame.difficultyFilter = d
        changed = true
      }
      if (!changed) return
      touchRoom(joinedCode)
      emitRoomState(joinedCode)
    })

    socket.on('game:whoami:enter_play', () => {
      if (!joinedCode) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'whoami') return
      const principal = (socket.data as any).principal as
        | { kind: 'user' | 'guest'; id: string }
        | undefined
      if (!principal || principal.kind !== 'user' || principal.id !== room.createdByUserId) return
      touchRoom(joinedCode)
      io!.to(joinedCode).emit('game:whoami:enter_play', { code: joinedCode })
    })

    socket.on('game:whoami:start', () => {
      if (!joinedCode) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'whoami' || !room.whoamiGame) return
      const principal = (socket.data as any).principal as
        | { kind: 'user' | 'guest'; id: string }
        | undefined
      if (!principal || principal.kind !== 'user' || principal.id !== room.createdByUserId) return
      if (
        room.players.length < WHOAMI_MIN_PLAYERS ||
        room.players.length > WHOAMI_MAX_PLAYERS
      )
        return
      const itemType = room.whoamiGame.categoryFilter
      if (itemType !== 'character' && itemType !== 'person' && itemType !== 'mixed') return

      void (async () => {
        const code = joinedCode!
        const r = getRoom(code)
        if (!r || r.game !== 'whoami' || !r.whoamiGame) return
        const filter = r.whoamiGame.categoryFilter
        if (filter !== 'character' && filter !== 'person' && filter !== 'mixed') return
        const difficulty = 'any' as const
        let picked: WhoAmIItemInput[] = []
        try {
          if (filter === 'mixed') {
            const [chars, people] = await Promise.all([
              fetchRandomGameItems(200, 'character', difficulty),
              fetchRandomGameItems(200, 'person', difficulty),
            ])
            const fromDb = toItemInputsFromRows([...chars, ...people])
            picked = pickMixedItemsForPlayerCount(fromDb, r.players.length, difficulty)
          } else {
            const dbRows = await fetchRandomGameItems(200, filter, difficulty)
            const fromDb = toItemInputsFromRows(dbRows)
            picked = pickItemsForPlayerCount(fromDb, r.players.length, filter, difficulty)
          }
        } catch {
          picked = []
        }
        r.chat = []
        if (!startWhoAmIMatch(r, Date.now(), picked)) return
        touchRoom(code)
        io!.to(code).emit('chat:clear')
        emitRoomState(code)
      })()
    })

    socket.on('game:whoami:guess', (payload: { guess?: string }, ack?: (r: { ok: boolean; correct?: boolean }) => void) => {
      const reply = (r: { ok: boolean; correct?: boolean }) => {
        if (typeof ack === 'function') ack(r)
      }
      if (!joinedCode || !joinedPlayerId) {
        reply({ ok: false })
        return
      }
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'whoami' || !room.whoamiGame) {
        reply({ ok: false })
        return
      }
      if (playerIsSpectator(room, joinedPlayerId)) {
        reply({ ok: false })
        return
      }
      const guess = String(payload?.guess ?? '').trim()
      const res = tryWhoAmIGuess(room, joinedPlayerId, guess, Date.now())
      reply({ ok: res.ok, correct: res.correct === true })
      if (!res.ok) return
      if (res.correct) {
        touchRoom(joinedCode)
        emitRoomState(joinedCode)
      }
    })

    socket.on('game:whoami:view:request', () => {
      if (!joinedCode) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'whoami' || !room.whoamiGame) return
      if (room.whoamiGame.status === 'lobby') return
      const pid = joinedPlayerId ?? ((socket.data as any).playerId as string | undefined)
      if (!pid) return
      emitWhoAmIView(room, socket as any, { force: true })
    })

    socket.on(
      'game:liar:play',
      (payload: { cardIds?: string[]; claimedRank?: string; claimedCount?: number }) => {
        if (!joinedCode || !joinedPlayerId) return
        const room = getRoom(joinedCode)
        if (!room || room.game !== 'liar' || !room.liarGame) return
        if (playerIsSpectator(room, joinedPlayerId)) return
        const ids = Array.isArray(payload?.cardIds) ? payload!.cardIds!.map((x) => String(x)) : []
        const claimedRank = String(payload?.claimedRank ?? '')
        const claimedCount = Number(payload?.claimedCount)
        if (tryPlayCards(room, joinedPlayerId, ids, claimedRank, claimedCount, Date.now())) {
          touchRoom(joinedCode)
          emitRoomState(joinedCode)
        }
      },
    )

    socket.on('game:liar:call_liar', () => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'liar' || !room.liarGame) return
      if (playerIsSpectator(room, joinedPlayerId)) return
      if (tryCallLiar(room, joinedPlayerId, Date.now())) {
        touchRoom(joinedCode)
        emitRoomState(joinedCode)
      }
    })

    socket.on('game:mafia:start', () => {
      if (!joinedCode) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'mafia' || !room.mafiaGame) return
      const principal = (socket.data as any).principal as
        | { kind: 'user' | 'guest'; id: string }
        | undefined
      if (!principal || principal.kind !== 'user' || principal.id !== room.createdByUserId) return
      if (room.players.length < MAFIA_MIN || room.players.length > MAFIA_MAX) return
      room.chat = []
      startMafiaMatch(room, Date.now())
      touchRoom(joinedCode)
      io!.to(joinedCode).emit('chat:clear')
      emitMafiaRolesToRoom(joinedCode, room as any)
      io!.to(joinedCode).emit('game:mafia:started', { code: joinedCode, game: 'mafia' as const })
      emitRoomState(joinedCode)
    })

    socket.on('game:mafia:day_skip', () => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'mafia' || !room.mafiaGame) return
      if (playerIsSpectator(room, joinedPlayerId)) return
      const g = room.mafiaGame
      if (g.status !== 'day') return
      if (g.daySkipYes[joinedPlayerId]) return
      const aliveCount = Object.keys(g.alive).filter((id) => g.alive[id]).length
      const caller = room.players.find((p) => p.id === joinedPlayerId)
      const name = caller?.displayName ?? 'Player'
      requestMafiaDaySkip(room, joinedPlayerId, Date.now())
      const g2 = room.mafiaGame!
      if (g2.status === 'voting') {
        io!.to(joinedCode).emit('chat:message', {
          id: crypto.randomUUID(),
          author: 'Game',
          text: `${name} asked to skip — voting begins (majority ready).`,
          ts: Date.now(),
          variant: 'system',
        })
      } else {
        const yes = Object.keys(g2.daySkipYes).filter((id) => g2.daySkipYes[id] && g2.alive[id]).length
        io!.to(joinedCode).emit('chat:message', {
          id: crypto.randomUUID(),
          author: 'Game',
          text: `${name} asked to skip to vote (${yes}/${aliveCount})`,
          ts: Date.now(),
          variant: 'system',
        })
      }
      touchRoom(joinedCode)
      emitRoomState(joinedCode)
    })

    socket.on('game:mafia:kill_vote', (payload: { targetPlayerId?: string }) => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'mafia' || !room.mafiaGame) return
      if (playerIsSpectator(room, joinedPlayerId)) return
      const target = String(payload?.targetPlayerId ?? '').trim()
      if (!target) return
      if (tryMafiaKillVote(room, joinedPlayerId, target)) {
        touchRoom(joinedCode)
        emitRoomState(joinedCode)
      }
    })

    socket.on('game:mafia:night_skip', () => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'mafia' || !room.mafiaGame) return
      if (playerIsSpectator(room, joinedPlayerId)) return
      const ok = requestNightSkip(room, joinedPlayerId, Date.now())
      if (!ok) return
      const g2 = room.mafiaGame!
      // Do not reveal names or faction counts in public chat; only announce when the phase changes.
      if (g2.status === 'day') {
        io!.to(joinedCode).emit('chat:message', {
          id: crypto.randomUUID(),
          author: 'Game',
          text: 'Morning comes — the night ended early.',
          ts: Date.now(),
          variant: 'system',
        })
      } else if (g2.status === 'results') {
        io!.to(joinedCode).emit('chat:message', {
          id: crypto.randomUUID(),
          author: 'Game',
          text: 'The night ends.',
          ts: Date.now(),
          variant: 'system',
        })
      }
      touchRoom(joinedCode)
      emitRoomState(joinedCode)
    })

    socket.on('game:mafia:doctor_save', (payload: { targetPlayerId?: string }) => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'mafia' || !room.mafiaGame) return
      if (playerIsSpectator(room, joinedPlayerId)) return
      const target = String(payload?.targetPlayerId ?? '').trim()
      if (!target) return
      if (tryDoctorSave(room, joinedPlayerId, target)) {
        socket.emit('game:mafia:doctor_save_ack', { targetPlayerId: target })
        touchRoom(joinedCode)
        emitRoomState(joinedCode)
      }
    })

    socket.on('game:mafia:detective_investigate', (payload: { targetPlayerId?: string }) => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'mafia' || !room.mafiaGame) return
      if (playerIsSpectator(room, joinedPlayerId)) return
      const target = String(payload?.targetPlayerId ?? '').trim()
      if (!target) return
      const res = tryDetectiveInvestigate(room, joinedPlayerId, target)
      if (res.ok) {
        socket.emit('game:mafia:detective_check_ack', { targetPlayerId: target })
        touchRoom(joinedCode)
        emitRoomState(joinedCode)
      }
    })

    socket.on('game:mafia:detective_kill', (payload: { targetPlayerId?: string }) => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'mafia' || !room.mafiaGame) return
      if (playerIsSpectator(room, joinedPlayerId)) return
      const target = String(payload?.targetPlayerId ?? '').trim()
      if (!target) return
      if (tryDetectiveKill(room, joinedPlayerId, target)) {
        socket.emit('game:mafia:detective_kill_ack', { targetPlayerId: target })
        touchRoom(joinedCode)
        emitRoomState(joinedCode)
      }
    })

    socket.on('game:mafia:day_vote', (payload: { targetPlayerId?: string }) => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'mafia' || !room.mafiaGame) return
      if (playerIsSpectator(room, joinedPlayerId)) return
      const target = String(payload?.targetPlayerId ?? '').trim()
      if (!target) return
      if (tryDayVote(room, joinedPlayerId, target)) {
        touchRoom(joinedCode)
        emitRoomState(joinedCode)
      }
    })

    socket.on('game:mafia:role:request', () => {
      if (!joinedCode) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'mafia' || !room.mafiaGame) return
      if (room.mafiaGame.status === 'lobby') return
      const pid = joinedPlayerId ?? ((socket.data as any).playerId as string | undefined)
      if (!pid) return
      emitMafiaRole(room as any, pid, socket as any, { force: true })
    })

    socket.on('game:meme:context_vote', (payload: { promptIndex?: number }) => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room?.memeGame || room.memeGame.status !== 'context_vote') return
      if (playerIsSpectator(room, joinedPlayerId)) return
      const ix: 0 | 1 = payload?.promptIndex === 1 ? 1 : 0
      room.memeGame.contextVotes[joinedPlayerId] = ix
      touchRoom(joinedCode)
      emitRoomState(joinedCode)
    })

    socket.on('game:meme:submit_gif', (payload: { gif?: unknown }) => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room?.memeGame || room.memeGame.status !== 'gif_pick') return
      if (playerIsSpectator(room, joinedPlayerId)) return
      const m = room.memeGame
      if (m.winningPromptIndex === null) return
      const gif = sanitizeMemeGif(payload?.gif)
      if (!gif) return
      m.submissions[joinedPlayerId] = {
        promptIndex: m.winningPromptIndex,
        gif,
      }
      touchRoom(joinedCode)
      emitRoomState(joinedCode)
    })

    socket.on('game:meme:gif_vote', (payload: { targetPlayerId?: string }) => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room?.memeGame || room.memeGame.status !== 'gif_vote') return
      if (playerIsSpectator(room, joinedPlayerId)) return
      const m = room.memeGame
      const target = String(payload?.targetPlayerId ?? '').trim()
      if (!target || target === joinedPlayerId) return
      if (!room.players.some((p) => p.id === target)) return
      m.gifVotes[joinedPlayerId] = target
      touchRoom(joinedCode)
      emitRoomState(joinedCode)
    })

    socket.on('room:leave', () => {
      if (!joinedCode || !joinedPlayerId) return
      const code = joinedCode
      const room = getRoom(code)
      if (room) {
        room.players = room.players.filter((p) => p.id !== joinedPlayerId)
        if (room.players.length === 0) {
          deleteRoom(code)
          startedTurnByRoom.delete(code)
          revealedTurnByRoom.delete(code)
          startedSpyByRoom.delete(code)
          startedMafiaByRoom.delete(code)
          startedLiarByRoom.delete(code)
          startedMemoryByRoom.delete(code)
          startedWhoAmIByRoom.delete(code)
        } else if (!dissolveRoomIfOnlyPlayerLeftDuringMatch(code)) {
          applyPlayerLeftRoom(room)
          touchRoom(code)
          emitRoomState(code)
        }
      }
      void socket.leave(code)
      joinedCode = null
      joinedPlayerId = null
    })

    socket.on(
      'voice:signal',
      (payload: { targetPlayerId?: string; signal?: { kind?: string; sdp?: unknown; candidate?: unknown } }) => {
        if (!joinedCode || !joinedPlayerId) return
        const room = getRoom(joinedCode)
        if (!room) return
        if (playerIsSpectator(room, joinedPlayerId)) return
        const target = String(payload?.targetPlayerId ?? '').trim()
        if (!target || target === joinedPlayerId) return
        if (!room.players.some((p) => p.id === target)) return
        const signal = payload?.signal
        if (!signal || typeof signal !== 'object') return

        for (const s of io!.sockets.sockets.values()) {
          const pid = (s.data as any).playerId as string | undefined
          if (pid !== target) continue
          if (!(s.rooms?.has(joinedCode))) continue
          s.emit('voice:signal', {
            fromPlayerId: joinedPlayerId,
            signal,
          })
        }
      },
    )

    socket.on('chat:message', (payload: { text?: string }) => {
      if (!joinedCode) return
      const room = getRoom(joinedCode)
      if (!room) return
      if (playerIsSpectator(room, joinedPlayerId)) return
      const text = String(payload?.text ?? '').trim().slice(0, 240)
      if (!text) return

      if (room.game === 'mafia' && room.mafiaGame) {
        const g = room.mafiaGame
        if (g.status === 'night') return
        if (g.status === 'day' || g.status === 'voting') {
          if (!joinedPlayerId) return
          const alive = g.alive[joinedPlayerId] === true
          if (!alive) {
            const dead = g.alive[joinedPlayerId] === false
            if (!dead || !MAFIA_GHOST_CHAT) return
          }
        }
      }

      const player = room.players.find((p) => p.id === joinedPlayerId)
      const author = player?.displayName ?? 'Player'
      let variant: 'chat' | 'correct' = 'chat'
      let solved = false
      let guessPts = 0
      let drawerPts = 0

      // Guess checking (server-authoritative).
      if (room.game === 'drawing' && room.drawingGame?.status === 'playing') {
        const g = room.drawingGame
        if (g.word && g.drawerPlayerId && joinedPlayerId && joinedPlayerId !== g.drawerPlayerId) {
          if (normalizeGuess(text) === normalizeGuess(g.word)) {
            solved = true
            variant = 'correct'
            g.status = 'reveal'
            g.solvedByPlayerId = joinedPlayerId
            g.revealEndsAt = Date.now() + 3_000
            const secLeft = g.endsAt ? Math.max(0, Math.ceil((g.endsAt - Date.now()) / 1000)) : 0
            guessPts = 100 + secLeft * 2
            drawerPts = 25
            g.scores[joinedPlayerId] = (g.scores[joinedPlayerId] ?? 0) + guessPts
            g.scores[g.drawerPlayerId] = (g.scores[g.drawerPlayerId] ?? 0) + drawerPts
          }
        }
      }

      const msg = { id: crypto.randomUUID(), author, text, ts: Date.now(), variant }
      room.chat.push(msg)
      if (room.chat.length > 200) room.chat = room.chat.slice(-200)
      touchRoom(joinedCode)
      io!.to(joinedCode).emit('chat:message', msg)

      if (solved) {
        io!.to(joinedCode).emit('chat:message', {
          id: crypto.randomUUID(),
          author: 'Game',
          text: `${author} guessed correctly! +${guessPts} (drawer +${drawerPts})`,
          ts: Date.now(),
          variant: 'system',
        })
        emitRoomState(joinedCode)
      }
    })

    socket.on('drawing:stroke', (payload: any) => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room) return
      if (playerIsSpectator(room, joinedPlayerId)) return
      if (room.game !== 'drawing' || !room.drawingGame) return
      const dg = room.drawingGame
      if (dg.status !== 'playing') return
      if (!dg.drawerPlayerId || dg.drawerPlayerId !== joinedPlayerId) return
      if (
        !payload ||
        typeof payload.id !== 'string' ||
        !Array.isArray(payload.points) ||
        typeof payload.widthNorm !== 'number' ||
        payload.widthNorm <= 0 ||
        payload.widthNorm > 1
      )
        return
      for (const p of payload.points) {
        if (
          !p ||
          typeof p !== 'object' ||
          typeof (p as { x?: unknown }).x !== 'number' ||
          typeof (p as { y?: unknown }).y !== 'number' ||
          (p as { x: number }).x < 0 ||
          (p as { x: number }).x > 1 ||
          (p as { y: number }).y < 0 ||
          (p as { y: number }).y > 1
        )
          return
      }
      room.drawing.strokes.push(payload)
      if (room.drawing.strokes.length > 500) room.drawing.strokes = room.drawing.strokes.slice(-500)
      touchRoom(joinedCode)
      socket.to(joinedCode).emit('drawing:stroke', payload)
    })

    socket.on('drawing:undo', () => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room) return
      if (playerIsSpectator(room, joinedPlayerId)) return
      if (room.game !== 'drawing' || !room.drawingGame) return
      const dg = room.drawingGame
      if (dg.status !== 'playing') return
      if (dg.drawerPlayerId !== joinedPlayerId) return
      if (room.drawing.strokes.length === 0) return
      room.drawing.strokes.pop()
      touchRoom(joinedCode)
      io!.to(joinedCode).emit('drawing:undo')
    })

    socket.on('drawing:clear', () => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room) return
      if (playerIsSpectator(room, joinedPlayerId)) return
      if (room.game !== 'drawing' || !room.drawingGame) return
      const dg = room.drawingGame
      if (dg.status !== 'playing' || dg.drawerPlayerId !== joinedPlayerId) return
      room.drawing.strokes = []
      touchRoom(joinedCode)
      io!.to(joinedCode).emit('drawing:clear')
    })

    const timer = setInterval(() => {
      if (!joinedCode) return
      const room = getRoom(joinedCode)
      if (!room) return
      tickRoomTimers(joinedCode)
      emitRoomState(joinedCode)
    }, 1000)

    socket.on('disconnect', (reason) => {
      console.log('[socket] disconnected', socket.id, reason)
      clearInterval(timer)
      if (!joinedCode || !joinedPlayerId) return
      const code = joinedCode
      const room = getRoom(code)
      if (!room) return
      room.players = room.players.filter((p) => p.id !== joinedPlayerId)
      if (room.players.length === 0) {
        deleteRoom(code)
        startedTurnByRoom.delete(code)
        revealedTurnByRoom.delete(code)
        startedSpyByRoom.delete(code)
        startedMafiaByRoom.delete(code)
        startedLiarByRoom.delete(code)
        startedMemoryByRoom.delete(code)
        startedWhoAmIByRoom.delete(code)
      } else if (!dissolveRoomIfOnlyPlayerLeftDuringMatch(code)) {
        applyPlayerLeftRoom(room)
        touchRoom(code)
        emitRoomState(code)
      }
    })
  })

  return io
}

export function getIo(): Server {
  if (!io) {
    throw new Error('Socket.IO has not been initialized')
  }
  return io
}
