import { socket } from "../socket.js"
import { voiceState } from "./state.js"

function resetParticipants({ preserveSpeaking = false } = {}) {
  voiceState.participants.clear()
  voiceState.tileEls.clear()
  if (!preserveSpeaking) {
    voiceState.speakingState.clear()
  }
}

function upsertParticipant(id, username, { isSelf = false, isMuted = false } = {}) {
  if (!id) return
  voiceState.participants.set(id, {
    id,
    username: username || "Unknown",
    isSelf: Boolean(isSelf),
    isMuted: Boolean(isMuted)
  })
}

function removeParticipant(id) {
  if (!id) return
  voiceState.participants.delete(id)
}

function setParticipantMuted(id, isMuted) {
  const entry = voiceState.participants.get(id)
  if (!entry) return
  entry.isMuted = Boolean(isMuted)
  voiceState.participants.set(id, entry)
  const tile = voiceState.tileEls.get(id)
  if (tile) {
    tile.classList.toggle("is-muted", Boolean(isMuted))
  }
}

function updateSelfTileState() {
  const tile = voiceState.tileEls.get(socket.id)
  if (!tile) return
  const isMuted = !voiceState.canSpeak || voiceState.isMuted
  tile.classList.toggle("is-muted", isMuted)
  setParticipantMuted(socket.id, isMuted)
}

export {
  resetParticipants,
  upsertParticipant,
  removeParticipant,
  setParticipantMuted,
  updateSelfTileState
}
