import {
  activeChannelPresence,
  channelList,
  channelSelect,
  mobileBackBtn,
  mobileMembersBackdrop,
  mobileMembersBtn,
  mobileMembersCloseBtn
} from "./dom.js"

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
      setMobileMembersOpen(false)
    }
  })
}

function showChatIfChannelReady() {
  if (!isMobileLayout()) return
  if (channelSelect && channelSelect.value) {
    setMobileView("chat")
  }
}

function setMobileView(view) {
  const appRoot = document.querySelector(".app")
  if (!appRoot) return

  if (!isMobileLayout()) {
    appRoot.classList.remove("is-mobile-chat")
    setMobileMembersOpen(false)
    return
  }

  if (view === "chat") {
    appRoot.classList.add("is-mobile-chat")
  } else {
    appRoot.classList.remove("is-mobile-chat")
    setMobileMembersOpen(false)
  }
}

function setMobileMembersOpen(isOpen) {
  const appRoot = document.querySelector(".app")
  if (!appRoot) return

  const shouldOpen = Boolean(isOpen && isMobileLayout())
  appRoot.classList.toggle("is-mobile-members-open", shouldOpen)

  if (mobileMembersBtn) {
    mobileMembersBtn.setAttribute("aria-expanded", shouldOpen ? "true" : "false")
  }
  if (mobileMembersBackdrop) {
    mobileMembersBackdrop.setAttribute("aria-hidden", shouldOpen ? "false" : "true")
  }
}

function toggleMobileMembers() {
  const appRoot = document.querySelector(".app")
  const isOpen = Boolean(appRoot && appRoot.classList.contains("is-mobile-members-open"))
  setMobileMembersOpen(!isOpen)
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
  if (mobileMembersBtn) {
    mobileMembersBtn.addEventListener("click", (event) => {
      event.preventDefault()
      toggleMobileMembers()
    })
  }
  if (activeChannelPresence) {
    activeChannelPresence.addEventListener("click", toggleMobileMembers)
  }
  if (mobileMembersBackdrop) {
    mobileMembersBackdrop.addEventListener("click", () => setMobileMembersOpen(false))
  }
  if (mobileMembersCloseBtn) {
    mobileMembersCloseBtn.addEventListener("click", (event) => {
      event.preventDefault()
      setMobileMembersOpen(false)
    })
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setMobileMembersOpen(false)
    }
  })

  window.addEventListener("resize", scheduleViewportSync, { passive: true })
  window.addEventListener("orientationchange", scheduleViewportSync, { passive: true })
  window.addEventListener("privix:channel-ready", showChatIfChannelReady)
  window.addEventListener("privix:no-channel", () => {
    setMobileMembersOpen(false)
    setMobileView("channels")
  })
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleViewportSync, { passive: true })
    window.visualViewport.addEventListener("scroll", scheduleViewportSync, { passive: true })
  }

  scheduleViewportSync()
  requestAnimationFrame(showChatIfChannelReady)
}

export { initMobileNav, setMobileView }
