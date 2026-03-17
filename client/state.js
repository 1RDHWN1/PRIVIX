const state = {
  username: "",
  currentUserId: null,
  isSessionReady: false,
  sessionRequestId: 0,
  serversCache: [],
  membersCache: [],
  auditLogsCache: [],
  inviteShareUrl: "",
  pendingInviteCodeFromUrl: "",
  inviteAutoJoinAttempted: false,
  typingStopTimer: null,
  isTypingSent: false,
  typingUsers: new Set()
}

export { state }
