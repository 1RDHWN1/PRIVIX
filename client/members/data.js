import { memberFilterInput } from "../dom.js"
import { state } from "../state.js"
import { renderMembers } from "./render.js"

function getFilteredMembers() {
  const query = String((memberFilterInput && memberFilterInput.value) || "")
    .trim()
    .toLowerCase()
  if (!query) return [...state.membersCache]

  return state.membersCache.filter((item) => {
    const usernameText = String((item && item.username) || "").toLowerCase()
    const roleText = String((item && item.role_name) || "member").toLowerCase()
    return usernameText.includes(query) || roleText.includes(query)
  })
}

function setMembers(members) {
  state.membersCache = Array.isArray(members) ? members : []
  renderMembers(getFilteredMembers())
}

export { getFilteredMembers, setMembers }
