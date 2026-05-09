import { socket } from "../socket.js"
import { voiceState } from "./state.js"
import { playNotificationTone } from "./audio.js"
import { applyPresence, setChannelVoicePresence } from "./presence.js"
import {
  upsertParticipant,
  removeParticipant,
  setParticipantMuted,
  setParticipantCameraEnabled,
  setParticipantScreenSharing
} from "./participants.js"
import { updateVoiceUi } from "./ui.js"
import { ensurePeerConnection, handleVoiceSignal, removePeer } from "./rtc.js"
import { initVoiceSettings } from "./settings.js"
import { initPushToTalk } from "./ptt.js"
import { voiceDebug } from "./debug.js"
import { applySfuRemoteStreamState } from "./sfu.js"

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
  initVoiceSettings()
  initPushToTalk()

  socket.on("voice signal", (payload) => {
    voiceDebug("socket event: voice signal", {
      fromId: payload && payload.from_id,
      type:
        payload && payload.data && payload.data.type
          ? payload.data.type
          : payload && payload.data && payload.data.candidate
            ? "candidate"
            : payload && payload.data && payload.data.restart
              ? "restart"
              : "unknown"
    })
    handleVoiceSignal(payload).catch(() => {})
  })

  socket.on("voice user joined", (payload) => {
    const peerId = payload && payload.id
    const username = payload && payload.username
    const isMuted = Boolean(payload && payload.is_muted)
    const isCameraEnabled = Boolean(payload && payload.is_camera_enabled)
    const isScreenSharing = Boolean(payload && payload.is_screen_sharing)
    if (!peerId || peerId === socket.id) return
    syncServerClock(payload && payload.server_now_ts)
    syncRoomStartedAtTs(payload && payload.room_started_at_ts)
    upsertParticipant(peerId, username || "Unknown", {
      isSelf: false,
      isMuted,
      isCameraEnabled,
      isScreenSharing
    })
    if (voiceState.isJoined) {
      ensurePeerConnection(peerId, { isInitiator: false }).catch(() => {})
      playNotificationTone("join")
    }
    voiceDebug("socket event: voice user joined", {
      peerId,
      username: username || "Unknown",
      isMuted,
      isCameraEnabled,
      isScreenSharing
    })
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
    voiceDebug("socket event: voice mute state", { peerId, isMuted })
    updateVoiceUi()
  })

  socket.on("voice camera state", (payload) => {
    const peerId = payload && payload.id
    if (!peerId) return
    const isCameraEnabled = Boolean(payload && payload.is_camera_enabled)
    setParticipantCameraEnabled(peerId, isCameraEnabled)
    voiceDebug("socket event: voice camera state", { peerId, isCameraEnabled })
    updateVoiceUi()
  })

  socket.on("voice screen state", (payload) => {
    const peerId = payload && payload.id
    if (!peerId) return
    const isScreenSharing = Boolean(payload && payload.is_screen_sharing)
    setParticipantScreenSharing(peerId, isScreenSharing)
    voiceDebug("socket event: voice screen state", { peerId, isScreenSharing })
    updateVoiceUi()
  })

  socket.on("voice stream state", (payload) => {
    const peerId = payload && payload.id
    if (!peerId) return
    const source = String(payload && payload.source ? payload.source : "")
    const isActive = Boolean(payload && payload.is_active)
    applySfuRemoteStreamState(peerId, source, isActive)
    if (source === "camera") {
      setParticipantCameraEnabled(peerId, isActive)
    } else if (source === "screen") {
      setParticipantScreenSharing(peerId, isActive)
    }
    voiceDebug("socket event: voice stream state", { peerId, source, isActive })
    updateVoiceUi()
  })
}

export { bindVoiceSocketHandlers }
