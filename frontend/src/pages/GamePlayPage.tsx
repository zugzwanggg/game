import { Navigate, useParams } from 'react-router-dom'
import GuessDrawingGame from '../games/drawing/GuessDrawingGame'
import MemeBattleGame from '../games/meme/MemeBattleGame'
import SpyGame from '../games/spy/SpyGame'

export default function GamePlayPage() {
  const { gameId } = useParams()

  if (gameId === 'drawing') {
    return (
      <div className="flex min-h-0 flex-col bg-base h-dvh max-h-dvh overflow-y-auto overflow-x-hidden">
        <GuessDrawingGame />
      </div>
    )
  }

  if (gameId === 'meme') {
    return (
      <div className="flex min-h-0 flex-col bg-base h-dvh max-h-dvh overflow-y-auto overflow-x-hidden">
        <MemeBattleGame />
      </div>
    )
  }

  if (gameId === 'spy') {
    return (
      <div className="flex min-h-0 flex-col bg-base h-dvh max-h-dvh overflow-y-auto overflow-x-hidden">
        <SpyGame />
      </div>
    )
  }

  return <Navigate to={gameId ? `/games/${gameId}` : '/games'} replace />
}
