import { socket } from "../socket.js"
import { voiceAutoJoinToggle } from "../dom.js"
import { voiceState } from "./state.js"
import { playNotificationTone } from "./audio.js"
import { applyPresence, setChannelVoicePresence } from "./presence.js"
import { upsertParticipant, removeParticipant, setParticipantMuted } from "./participants.js"
import { updateVoiceUi } from "./ui.js"
import { initAutoJoinPreference, setAutoJoinPreference } from "./actions.js"
import { ensurePeerConnection, handleVoiceSignal, removePeer } from "./rtc.js"
import { initVoiceSettings } from "./settings.js"
import { initPushToTalk } from "./ptt.js"

function syncRoomStartedAtTs(rawValue) {
  const ts = Number(rawValue || 0)
  if (Number.isFinite(ts) && ts > 0) {
    voiceState.joinedAtTs = ts
  }
}

function syncServerClock(rawValue) {
  const ts = Number(rawValue || 0)
  if (!Number.isFinite(ts) || ts <= 0) return
  voiceState.serverClockOffsetMs = ts - Date.now()
}

function bindVoiceSocketHandlers() {
  initAutoJoinPreference()
  initVoiceSettings()
  initPushToTalk()
  if (voiceAutoJoinToggle) {
    voiceAutoJoinToggle.addEventListener("change", () => {
      setAutoJoinPreference(voiceAutoJoinToggle.checked, { triggerJoin: true })
    })
  }

  socket.on("voice signal", (payload) => {
    handleVoiceSignal(payload).catch(() => {})
  })

  socket.on("voice user joined", (payload) => {
    const peerId = payload && payload.id
    const username = payload && payload.username
    const isMuted = Boolean(payload && payload.is_muted)
    if (!peerId || peerId === socket.id) return
    syncServerClock(payload && payload.server_now_ts)
    syncRoomStartedAtTs(payload && payload.room_started_at_ts)
    upsertParticipant(peerId, username || "Unknown", { isSelf: false, isMuted })
    if (voiceState.isJoined) {
      ensurePeerConnection(peerId, { isInitiator: false }).catch(() => {})
      playNotificationTone("join")
    }
    updateVoiceUi()
  })

  socket.on("voice user left", (payload) => {
    const peerId = payload && payload.id
    if (!peerId) return
    removeParticipant(peerId)
    removePeer(peerId)
    if (voiceState.isJoined) {
      playNotificationTone("leave")
    }
    updateVoiceUi()
  })

  socket.on("voice presence update", (payload) => {
    const serverId = Number(payload && payload.server_id)
    const channelName = String(payload && payload.channel || "")
    if (!serverId || !channelName) return
    const peers = Array.isArray(payload.peers) ? payload.peers : []
    setChannelVoicePresence(serverId, channelName, {
      peers,
      roomStartedAtTs: payload && payload.room_started_at_ts,
      serverNowTs: payload && payload.server_now_ts
    })

    const isActiveContext =
      serverId === Number(voiceState.serverId || 0) &&
      channelName === String(voiceState.channelName || "")
    if (!isActiveContext) {
      updateVoiceUi()
      return
    }

    syncServerClock(payload && payload.server_now_ts)
    syncRoomStartedAtTs(payload && payload.room_started_at_ts)
    if (peers.length === 0) {
      voiceState.joinedAtTs = 0
    }
    if (voiceState.isJoined) {
      updateVoiceUi()
      return
    }
    applyPresence(peers)
  })

  socket.on("voice mute state", (payload) => {
    const peerId = payload && payload.id
    if (!peerId) return
    const isMuted = Boolean(payload && payload.is_muted)
    setParticipantMuted(peerId, isMuted)
    updateVoiceUi()
  })
}

export { bindVoiceSocketHandlers }
