import { voiceState } from "./state.js"

function toPresenceKey(serverId, channelName) {
  const sid = Number(serverId || 0)
  const channel = String(channelName || "").trim().toLowerCase()
  if (!Number.isInteger(sid) || sid <= 0 || !channel) return ""
  return `${sid}:${channel}`
}

function setChannelVoicePresence(serverId, channelName, payload = {}) {
  const key = toPresenceKey(serverId, channelName)
  if (!key) return

  const peers = Array.isArray(payload.peers) ? payload.peers : []
  const roomStartedAtTs = Number(payload.roomStartedAtTs || payload.room_started_at_ts || 0)
  const serverNowTs = Number(payload.serverNowTs || payload.server_now_ts || 0)
  const clockOffsetMs =
    Number.isFinite(serverNowTs) && serverNowTs > 0 ? serverNowTs - Date.now() : 0

  voiceState.channelPresenceByKey.set(key, {
    serverId: Number(serverId),
    channelName: String(channelName || "").toLowerCase(),
    peers,
    roomStartedAtTs: Number.isFinite(roomStartedAtTs) && roomStartedAtTs > 0 ? roomStartedAtTs : 0,
    clockOffsetMs
  })
}

function getChannelVoicePresence(serverId, channelName) {
  const key = toPresenceKey(serverId, channelName)
  if (!key) return null
  return voiceState.channelPresenceByKey.get(key) || null
}

function clearVoicePresenceForServer(serverId) {
  const sid = Number(serverId || 0)
  if (!Number.isInteger(sid) || sid <= 0) return
  const prefix = `${sid}:`
  Array.from(voiceState.channelPresenceByKey.keys()).forEach((key) => {
    if (key.startsWith(prefix)) {
      voiceState.channelPresenceByKey.delete(key)
    }
  })
}

function clearAllVoicePresence() {
  voiceState.channelPresenceByKey.clear()
}

export {
  setChannelVoicePresence,
  getChannelVoicePresence,
  clearVoicePresenceForServer,
  clearAllVoicePresence
}
