import { Navigate, useParams } from 'react-router-dom'
import { GameWorld } from '../components/game/GameWorld'
import GuessDrawingGame from '../games/drawing/GuessDrawingGame'
import MemeBattleGame from '../games/meme/MemeBattleGame'

export default function GamePlayPage() {
  const { gameId } = useParams()

  if (gameId === 'drawing') {
    return (
      <GameWorld className="h-dvh max-h-dvh overflow-y-auto overflow-x-hidden" theme="drawing">
        <GuessDrawingGame />
      </GameWorld>
    )
  }

  if (gameId === 'meme') {
    return (
      <GameWorld className="h-dvh max-h-dvh overflow-y-auto overflow-x-hidden" theme="meme">
        <MemeBattleGame />
      </GameWorld>
    )
  }

  return <Navigate to={gameId ? `/games/${gameId}` : '/games'} replace />
}
