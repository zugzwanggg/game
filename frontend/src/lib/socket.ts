import { io, type Socket } from 'socket.io-client'

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL?.replace(/\/+$/, '') ?? 'http://localhost:3000'

let socket: Socket | null = null

export function getSocket(): Socket {
  if (socket) return socket
  socket = io(SOCKET_URL, {
    transports: ['websocket'],
    autoConnect: false,
    withCredentials: true,
  })
  return socket
}

