import { emitWithTimeout } from "../api.js"
import { socket } from "../socket.js"
import { voiceState } from "./state.js"
import { playNotificationTone } from "./audio.js"
import { upsertParticipant, resetParticipants } from "./participants.js"
import { updateVoiceUi } from "./ui.js"
import {
  setChannelVoicePresence,
  getChannelVoicePresence,
  clearVoicePresenceForServer,
  clearAllVoicePresence
} from "./presenceStore.js"

function stopPresencePolling() {
  if (voiceState.presenceTimerId) {
    clearInterval(voiceState.presenceTimerId)
    voiceState.presenceTimerId = 0
  }
}

function resetPresenceTracking() {
  voiceState.presenceIds = new Set()
  voiceState.presenceInitialized = false
}

function applyPresence(peers, { notifyChanges = true } = {}) {
  const list = Array.isArray(peers) ? peers : []
  const nextIds = new Set()
  list.forEach((peer) => {
    if (peer && peer.id) {
      nextIds.add(peer.id)
    }
  })

  if (notifyChanges && voiceState.presenceInitialized) {
    nextIds.forEach((id) => {
      if (!voiceState.presenceIds.has(id) && id !== socket.id) {
        playNotificationTone("join")
      }
    })
    voiceState.presenceIds.forEach((id) => {
      if (!nextIds.has(id) && id !== socket.id) {
        playNotificationTone("leave")
      }
    })
  }

  voiceState.presenceIds = nextIds
  voiceState.presenceInitialized = true

  resetParticipants({ preserveSpeaking: true })
  list.forEach((peer) => {
    if (!peer || !peer.id) return
    const isSelf = peer.id === socket.id
    const isMuted = isSelf ? !voiceState.canSpeak || voiceState.isMuted : Boolean(peer.is_muted)
    upsertParticipant(peer.id, peer.username || "Unknown", {
      isSelf,
      isMuted,
      isCameraEnabled: Boolean(peer.is_camera_enabled),
      isScreenSharing: Boolean(peer.is_screen_sharing)
    })
  })
  updateVoiceUi()
}

async function fetchVoicePresence() {
  if (!voiceState.isVoiceChannel || !voiceState.isConnected || !voiceState.isReady) return
  if (voiceState.isJoined || voiceState.isConnecting) return
  if (!voiceState.serverId || !voiceState.channelName) return

  const key = `${voiceState.serverId}:${voiceState.channelName}`
  voiceState.lastPresenceKey = key

  try {
    const result = await emitWithTimeout(
      "voice presence",
      { server_id: voiceState.serverId, channel: voiceState.channelName },
      { timeoutMs: 2000, expectsOk: true }
    )

    if (voiceState.lastPresenceKey !== key) return

    const peers = Array.isArray(result.peers) ? result.peers : []
    const serverNowTs = Number(result.server_now_ts || 0)
    if (Number.isFinite(serverNowTs) && serverNowTs > 0) {
      voiceState.serverClockOffsetMs = serverNowTs - Date.now()
    }
    setChannelVoicePresence(voiceState.serverId, voiceState.channelName, {
      peers,
      roomStartedAtTs: result.room_started_at_ts,
      serverNowTs
    })
    const roomStartedAtTs = Number(result.room_started_at_ts || 0)
    if (Number.isFinite(roomStartedAtTs) && roomStartedAtTs > 0) {
      voiceState.joinedAtTs = roomStartedAtTs
    } else if (peers.length === 0) {
      voiceState.joinedAtTs = 0
    }

    applyPresence(peers)
  } catch {}
}

function startPresencePolling() {
  if (voiceState.presenceTimerId) return
  fetchVoicePresence()
  voiceState.presenceTimerId = setInterval(() => {
    fetchVoicePresence()
  }, 2000)
}

export {
  stopPresencePolling,
  startPresencePolling,
  resetPresenceTracking,
  applyPresence,
  setChannelVoicePresence,
  getChannelVoicePresence,
  clearVoicePresenceForServer,
  clearAllVoicePresence
}
