const socketUrl =
  (typeof window !== "undefined" && window.PRIVIX_SOCKET_URL) || window.location.origin
const socket = io(socketUrl, {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 700,
  reconnectionDelayMax: 5000,
  timeout: 20000
})

export { socket }
