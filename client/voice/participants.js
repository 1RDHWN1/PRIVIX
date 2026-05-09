import { socket } from "../socket.js"
import { voiceState, resetVoiceStageState } from "./state.js"

function resetParticipants({ preserveSpeaking = false } = {}) {
  voiceState.participants.clear()
  resetVoiceStageState()
  if (!preserveSpeaking) {
    voiceState.speakingState.clear()
  }
}

function upsertParticipant(
  id,
  username,
  { isSelf = false, isMuted = false, isCameraEnabled = false, isScreenSharing = false } = {}
) {
  if (!id) return
  voiceState.participants.set(id, {
    id,
    username: username || "Unknown",
    isSelf: Boolean(isSelf),
    isMuted: Boolean(isMuted),
    isCameraEnabled: Boolean(isCameraEnabled),
    isScreenSharing: Boolean(isScreenSharing)
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

function setParticipantCameraEnabled(id, isCameraEnabled) {
  const entry = voiceState.participants.get(id)
  if (!entry) return
  entry.isCameraEnabled = Boolean(isCameraEnabled)
  voiceState.participants.set(id, entry)
}

function setParticipantScreenSharing(id, isScreenSharing) {
  const entry = voiceState.participants.get(id)
  if (!entry) return
  entry.isScreenSharing = Boolean(isScreenSharing)
  voiceState.participants.set(id, entry)
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
  setParticipantCameraEnabled,
  setParticipantScreenSharing,
  updateSelfTileState
}
