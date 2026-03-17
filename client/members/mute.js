import { muteDurationSelect, muteReasonInput, muteBtn } from "../dom.js"
import { state } from "../state.js"
import { formatDurationLabel } from "../utils.js"

function getMutedUntilTs(member) {
  const raw = Number(member && member.muted_until_ts)
  return Number.isFinite(raw) && raw > 0 ? raw : 0
}

function isMemberMuted(member) {
  const mutedUntilTs = getMutedUntilTs(member)
  return mutedUntilTs > Date.now()
}

function resolveMuteDuration(defaultMinutes = 10) {
  const fallback = Number.isInteger(defaultMinutes) && defaultMinutes > 0 ? defaultMinutes : 10
  const raw = String((muteDurationSelect && muteDurationSelect.value) || "").trim()
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10080) {
    return fallback
  }
  return parsed
}

function resolveMuteReason(reasonOverride = "") {
  if (typeof reasonOverride === "string" && reasonOverride.trim()) {
    return reasonOverride.trim()
  }
  return String((muteReasonInput && muteReasonInput.value) || "").trim()
}

function refreshMuteButtonLabel() {
  if (!muteBtn) return
  const duration = resolveMuteDuration(10)
  muteBtn.textContent = `Apply Mute (${formatDurationLabel(duration)})`
}

function getCurrentUserMuteInfo() {
  const selfName = String(state.username || "").trim().toLowerCase()
  if (!selfName) return { isMuted: false, mutedUntilTs: 0, muteReason: "" }
  const selfMember = state.membersCache.find(
    (item) => String((item && item.username) || "").trim().toLowerCase() === selfName
  )
  if (!selfMember) return { isMuted: false, mutedUntilTs: 0, muteReason: "" }

  const mutedUntilTs = getMutedUntilTs(selfMember)
  if (mutedUntilTs <= Date.now()) {
    return { isMuted: false, mutedUntilTs: 0, muteReason: "" }
  }

  return {
    isMuted: true,
    mutedUntilTs,
    muteReason: String((selfMember && selfMember.mute_reason) || "").trim()
  }
}

export {
  getMutedUntilTs,
  isMemberMuted,
  resolveMuteDuration,
  resolveMuteReason,
  refreshMuteButtonLabel,
  getCurrentUserMuteInfo
}
