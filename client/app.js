import { USERNAME_KEY } from "./constants.js"
import { inviteCodeInput, usernameInput } from "./dom.js"
import { state } from "./state.js"
import { wireNoticeEvents } from "./notice.js"
import {
  setAutoJoinInviteHandler,
  updateChannelActionState,
  clearRolePanels,
  getActiveServer
} from "./session.js"
import {
  handleSetMemberRole,
  handleKickMember,
  handleMuteMember,
  handleUnmuteMember,
  handleJoinInvite
} from "./actions.js"
import { configureMembers } from "./members.js"
import { bindUiHandlers, bindSocketHandlers } from "./handlers.js"
import { resetTypingState } from "./typing.js"

state.username = localStorage.getItem(USERNAME_KEY) || ""
usernameInput.value = state.username
try {
  const inviteCode = new URLSearchParams(window.location.search).get("invite")
  if (inviteCode) {
    state.pendingInviteCodeFromUrl = String(inviteCode).trim().toUpperCase()
    inviteCodeInput.value = state.pendingInviteCodeFromUrl
  }
} catch {}

setAutoJoinInviteHandler(handleJoinInvite)
configureMembers({
  getActiveServer,
  handlers: {
    setMemberRole: handleSetMemberRole,
    kickMember: handleKickMember,
    muteMember: handleMuteMember,
    unmuteMember: handleUnmuteMember
  }
})

wireNoticeEvents()
bindUiHandlers()
bindSocketHandlers()

updateChannelActionState()
resetTypingState()
clearRolePanels()
