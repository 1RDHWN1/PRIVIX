import { voiceState } from "./state.js"
import { updateVoiceUi } from "./ui.js"
import { schedulePeerReconnect } from "./rtc.js"
import { syncAdaptiveCameraQuality } from "./settings.js"

const QUALITY_INTERVAL_FAST_MS = 2500
const QUALITY_INTERVAL_MEDIUM_MS = 4000
const QUALITY_INTERVAL_SLOW_MS = 6500
const QUALITY_INTERVAL_SOLO_MS = 9000

function scoreLevel({ lossPct, jitterMs, rttMs }) {
  if (lossPct > 15 || jitterMs > 60 || rttMs > 600) return "Poor"
  if (lossPct > 8 || jitterMs > 35 || rttMs > 300) return "Fair"
  return "Good"
}

function mergeSummary(items) {
  if (items.length === 0) {
    return { level: "Unknown", rttMs: 0, jitterMs: 0, lossPct: 0 }
  }

  let worstLevel = "Good"
  let hasKnownLevel = false
  let maxLoss = 0
  let maxJitter = 0
  let maxRtt = 0

  items.forEach((entry) => {
    maxLoss = Math.max(maxLoss, entry.lossPct || 0)
    maxJitter = Math.max(maxJitter, entry.jitterMs || 0)
    maxRtt = Math.max(maxRtt, entry.rttMs || 0)
    if (entry.level === "Good" || entry.level === "Fair" || entry.level === "Poor") {
      hasKnownLevel = true
    }
    if (entry.level === "Poor") {
      worstLevel = "Poor"
    } else if (entry.level === "Fair" && worstLevel === "Good") {
      worstLevel = "Fair"
    }
  })

  if (!hasKnownLevel) {
    worstLevel = "Unknown"
  }

  return { level: worstLevel, rttMs: maxRtt, jitterMs: maxJitter, lossPct: maxLoss }
}

async function readPeerStats(peerId, pc) {
  const stats = await pc.getStats()
  let packetsLost = 0
  let packetsReceived = 0
  let jitter = 0
  let rtt = 0

  stats.forEach((report) => {
    if (report.type === "inbound-rtp" && report.kind === "audio") {
      packetsLost += report.packetsLost || 0
      packetsReceived += report.packetsReceived || 0
      jitter = Math.max(jitter, (report.jitter || 0) * 1000)
    }
    if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) {
      rtt = Math.max(rtt, (report.currentRoundTripTime || 0) * 1000)
    }
  })

  const total = packetsLost + packetsReceived
  const lossPct = total > 0 ? (packetsLost / total) * 100 : 0
  const level = scoreLevel({ lossPct, jitterMs: jitter, rttMs: rtt })
  return { peerId, lossPct, jitterMs: jitter, rttMs: rtt, level }
}

async function pollQuality() {
  if (!voiceState.isJoined) {
    return { level: "Unknown", peerCount: 0 }
  }

  if (voiceState.voiceMode === "sfu") {
    const peerCount = Math.max(0, voiceState.participants.size - 1)
    const entries = Array.from(voiceState.peerStats.values())
      .filter((entry) => entry && entry.source === "sfu")
    const summary = entries.length > 0
      ? mergeSummary(entries)
      : {
          level: peerCount > 0 ? "Unknown" : "Solo",
          rttMs: 0,
          jitterMs: 0,
          lossPct: 0
        }
    voiceState.qualitySummary = {
      ...summary,
      updatedAt: Date.now()
    }
    syncAdaptiveCameraQuality(voiceState.qualitySummary).catch(() => {})
    updateVoiceUi()
    return { level: summary.level, peerCount }
  }

  const entries = []

  const tasks = []
  voiceState.peers.forEach((pc, peerId) => {
    tasks.push(
      readPeerStats(peerId, pc)
        .then((entry) => {
          entries.push(entry)
        })
        .catch(() => {})
    )
  })

  if (tasks.length === 0) {
    voiceState.qualitySummary = {
      level: "Solo",
      rttMs: 0,
      jitterMs: 0,
      lossPct: 0,
      updatedAt: Date.now()
    }
    syncAdaptiveCameraQuality(voiceState.qualitySummary).catch(() => {})
    updateVoiceUi()
    return { level: "Solo", peerCount: 0 }
  }

  await Promise.all(tasks)

  entries.forEach((entry) => {
    const previous = voiceState.peerStats.get(entry.peerId) || { poorCount: 0 }
    const nextPoorCount = entry.level === "Poor" ? previous.poorCount + 1 : 0
    voiceState.peerStats.set(entry.peerId, { ...entry, poorCount: nextPoorCount })
    if (nextPoorCount >= 3) {
      schedulePeerReconnect(entry.peerId, "quality")
    }
  })

  const summary = mergeSummary(entries)
  voiceState.qualitySummary = {
    ...summary,
    updatedAt: Date.now()
  }
  syncAdaptiveCameraQuality(voiceState.qualitySummary).catch(() => {})
  updateVoiceUi()
  return { level: summary.level, peerCount: entries.length }
}

function resolveNextQualityInterval(result) {
  const level = String((result && result.level) || "Unknown")
  const peerCount = Number(result && result.peerCount) || 0

  if (peerCount <= 0 || level === "Solo") {
    return QUALITY_INTERVAL_SOLO_MS
  }
  if (level === "Poor") {
    return QUALITY_INTERVAL_FAST_MS
  }
  if (level === "Fair") {
    return QUALITY_INTERVAL_MEDIUM_MS
  }
  return QUALITY_INTERVAL_SLOW_MS
}

function scheduleQualityPoll(delayMs) {
  if (!voiceState.isJoined) return
  if (voiceState.qualityTimerId) {
    clearTimeout(voiceState.qualityTimerId)
    voiceState.qualityTimerId = 0
  }

  voiceState.qualityTimerId = setTimeout(() => {
    voiceState.qualityTimerId = 0
    pollQuality()
      .then((result) => {
        if (!voiceState.isJoined) return
        scheduleQualityPoll(resolveNextQualityInterval(result))
      })
      .catch(() => {
        if (!voiceState.isJoined) return
        scheduleQualityPoll(QUALITY_INTERVAL_MEDIUM_MS)
      })
  }, Math.max(500, Number(delayMs) || QUALITY_INTERVAL_MEDIUM_MS))
}

function startQualityMonitoring() {
  if (voiceState.qualityTimerId) return
  pollQuality()
    .then((result) => {
      scheduleQualityPoll(resolveNextQualityInterval(result))
    })
    .catch(() => {
      scheduleQualityPoll(QUALITY_INTERVAL_MEDIUM_MS)
    })
}

function stopQualityMonitoring() {
  if (voiceState.qualityTimerId) {
    clearTimeout(voiceState.qualityTimerId)
    voiceState.qualityTimerId = 0
  }
  voiceState.peerStats.clear()
  voiceState.qualitySummary = {
    level: "Unknown",
    rttMs: 0,
    jitterMs: 0,
    lossPct: 0,
    updatedAt: 0
  }
}

export { startQualityMonitoring, stopQualityMonitoring }
