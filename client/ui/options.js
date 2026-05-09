import { serverSelect, serverList, channelSelect, channelList } from "../dom.js"
import { getRoleBadge, getServerRoleName } from "../permissions.js"
import { CHANNEL_TYPE_VOICE } from "../constants.js"
import { state } from "../state.js"
import { voiceState } from "../voice/state.js"
import { getChannelVoicePresence } from "../voice/presenceStore.js"

let voiceDurationTickerId = 0
let voiceChannelListRenderToken = 0
let voiceChannelListRenderNeedsForce = false
let lastVoiceChannelListSignature = ""

function getServerInitials(name) {
  const cleaned = String(name || "").trim()
  if (!cleaned) return "SR"
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function getUserInitials(name) {
  const cleaned = String(name || "").trim()
  if (!cleaned) return "??"
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function getMemberRole(username) {
  if (!username) return "member"
  const entry = state.membersCache.find(
    (item) => String((item && item.username) || "").toLowerCase() === String(username).toLowerCase()
  )
  return String((entry && entry.role_name) || "member").toLowerCase()
}

function formatElapsedDuration(startedAtTs, clockOffsetMs = voiceState.serverClockOffsetMs) {
  const startedAt = Number(startedAtTs || 0)
  if (!Number.isFinite(startedAt) || startedAt <= 0) return "00:00:00"
  const offset = Number(clockOffsetMs || 0)
  const syncedNow = Date.now() + (Number.isFinite(offset) ? offset : 0)
  const elapsedSeconds = Math.max(0, Math.floor((syncedNow - startedAt) / 1000))
  const hours = Math.floor(elapsedSeconds / 3600)
  const minutes = Math.floor((elapsedSeconds % 3600) / 60)
  const seconds = elapsedSeconds % 60
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

function syncVoiceDurationTicker(shouldRun) {
  if (shouldRun && !voiceDurationTickerId) {
    voiceDurationTickerId = setInterval(() => {
      refreshVoiceChannelDurationLabels()
    }, 1000)
    return
  }

  if (!shouldRun && voiceDurationTickerId) {
    clearInterval(voiceDurationTickerId)
    voiceDurationTickerId = 0
  }
}

function setVoiceMetaState(meta, { text, startedAtTs = 0, clockOffsetMs = 0, isElapsed = false }) {
  if (!meta) return
  meta.textContent = text
  meta.dataset.durationMode = isElapsed ? "elapsed" : "static"
  meta.dataset.startedAtTs = String(Number(startedAtTs || 0))
  meta.dataset.clockOffsetMs = String(Number(clockOffsetMs || 0))
}

function refreshVoiceChannelDurationLabels() {
  if (!channelList) return
  channelList.querySelectorAll(".channel-voice-meta[data-duration-mode='elapsed']").forEach((meta) => {
    const startedAtTs = Number(meta.dataset.startedAtTs || 0)
    const clockOffsetMs = Number(meta.dataset.clockOffsetMs || 0)
    meta.textContent = formatElapsedDuration(startedAtTs, clockOffsetMs)
  })
}

function syncServerListSelection() {
  if (!serverList) return
  const activeId = String(serverSelect.value || "")
  Array.from(serverList.children).forEach((item) => {
    const isActive = item.dataset.serverId === activeId
    item.classList.toggle("is-active", isActive)
  })
}

function setServerOptions(servers) {
  serverSelect.innerHTML = ""
  servers.forEach((item) => {
    const option = document.createElement("option")
    option.value = String(item.id)
    const roleLabel = getRoleBadge(getServerRoleName(item))
    option.textContent = `${item.name} • ${roleLabel}`
    serverSelect.appendChild(option)
  })

  if (serverList) {
    serverList.innerHTML = ""
    servers.forEach((item) => {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "server-item"
      button.dataset.serverId = String(item.id)
      button.textContent = getServerInitials(item.name)
      serverList.appendChild(button)
    })
    syncServerListSelection()
  }
}

function buildVoicePrefixIcon() {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  icon.setAttribute("viewBox", "0 0 24 24")
  icon.setAttribute("fill", "none")
  icon.setAttribute("aria-hidden", "true")

  const body = document.createElementNS("http://www.w3.org/2000/svg", "path")
  body.setAttribute("d", "M4 9.5h3.4L12 6v12l-4.6-3.5H4z")
  body.setAttribute("fill", "currentColor")

  const waveNear = document.createElementNS("http://www.w3.org/2000/svg", "path")
  waveNear.setAttribute("d", "M15.2 9.2c1.5 1.4 1.5 4.2 0 5.6")
  waveNear.setAttribute("stroke", "currentColor")
  waveNear.setAttribute("stroke-width", "1.9")
  waveNear.setAttribute("stroke-linecap", "round")
  waveNear.setAttribute("stroke-linejoin", "round")

  const waveFar = document.createElementNS("http://www.w3.org/2000/svg", "path")
  waveFar.setAttribute("d", "M17.8 7.3c2.5 2.3 2.5 7.1 0 9.4")
  waveFar.setAttribute("stroke", "currentColor")
  waveFar.setAttribute("stroke-width", "1.9")
  waveFar.setAttribute("stroke-linecap", "round")
  waveFar.setAttribute("stroke-linejoin", "round")

  icon.appendChild(body)
  icon.appendChild(waveNear)
  icon.appendChild(waveFar)
  return icon
}

function buildMutedStatusIcon() {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  icon.setAttribute("viewBox", "0 0 24 24")
  icon.setAttribute("fill", "none")
  icon.setAttribute("aria-hidden", "true")

  const mic = document.createElementNS("http://www.w3.org/2000/svg", "path")
  mic.setAttribute("d", "M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3z")
  mic.setAttribute("fill", "currentColor")

  const stem = document.createElementNS("http://www.w3.org/2000/svg", "path")
  stem.setAttribute("d", "M11 17.9V21h2v-3.1a7 7 0 0 0 4.9-2.7l-1.4-1.4A5 5 0 0 1 12 16a5 5 0 0 1-5-5H5a7 7 0 0 0 6 6.9z")
  stem.setAttribute("fill", "currentColor")

  const slash = document.createElementNS("http://www.w3.org/2000/svg", "path")
  slash.setAttribute("d", "M4.6 4.6 19.4 19.4")
  slash.setAttribute("stroke", "currentColor")
  slash.setAttribute("stroke-width", "2.2")
  slash.setAttribute("stroke-linecap", "round")

  icon.appendChild(mic)
  icon.appendChild(stem)
  icon.appendChild(slash)
  return icon
}

function buildCameraStatusIcon() {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  icon.setAttribute("viewBox", "0 0 24 24")
  icon.setAttribute("fill", "none")
  icon.setAttribute("aria-hidden", "true")

  const body = document.createElementNS("http://www.w3.org/2000/svg", "path")
  body.setAttribute("d", "M4 7.5A2.5 2.5 0 0 1 6.5 5h7A2.5 2.5 0 0 1 16 7.5V9l3.2-2.13c.66-.44 1.55.03 1.55.83v8.6c0 .8-.89 1.27-1.55.83L16 15v1.5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 4 16.5z")
  body.setAttribute("fill", "currentColor")

  icon.appendChild(body)
  return icon
}

function buildChannelItem(channel, type) {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "channel-item"
  button.dataset.channelName = channel.name
  button.dataset.channelType = type

  const prefix = document.createElement("span")
  prefix.className = "channel-prefix"

  if (type === CHANNEL_TYPE_VOICE) {
    prefix.classList.add("is-voice")
    prefix.appendChild(buildVoicePrefixIcon())
  } else {
    prefix.textContent = "#"
  }

  const name = document.createElement("span")
  name.className = "channel-name"
  name.textContent = channel.name

  button.appendChild(prefix)
  button.appendChild(name)

  if (type === CHANNEL_TYPE_VOICE) {
    const badge = document.createElement("span")
    badge.className = "channel-badge"
    badge.textContent = "voice"
    button.appendChild(badge)
  }

  return button
}

function buildVoiceMeter() {
  const meter = document.createElement("span")
  meter.className = "voice-channel-member-meter"

  for (let i = 0; i < 3; i += 1) {
    const bar = document.createElement("i")
    meter.appendChild(bar)
  }

  return meter
}

function buildVoiceMemberRow(participant) {
  const row = document.createElement("div")
  row.className = "voice-channel-member"
  row.dataset.peerId = String(participant.id || "")

  const isSpeaking = Boolean(voiceState.speakingState.get(participant.id))
  if (isSpeaking && !participant.isMuted) {
    row.classList.add("is-speaking")
  }
  if (participant.isMuted) {
    row.classList.add("is-muted")
  }
  if (participant.isCameraEnabled) {
    row.classList.add("is-camera-on")
  }

  const avatar = document.createElement("span")
  avatar.className = "voice-channel-member-avatar"
  avatar.textContent = getUserInitials(participant.username)

  const name = document.createElement("span")
  name.className = "voice-channel-member-name"
  name.textContent = participant.username || "unknown"

  const role = document.createElement("span")
  role.className = "voice-channel-member-role"
  role.dataset.role = getMemberRole(participant.username)
  role.textContent = role.dataset.role

  const meter = buildVoiceMeter()

  const media = document.createElement("span")
  media.className = "voice-channel-member-media"

  const camera = document.createElement("span")
  camera.className = "voice-channel-member-camera"
  camera.setAttribute("aria-hidden", "true")
  camera.appendChild(buildCameraStatusIcon())

  const status = document.createElement("span")
  status.className = "voice-channel-member-status"
  status.setAttribute("aria-hidden", "true")
  status.appendChild(buildMutedStatusIcon())

  row.appendChild(avatar)
  row.appendChild(name)
  row.appendChild(role)
  row.appendChild(meter)
  media.appendChild(camera)
  media.appendChild(status)
  row.appendChild(media)

  return row
}

function getSortedVoiceParticipants() {
  const participants = Array.from(voiceState.participants.values())
  return participants.sort((a, b) => {
    if (a.isSelf && !b.isSelf) return -1
    if (!a.isSelf && b.isSelf) return 1
    return String(a.username || "").localeCompare(String(b.username || ""))
  })
}

function normalizePresencePeer(peer) {
  if (!peer || !peer.id) return null
  return {
    id: String(peer.id),
    username: String(peer.username || "unknown"),
    isSelf: Boolean(peer.isSelf),
    isMuted: Boolean(peer.isMuted ?? peer.is_muted),
    isCameraEnabled: Boolean(peer.isCameraEnabled ?? peer.is_camera_enabled)
  }
}

function getSortedPresencePeers(peers) {
  const raw = (Array.isArray(peers) ? peers : [])
    .map((peer) => normalizePresencePeer(peer))
    .filter(Boolean)

  const byUsername = new Map()
  raw.forEach((peer) => {
    const key = String(peer.username || "").trim().toLowerCase()
    if (!key) return
    const existing = byUsername.get(key)
    if (!existing) {
      byUsername.set(key, { ...peer })
      return
    }

    byUsername.set(key, {
      ...existing,
      id: existing.isSelf ? existing.id : peer.id,
      isSelf: existing.isSelf || Boolean(peer.isSelf),
      isMuted: Boolean(existing.isMuted) && Boolean(peer.isMuted),
      isCameraEnabled: Boolean(existing.isCameraEnabled) || Boolean(peer.isCameraEnabled)
    })
  })

  const list = Array.from(byUsername.values())
  return list.sort((a, b) => {
    if (a.isSelf && !b.isSelf) return -1
    if (!a.isSelf && b.isSelf) return 1
    return String(a.username || "").localeCompare(String(b.username || ""))
  })
}

function getVoiceChannelListSignature() {
  if (!channelList) return "no-channel-list"

  const activeServerId = Number(serverSelect.value || 0)
  const activeVoiceName = voiceState.isVoiceChannel ? String(voiceState.channelName || "") : ""
  const channelSummary = Array.from(channelList.querySelectorAll('.channel-item[data-channel-type="voice"]'))
    .map((item) => {
      const channelName = String(item.dataset.channelName || "")
      const presence = getChannelVoicePresence(activeServerId, channelName)
      const presencePeers = getSortedPresencePeers(presence && presence.peers)
      const activeVoiceParticipants =
        activeVoiceName && channelName === activeVoiceName ? getSortedVoiceParticipants() : []
      const participants = presencePeers.length > 0 ? presencePeers : activeVoiceParticipants
      const peerSummary = participants
        .map((participant) =>
          [
            participant.id,
            participant.username,
            participant.isSelf ? 1 : 0,
            participant.isMuted ? 1 : 0,
            participant.isCameraEnabled ? 1 : 0,
            getMemberRole(participant.username)
          ].join(":")
        )
        .join("|")

      return [
        channelName,
        channelName === activeVoiceName ? 1 : 0,
        Number((presence && presence.roomStartedAtTs) || 0),
        peerSummary
      ].join("~")
    })
    .join("||")

  return [
    activeServerId,
    activeVoiceName,
    voiceState.isVoiceChannel ? 1 : 0,
    voiceState.isConnecting ? 1 : 0,
    voiceState.isJoined ? 1 : 0,
    Number(voiceState.joinedAtTs || 0),
    channelSummary
  ].join("###")
}

function renderVoiceChannelListUi(options = {}) {
  if (!channelList) return
  const force = Boolean(options && options.force)
  const signature = getVoiceChannelListSignature()
  if (!force && signature === lastVoiceChannelListSignature) {
    refreshVoiceChannelDurationLabels()
    return
  }
  lastVoiceChannelListSignature = signature

  channelList.querySelectorAll(".channel-voice-meta").forEach((item) => item.remove())
  channelList.querySelectorAll(".voice-channel-members").forEach((item) => item.remove())

  const activeServerId = Number(serverSelect.value || 0)
  const activeVoiceName = voiceState.isVoiceChannel ? String(voiceState.channelName || "") : ""
  const activeVoiceParticipants = getSortedVoiceParticipants()
  let needsTicker = false

  Array.from(channelList.querySelectorAll('.channel-item[data-channel-type="voice"]')).forEach((item) => {
    item.classList.remove("is-voice-live")

    const badge = item.querySelector(".channel-badge")
    if (badge) {
      badge.classList.remove("is-hidden")
    }

    const channelName = String(item.dataset.channelName || "")
    const isActiveVoice = Boolean(activeVoiceName) && channelName === activeVoiceName
    const presence = getChannelVoicePresence(activeServerId, channelName)
    const presencePeers = getSortedPresencePeers(presence && presence.peers)
    const participants =
      presencePeers.length > 0 ? presencePeers : isActiveVoice ? activeVoiceParticipants : []
    const hasParticipants = participants.length > 0

    const shouldMarkLive =
      hasParticipants ||
      (isActiveVoice && (voiceState.isConnecting || voiceState.isJoined))
    if (!shouldMarkLive) return

    item.classList.add("is-voice-live")

    if (badge) {
      badge.classList.add("is-hidden")
    }

    const meta = document.createElement("span")
    meta.className = "channel-voice-meta"

    if (isActiveVoice && voiceState.isConnecting) {
      setVoiceMetaState(meta, { text: "...", isElapsed: false })
    } else if (hasParticipants) {
      const startedAtTs = Number((presence && presence.roomStartedAtTs) || voiceState.joinedAtTs || 0)
      const clockOffsetMs = Number((presence && presence.clockOffsetMs) || voiceState.serverClockOffsetMs || 0)
      if (startedAtTs > 0) {
        setVoiceMetaState(meta, {
          text: formatElapsedDuration(startedAtTs, clockOffsetMs),
          startedAtTs,
          clockOffsetMs,
          isElapsed: true
        })
        needsTicker = true
      } else {
        setVoiceMetaState(meta, { text: "live", isElapsed: false })
      }
    } else if (isActiveVoice && voiceState.joinedAtTs > 0) {
      setVoiceMetaState(meta, {
        text: formatElapsedDuration(voiceState.joinedAtTs),
        startedAtTs: voiceState.joinedAtTs,
        clockOffsetMs: voiceState.serverClockOffsetMs,
        isElapsed: true
      })
      needsTicker = true
    } else if (isActiveVoice && voiceState.isJoined) {
      setVoiceMetaState(meta, { text: "live", isElapsed: false })
    } else {
      setVoiceMetaState(meta, { text: "idle", isElapsed: false })
    }

    item.appendChild(meta)

    if (hasParticipants) {
      const membersWrap = document.createElement("div")
      membersWrap.className = "voice-channel-members"

      participants.forEach((participant) => {
        membersWrap.appendChild(buildVoiceMemberRow(participant))
      })

      item.insertAdjacentElement("afterend", membersWrap)
    }
  })

  syncVoiceDurationTicker(needsTicker)
  refreshVoiceChannelDurationLabels()
}

function updateVoiceChannelListUi(options = {}) {
  const immediate = Boolean(options && options.immediate)
  const force = Boolean(options && options.force)
  if (immediate) {
    if (voiceChannelListRenderToken) {
      cancelAnimationFrame(voiceChannelListRenderToken)
      voiceChannelListRenderToken = 0
    }
    voiceChannelListRenderNeedsForce = false
    renderVoiceChannelListUi({ force })
    return
  }

  voiceChannelListRenderNeedsForce = voiceChannelListRenderNeedsForce || force
  if (voiceChannelListRenderToken) return
  voiceChannelListRenderToken = requestAnimationFrame(() => {
    const shouldForce = voiceChannelListRenderNeedsForce
    voiceChannelListRenderToken = 0
    voiceChannelListRenderNeedsForce = false
    renderVoiceChannelListUi({ force: shouldForce })
  })
}

function syncChannelListSelection() {
  if (!channelList) return
  const active = String(channelSelect.value || "")
  Array.from(channelList.querySelectorAll(".channel-item")).forEach((item) => {
    const isActive = item.dataset.channelName === active
    item.classList.toggle("is-active", isActive)
  })
  updateVoiceChannelListUi()
}

function setChannelOptions(channels) {
  channelSelect.innerHTML = ""
  if (channelList) {
    channelList.innerHTML = ""
  }
  lastVoiceChannelListSignature = ""
  const sortedChannels = [...channels].sort((a, b) => {
    if (a.name === "general" && b.name !== "general") return -1
    if (a.name !== "general" && b.name === "general") return 1
    return a.name.localeCompare(b.name)
  })

  const textChannels = []
  const voiceChannels = []
  sortedChannels.forEach((item) => {
    const type = String(item.type || "text").toLowerCase()
    if (type === CHANNEL_TYPE_VOICE) {
      voiceChannels.push(item)
    } else {
      textChannels.push(item)
    }
  })

  sortedChannels.forEach((item) => {
    const option = document.createElement("option")
    option.value = item.name
    const type = String(item.type || "text").toLowerCase()
    option.dataset.type = type
    option.textContent =
      type === CHANNEL_TYPE_VOICE ? `voice ${item.name}` : `# ${item.name}`
    channelSelect.appendChild(option)
  })

  if (channelList) {
    if (textChannels.length > 0) {
      const textGroup = document.createElement("div")
      const textTitle = document.createElement("div")
      textTitle.className = "channel-group-title"
      textTitle.textContent = "Text Channels"
      textGroup.appendChild(textTitle)
      textChannels.forEach((channel) => {
        textGroup.appendChild(buildChannelItem(channel, "text"))
      })
      channelList.appendChild(textGroup)
    }

    if (voiceChannels.length > 0) {
      const voiceGroup = document.createElement("div")
      const voiceTitle = document.createElement("div")
      voiceTitle.className = "channel-group-title"
      voiceTitle.textContent = "Voice Channels"
      voiceGroup.appendChild(voiceTitle)
      voiceChannels.forEach((channel) => {
        voiceGroup.appendChild(buildChannelItem(channel, CHANNEL_TYPE_VOICE))
      })
      channelList.appendChild(voiceGroup)
    }

    syncChannelListSelection()
  }
}

export {
  setServerOptions,
  setChannelOptions,
  syncServerListSelection,
  syncChannelListSelection,
  updateVoiceChannelListUi
}
