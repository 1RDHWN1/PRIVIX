function isDebugEnabled(scope = "app") {
  try {
    if (typeof window !== "undefined" && window.PRIVIX_DEBUG === true) return true
    if (typeof localStorage !== "undefined") {
      if (localStorage.getItem("privix:debug") === "1") return true
      if (localStorage.getItem(`privix:${scope}:debug`) === "1") return true
    }
  } catch {}
  return false
}

function appDebug(scope, event, details = null) {
  const normalizedScope = String(scope || "app")
  if (!isDebugEnabled(normalizedScope)) return
  const timestamp = new Date().toISOString()
  const prefix = `[privix-debug][${normalizedScope}][${timestamp}] ${event}`
  if (details === null || typeof details === "undefined") {
    console.log(prefix)
    return
  }
  console.log(prefix, details)
}

try {
  if (typeof window !== "undefined" && !window.privixDebug) {
    window.privixDebug = {
      enable(scope = "app") {
        try {
          localStorage.setItem(scope === "all" ? "privix:debug" : `privix:${scope}:debug`, "1")
        } catch {}
        window.PRIVIX_DEBUG = true
      },
      disable(scope = "app") {
        try {
          localStorage.removeItem(scope === "all" ? "privix:debug" : `privix:${scope}:debug`)
        } catch {}
        if (scope === "all" || scope === "app") {
          window.PRIVIX_DEBUG = false
        }
      },
      status(scope = "app") {
        return isDebugEnabled(scope)
      }
    }
  }
} catch {}

export { isDebugEnabled, appDebug }
