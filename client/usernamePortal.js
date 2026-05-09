import { usernamePortal, usernamePortalInput, usernamePortalBtn, usernamePortalError, usernameInput } from "./dom.js"
import { USERNAME_KEY } from "./constants.js"
import { state } from "./state.js"
import { startSessionForSelectedChannel } from "./session.js"

function showPortal() {
  if (!usernamePortal) return
  usernamePortal.classList.add("show")
  usernamePortal.setAttribute("aria-hidden", "false")
  if (usernamePortalInput) {
    usernamePortalInput.focus()
  }
}

function hidePortal() {
  if (!usernamePortal) return
  usernamePortal.classList.remove("show")
  usernamePortal.setAttribute("aria-hidden", "true")
}

function setError(message) {
  if (usernamePortalError) {
    usernamePortalError.textContent = message || ""
  }
}

async function handleSubmit() {
  if (!usernamePortalInput || !usernamePortalBtn || !usernameInput) return
  const nextUsername = usernamePortalInput.value.trim()
  if (!nextUsername) {
    setError("Username wajib diisi.")
    return
  }

  usernameInput.value = nextUsername
  setError("")
  usernamePortalBtn.disabled = true
  const originalText = usernamePortalBtn.textContent
  usernamePortalBtn.textContent = "Loading..."

  const result = await startSessionForSelectedChannel(true, () => {
    hidePortal()
  })

  if (state.username) {
    try {
      localStorage.setItem(USERNAME_KEY, state.username)
    } catch {}
    hidePortal()
  } else {
    setError((result && result.error) || "Gagal masuk. Coba username lain.")
    usernamePortalBtn.disabled = false
    usernamePortalBtn.textContent = originalText
  }
}

function initUsernamePortal() {
  if (!usernamePortal || !usernamePortalInput || !usernamePortalBtn) return

  const stored = localStorage.getItem(USERNAME_KEY)
  if (stored) {
    hidePortal()
  } else {
    showPortal()
  }

  usernamePortalInput.addEventListener("input", () => {
    setError("")
  })

  usernamePortalInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault()
      handleSubmit()
    }
  })

  usernamePortalBtn.addEventListener("click", (event) => {
    event.preventDefault()
    handleSubmit()
  })
}

export { initUsernamePortal }
