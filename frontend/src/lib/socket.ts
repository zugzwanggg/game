import { io, type Socket } from 'socket.io-client'
import { getStoredAuthToken } from './authToken'

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL?.replace(/\/+$/, '') ?? 'http://localhost:3000'

let socket: Socket | null = null

/** Call after login/logout so the next connection sends the right auth (cookies are unreliable on mobile cross-origin). */
export function resetSocket(): void {
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }
}

export function getSocket(): Socket {
  if (socket) return socket
  const token = getStoredAuthToken() ?? ''
  socket = io(SOCKET_URL, {
    transports: ['websocket'],
    autoConnect: false,
    withCredentials: true,
    auth: token ? { token } : {},
  })
  return socket
}

