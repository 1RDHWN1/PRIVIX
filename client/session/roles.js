import {
  memberList,
  auditList,
  memberFilterInput,
  auditFilterSelect,
  auditSearchInput,
  muteDurationSelect,
  muteReasonInput
} from "../dom.js"
import { state } from "../state.js"
import { refreshMuteButtonLabel } from "../members.js"

function clearRolePanels() {
  if (memberList.__refreshTimer) {
    clearTimeout(memberList.__refreshTimer)
    memberList.__refreshTimer = null
  }
  if (auditList.__refreshTimer) {
    clearTimeout(auditList.__refreshTimer)
    auditList.__refreshTimer = null
  }
  memberList.classList.remove("is-refreshing")
  auditList.classList.remove("is-refreshing")
  state.membersCache = []
  state.auditLogsCache = []
  if (memberFilterInput) {
    memberFilterInput.value = ""
  }
  if (auditFilterSelect) {
    auditFilterSelect.value = "all"
  }
  if (auditSearchInput) {
    auditSearchInput.value = ""
  }
  if (muteDurationSelect) {
    muteDurationSelect.value = "10"
  }
  if (muteReasonInput) {
    muteReasonInput.value = ""
  }
  refreshMuteButtonLabel()
  memberList.innerHTML = ""
  auditList.innerHTML = ""
  const memberEmpty = document.createElement("div")
  memberEmpty.className = "list-empty"
  memberEmpty.textContent = "-"
  memberList.appendChild(memberEmpty)
  const auditEmpty = document.createElement("div")
  auditEmpty.className = "list-empty"
  auditEmpty.textContent = "-"
  auditList.appendChild(auditEmpty)
}

export { clearRolePanels }
