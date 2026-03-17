import { msgInput } from "../dom.js"
import { state } from "../state.js"
import { socket } from "../socket.js"
import { MAX_MESSAGE_LENGTH } from "../constants.js"
import { notify } from "../notice.js"
import { startSessionForSelectedChannel } from "../session.js"
import { sendTypingState, stopTypingStateTimer } from "../typing.js"

function send() {
  if (!state.isSessionReady) {
    startSessionForSelectedChannel(true, send)
    return
  }

  const msg = msgInput.value.trim()
  if (!msg) return
  if (msg.length > MAX_MESSAGE_LENGTH) {
    notify(`Pesan maksimal ${MAX_MESSAGE_LENGTH} karakter`)
    return
  }

  socket.emit("chat message", { message: msg })
  sendTypingState(false)
  stopTypingStateTimer()
  msgInput.value = ""
  msgInput.focus()
}

export { send }
