const { dbRun, dbGet } = require("../lib/db")

async function ensureUser(username) {
  await dbRun("INSERT OR IGNORE INTO users (username) VALUES (?)", [username])
  const user = await dbGet("SELECT id, username FROM users WHERE username = ?", [username])
  return user
}

module.exports = {
  ensureUser
}
