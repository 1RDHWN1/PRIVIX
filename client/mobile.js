import { channelList, channelSelect, mobileBackBtn } from "./dom.js"

const MOBILE_BREAKPOINT = 760

function isMobileLayout() {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches
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

  const handleResize = () => {
    if (!isMobileLayout()) {
      setMobileView("channels")
    }
  }

  window.addEventListener("resize", handleResize)
  handleResize()
}

export { initMobileNav, setMobileView }
