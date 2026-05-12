import { socket } from "./socket.js"
import { appDebug } from "./debug.js"

const membersFetchInflight = new Map()
const membersFetchCache = new Map()
const MEMBERS_CACHE_TTL_MS = 800

function emitWithTimeout(event, payload, options = {}) {
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 6000
  const timeoutMessage = options.timeoutMessage || "Server tidak merespons"
  const failMessage = options.failMessage || "Gagal memproses request"
  const expectsOk = options.expectsOk !== false

  return new Promise((resolve, reject) => {
    const handler = (err, res) => {
      if (err) {
        appDebug("socket", "emit timeout", { event, timeoutMs })
        reject(new Error(timeoutMessage))
        return
      }
      if (expectsOk && (!res || !res.ok)) {
        appDebug("socket", "emit rejected", { event, error: res && res.error })
        reject(new Error((res && res.error) || failMessage))
        return
      }
      appDebug("socket", "emit ok", { event })
      resolve(res)
    }

    if (payload === undefined) {
      socket.timeout(timeoutMs).emit(event, handler)
      return
    }

    socket.timeout(timeoutMs).emit(event, payload, handler)
  })
}

function fetchMembersForServer(serverId, options = {}) {
  const resolvedServerId = Number(serverId)
  if (!Number.isInteger(resolvedServerId) || resolvedServerId <= 0) {
    return Promise.resolve([])
  }

  const force = Boolean(options && options.force)
  const now = Date.now()

  if (!force) {
    const cached = membersFetchCache.get(resolvedServerId)
    if (cached && now - cached.ts <= MEMBERS_CACHE_TTL_MS) {
      return Promise.resolve(Array.isArray(cached.members) ? [...cached.members] : [])
    }

    const inflight = membersFetchInflight.get(resolvedServerId)
    if (inflight) {
      return inflight.then((members) => (Array.isArray(members) ? [...members] : []))
    }
  }

  const request = emitWithTimeout(
    "list server members",
    { server_id: resolvedServerId },
    {
      timeoutMessage: "Server tidak merespons saat memuat member",
      failMessage: "Gagal memuat member"
    }
  )
    .then((res) => {
      const members = Array.isArray(res && res.members) ? res.members : []
      membersFetchCache.set(resolvedServerId, { ts: Date.now(), members })
      return members
    })
    .finally(() => {
      if (membersFetchInflight.get(resolvedServerId) === request) {
        membersFetchInflight.delete(resolvedServerId)
      }
    })

  membersFetchInflight.set(resolvedServerId, request)
  return request.then((members) => (Array.isArray(members) ? [...members] : []))
}

function fetchAuditLogsForServer(serverId) {
  return emitWithTimeout(
    "list audit logs",
    { server_id: serverId },
    {
      timeoutMessage: "Server tidak merespons saat memuat audit logs",
      failMessage: "Gagal memuat audit logs"
    }
  ).then((res) => res.logs || [])
}

function fetchServersWithTimeout() {
  return emitWithTimeout("list servers", undefined, {
    timeoutMessage: "Server tidak merespons saat memuat daftar server",
    failMessage: "Gagal memuat daftar server"
  }).then((res) => res.servers || [])
}

function setUsernameWithTimeout(nextUsername, authToken = "") {
  return emitWithTimeout("set username", { username: nextUsername, auth_token: authToken }, {
    timeoutMessage: "Server tidak merespons saat set username",
    failMessage: "Gagal set username"
  })
}

function joinServerChannelWithTimeout(serverId, channelName) {
  return emitWithTimeout(
    "join server channel",
    { server_id: serverId, channel: channelName },
    {
      timeoutMessage: "Server tidak merespons saat join channel",
      failMessage: "Gagal join channel"
    }
  )
}

function setRichStatusWithTimeout(statusPayload) {
  return emitWithTimeout("set rich status", statusPayload, {
    timeoutMessage: "Server tidak merespons saat update status",
    failMessage: "Gagal update status"
  })
}

function getChannelPermissionWithTimeout(serverId, channelName) {
  return emitWithTimeout(
    "get channel permission",
    { server_id: serverId, channel: channelName, role: "member" },
    {
      timeoutMessage: "Server tidak merespons saat ambil permission channel",
      failMessage: "Gagal ambil permission channel"
    }
  )
}

export {
  emitWithTimeout,
  fetchMembersForServer,
  fetchAuditLogsForServer,
  fetchServersWithTimeout,
  setUsernameWithTimeout,
  joinServerChannelWithTimeout,
  setRichStatusWithTimeout,
  getChannelPermissionWithTimeout
}
