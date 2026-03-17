let resolveActiveServerFn = () => null
let memberHandlers = {
  setMemberRole: null,
  kickMember: null,
  muteMember: null,
  unmuteMember: null
}

function configureMembers(options = {}) {
  if (typeof options.getActiveServer === "function") {
    resolveActiveServerFn = options.getActiveServer
  }
  if (options.handlers) {
    memberHandlers = { ...memberHandlers, ...options.handlers }
  }
}

function resolveActiveServer() {
  return resolveActiveServerFn()
}

function getMemberHandlers() {
  return memberHandlers
}

export { configureMembers, resolveActiveServer, getMemberHandlers }
