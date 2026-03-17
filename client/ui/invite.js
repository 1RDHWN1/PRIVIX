import { inviteCodeInput, invitePreview } from "../dom.js"
import { state } from "../state.js"
import { buildInviteUrl } from "../utils.js"

function focusInviteInput() {
  try {
    inviteCodeInput.scrollIntoView({ behavior: "smooth", block: "center" })
  } catch {}
  inviteCodeInput.focus()
  inviteCodeInput.select()
}

function setInvitePreview(code) {
  state.inviteShareUrl = code ? buildInviteUrl(code) : ""
  invitePreview.textContent = state.inviteShareUrl ? `Invite: ${state.inviteShareUrl}` : ""
}

export { focusInviteInput, setInvitePreview }
