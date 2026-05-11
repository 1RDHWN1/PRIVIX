import { msgInput } from "../dom.js"
import { state } from "../state.js"
import { socket } from "../socket.js"
import { MAX_MESSAGE_LENGTH, CHANNEL_TYPE_VOICE } from "../constants.js"
import { notify } from "../notice.js"
import { startSessionForSelectedChannel, getActiveChannelInfo } from "../session.js"
import { sendTypingState, stopTypingStateTimer } from "../typing.js"
import { clearReplyDraft, getReplyMessageId } from "../reply.js"
import { closeMentionSuggestions } from "../mentions.js"
import { handleMiniGameCommand } from "../minigames.js"

function resetComposerAfterSend() {
  sendTypingState(false)
  stopTypingStateTimer()
  msgInput.value = ""
  msgInput.style.height = "auto"
  closeMentionSuggestions()
  clearReplyDraft()
  msgInput.focus()
}

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
  const channelInfo = getActiveChannelInfo()
  if (channelInfo && channelInfo.type === CHANNEL_TYPE_VOICE) {
    notify("Voice channel tidak menerima chat")
    return
  }

  if (handleMiniGameCommand(msg, { replyToMessageId: null })) {
    resetComposerAfterSend()
    return
  }

  const replyToMessageId = getReplyMessageId()
  socket.emit("chat message", {
    message: msg,
    reply_to_message_id: replyToMessageId || null
  })
  resetComposerAfterSend()
}

export { send }
