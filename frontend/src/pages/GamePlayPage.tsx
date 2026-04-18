import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { useRoomMatchAbandoned } from '../hooks/useRoomMatchAbandoned'
import GuessDrawingGame from '../games/drawing/GuessDrawingGame'
import MemeBattleGame from '../games/meme/MemeBattleGame'
import SpyGame from '../games/spy/SpyGame'
import MafiaGame from '../games/mafia/MafiaGame'
import LiarsRevolverGame from '../games/liar/LiarsRevolverGame'
import MemoryArenaGame from '../games/memory/MemoryArenaGame'

export default function GamePlayPage() {
  const { gameId } = useParams()
  const [searchParams] = useSearchParams()
  useRoomMatchAbandoned(searchParams.get('room'), gameId)

  if (gameId === 'drawing') {
    return (
      <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden overflow-x-hidden bg-zinc-100">
        <GuessDrawingGame />
      </div>
    )
  }

  if (gameId === 'meme') {
    return (
      <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-x-hidden overflow-y-auto bg-base">
        <MemeBattleGame />
      </div>
    )
  }

  if (gameId === 'spy') {
    return (
      <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden overflow-x-hidden bg-base">
        <SpyGame />
      </div>
    )
  }

  if (gameId === 'mafia') {
    return (
      <div className="flex min-h-0 flex-col overflow-hidden bg-base h-dvh max-h-dvh">
        <MafiaGame />
      </div>
    )
  }

  if (gameId === 'liar') {
    return (
      <div className="flex min-h-0 flex-col overflow-hidden bg-base h-dvh max-h-dvh">
        <LiarsRevolverGame />
      </div>
    )
  }

  if (gameId === 'memory') {
    return (
      <div className="flex min-h-0 flex-col overflow-hidden bg-base h-dvh max-h-dvh">
        <MemoryArenaGame />
      </div>
    )
  }

  return <Navigate to={gameId ? `/games/${gameId}` : '/games'} replace />
}
