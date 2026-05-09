import { channelList, channelSelect, mobileBackBtn } from "./dom.js"

const MOBILE_BREAKPOINT = 760
let viewportSyncFrame = 0

function isMobileLayout() {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches
}

function syncViewportCssVars() {
  const root = document.documentElement
  if (!root) return

  const viewport = window.visualViewport
  const viewportHeight = Math.round(viewport ? viewport.height : window.innerHeight)
  const viewportWidth = Math.round(viewport ? viewport.width : window.innerWidth)

  root.style.setProperty("--app-height", `${viewportHeight}px`)
  root.style.setProperty("--app-width", `${viewportWidth}px`)
}

function scheduleViewportSync() {
  if (viewportSyncFrame) return
  viewportSyncFrame = requestAnimationFrame(() => {
    viewportSyncFrame = 0
    syncViewportCssVars()
    if (!isMobileLayout()) {
      setMobileView("channels")
    }
  })
}

function setMobileView(view) {
  const appRoot = document.querySelector(".app")
  if (!appRoot) return

  if (!isMobileLayout()) {
    appRoot.classList.remove("is-mobile-chat")
    return
  }

  if (view === "chat") {
    appRoot.classList.add("is-mobile-chat")
  } else {
    appRoot.classList.remove("is-mobile-chat")
  }
}

function initMobileNav() {
  const handleToChat = () => setMobileView("chat")
  const handleToChannels = (event) => {
    if (event) event.preventDefault()
    setMobileView("channels")
  }

  if (channelList) {
    channelList.addEventListener("click", (event) => {
      const target = event.target.closest(".channel-item")
      if (!target) return
      handleToChat()
    })
  }

  if (channelSelect) {
    channelSelect.addEventListener("change", () => {
      handleToChat()
    })
  }

  if (mobileBackBtn) {
    mobileBackBtn.addEventListener("click", handleToChannels)
  }

  window.addEventListener("resize", scheduleViewportSync, { passive: true })
  window.addEventListener("orientationchange", scheduleViewportSync, { passive: true })
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleViewportSync, { passive: true })
    window.visualViewport.addEventListener("scroll", scheduleViewportSync, { passive: true })
  }

  scheduleViewportSync()
}

export { initMobileNav, setMobileView }
