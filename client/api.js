import { socket } from "./socket.js"

function emitWithTimeout(event, payload, options = {}) {
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 2000
  const timeoutMessage = options.timeoutMessage || "Server tidak merespons"
  const failMessage = options.failMessage || "Gagal memproses request"
  const expectsOk = options.expectsOk !== false

  return new Promise((resolve, reject) => {
    const handler = (err, res) => {
      if (err) {
        reject(new Error(timeoutMessage))
        return
      }
      if (expectsOk && (!res || !res.ok)) {
        reject(new Error((res && res.error) || failMessage))
        return
      }
      resolve(res)
    }

    if (payload === undefined) {
      socket.timeout(timeoutMs).emit(event, handler)
      return
    }

    socket.timeout(timeoutMs).emit(event, payload, handler)
  })
}

function fetchMembersForServer(serverId) {
  return emitWithTimeout(
    "list server members",
    { server_id: serverId },
    {
      timeoutMessage: "Server tidak merespons saat memuat member",
      failMessage: "Gagal memuat member"
    }
  ).then((res) => res.members || [])
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

function setUsernameWithTimeout(nextUsername) {
  return emitWithTimeout("set username", nextUsername, {
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
  getChannelPermissionWithTimeout
}
