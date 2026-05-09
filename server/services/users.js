const crypto = require("crypto")
const { dbRun, dbGet } = require("../lib/db")

function buildUsernameKey(username) {
  return String(username || "").trim().toLowerCase()
}

function createAuthToken() {
  return crypto.randomBytes(32).toString("hex")
}

function hashAuthToken(authToken) {
  return crypto.createHash("sha256").update(String(authToken || "")).digest("hex")
}

function normalizeAuthToken(authToken) {
  const token = typeof authToken === "string" ? authToken.trim() : ""
  return token.length <= 256 ? token : ""
}

function isMatchingAuthToken(authToken, authTokenHash) {
  const token = normalizeAuthToken(authToken)
  const hash = typeof authTokenHash === "string" ? authTokenHash.trim() : ""
  if (!token || !hash) return false
  const tokenHash = hashAuthToken(token)
  const left = Buffer.from(tokenHash, "hex")
  const right = Buffer.from(hash, "hex")
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function usernameTakenError() {
  const error = new Error("Username sudah digunakan user lain")
  error.code = "USERNAME_TAKEN"
  return error
}

function isUniqueConstraintError(error) {
  const code = String(error && error.code ? error.code : "")
  return code === "23505" || code.includes("SQLITE_CONSTRAINT")
}

async function getUserByUsernameKey(usernameKey) {
  return dbGet(
    "SELECT id, username, username_key, auth_token_hash FROM users WHERE username_key = ? OR LOWER(username) = ? LIMIT 1",
    [usernameKey, usernameKey]
  )
}

async function createUser(username, usernameKey) {
  const authToken = createAuthToken()
  const authTokenHash = hashAuthToken(authToken)
  await dbRun(
    "INSERT INTO users (username, username_key, auth_token_hash) VALUES (?, ?, ?)",
    [username, usernameKey, authTokenHash]
  )
  const user = await getUserByUsernameKey(usernameKey)
  return { user, authToken }
}

async function claimLegacyUser(user) {
  const authToken = createAuthToken()
  const authTokenHash = hashAuthToken(authToken)
  const result = await dbRun(
    "UPDATE users SET username_key = COALESCE(NULLIF(username_key, ''), LOWER(username)), auth_token_hash = ? WHERE id = ? AND (auth_token_hash IS NULL OR auth_token_hash = '')",
    [authTokenHash, user.id]
  )
  if (!result || result.changes !== 1) {
    throw usernameTakenError()
  }
  return { user, authToken }
}

async function ensureUser(username, authToken = "") {
  const usernameKey = buildUsernameKey(username)
  let user = await getUserByUsernameKey(usernameKey)

  if (!user) {
    try {
      return await createUser(username, usernameKey)
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error
      }
      user = await getUserByUsernameKey(usernameKey)
      if (!user) throw error
    }
  }

  if (!user.username_key) {
    try {
      await dbRun("UPDATE users SET username_key = ? WHERE id = ?", [usernameKey, user.id])
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error
      }
    }
  }

  if (!user.auth_token_hash) {
    return claimLegacyUser(user)
  }

  if (!isMatchingAuthToken(authToken, user.auth_token_hash)) {
    throw usernameTakenError()
  }

  return { user, authToken: "" }
}

module.exports = {
  buildUsernameKey,
  ensureUser
}
