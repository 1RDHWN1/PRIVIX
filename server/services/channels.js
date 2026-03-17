const { dbGet } = require("../lib/db")

function buildRoomKey(serverId, channelName) {
  return `s:${serverId}:c:${channelName}`
}

async function getChannelPermission(channelId, roleName) {
  return dbGet(
    `
    SELECT can_view, can_send
    FROM channel_permissions
    WHERE channel_id = ? AND role_name = ?
    LIMIT 1
    `,
    [channelId, roleName]
  )
}

module.exports = {
  buildRoomKey,
  getChannelPermission
}
