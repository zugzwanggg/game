import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAnon, RequireIdentity } from './components/auth/RouteGuards'
import AppShell from './components/layout/AppShell'
import GamePlayPage from './pages/GamePlayPage'
import GameRoom from './pages/GameRoom'
import GamesHub from './pages/GamesHub'
import RoomPage from './pages/RoomPage'
import JoinRoom from './pages/JoinRoom'
import LoginPage from './pages/LoginPage'
import SignUpPage from './pages/SignUpPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/games" replace />} />
        <Route path="/games" element={<GamesHub />} />
        <Route path="/games/:gameId" element={<GameRoom />} />
        <Route
          path="/room/:roomCode"
          element={
            <RequireIdentity>
              <RoomPage />
            </RequireIdentity>
          }
        />
      </Route>
      <Route
        path="/games/:gameId/play"
        element={
          <RequireIdentity>
            <GamePlayPage />
          </RequireIdentity>
        }
      />
      <Route path="/join/:code" element={<JoinRoom />} />
      <Route
        path="/login"
        element={
          <RequireAnon>
            <LoginPage />
          </RequireAnon>
        }
      />
      <Route
        path="/signup"
        element={
          <RequireAnon>
            <SignUpPage />
          </RequireAnon>
        }
      />
    </Routes>
  )
}
