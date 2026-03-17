import { state } from "./state.js"
import { socket } from "./socket.js"
import { renderTypingIndicator } from "./ui.js"

function sendTypingState(isTyping) {
  const nextState = Boolean(isTyping)
  if (!socket.connected || !state.isSessionReady) {
    state.isTypingSent = false
    return
  }
  if (state.isTypingSent === nextState) return
  state.isTypingSent = nextState
  socket.emit("typing state", { is_typing: nextState })
}

function stopTypingStateTimer() {
  if (!state.typingStopTimer) return
  clearTimeout(state.typingStopTimer)
  state.typingStopTimer = null
}

function queueTypingStop() {
  stopTypingStateTimer()
  state.typingStopTimer = setTimeout(() => {
    sendTypingState(false)
  }, 1200)
}

function resetTypingState(options = {}) {
  const notifyServer = Boolean(options.notifyServer)
  stopTypingStateTimer()
  state.typingUsers.clear()
  renderTypingIndicator()
  if (notifyServer && socket.connected && state.isTypingSent) {
    socket.emit("typing state", { is_typing: false })
  }
  state.isTypingSent = false
}

export { sendTypingState, stopTypingStateTimer, queueTypingStop, resetTypingState }
