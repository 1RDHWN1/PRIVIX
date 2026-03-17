const { dbAll } = require("../lib/db")

async function getMemberServers(userId) {
  return dbAll(
    `
    SELECT
      s.id,
      s.name,
      s.owner_user_id,
      s.created_at,
      COALESCE(r.name, 'member') AS current_role_name,
      COALESCE(r.priority, 0) AS current_role_priority
    FROM server_members sm
    JOIN servers s ON s.id = sm.server_id
    LEFT JOIN roles r ON r.id = sm.role_id
    WHERE sm.user_id = ?
    ORDER BY s.id ASC
    `,
    [userId]
  )
}

async function getServerChannels(serverId) {
  return dbAll(
    `
    SELECT id, name, type
    FROM channels
    WHERE server_id = ?
    ORDER BY CASE WHEN name = 'general' THEN 0 ELSE 1 END, name ASC
    `,
    [serverId]
  )
}

module.exports = {
  getMemberServers,
  getServerChannels
}
