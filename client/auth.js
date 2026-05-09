import { USER_AUTH_TOKENS_KEY } from "./constants.js"

function getUsernameKey(username) {
  return String(username || "").trim().toLowerCase()
}

function readAuthTokens() {
  try {
    const raw = localStorage.getItem(USER_AUTH_TOKENS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function getAuthTokenForUsername(username) {
  const key = getUsernameKey(username)
  if (!key) return ""
  return String(readAuthTokens()[key] || "")
}

function storeAuthTokenForUsername(username, authToken) {
  const key = getUsernameKey(username)
  const token = String(authToken || "").trim()
  if (!key || !token) return
  try {
    const tokens = readAuthTokens()
    tokens[key] = token
    localStorage.setItem(USER_AUTH_TOKENS_KEY, JSON.stringify(tokens))
  } catch {}
}

export {
  getAuthTokenForUsername,
  storeAuthTokenForUsername
}
