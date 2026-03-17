import {
  noticeBackdrop,
  noticeCard,
  noticeTitle,
  noticeMessage,
  noticeAction,
  noticeOk,
  connectionStatus
} from "./dom.js"

let noticeActionHandler = null
let noticeCloseHandler = null

function setStatus(text, isReady = false) {
  if (!connectionStatus) return
  connectionStatus.textContent = text
  connectionStatus.dataset.state = isReady ? "ready" : "pending"
}

function notify(message, type = "info", options = {}) {
  if (!noticeBackdrop || !noticeCard || !noticeMessage || !noticeTitle) return
  const wasOpen = noticeBackdrop.classList.contains("show")
  const previousCloseHandler = noticeCloseHandler
  if (wasOpen && typeof previousCloseHandler === "function") {
    previousCloseHandler()
  }

  const title =
    String(options && options.title) ||
    (type === "success" ? "Success" : type === "error" ? "Error" : "Info")
  noticeTitle.textContent = title
  noticeMessage.textContent = message
  noticeCard.className = `notice-card ${type}`
  if (noticeOk) {
    noticeOk.textContent = String((options && options.okLabel) || "OK")
  }

  const actionLabel = String(options && options.actionLabel ? options.actionLabel : "").trim()
  const onAction = options && typeof options.onAction === "function" ? options.onAction : null
  const onClose = options && typeof options.onClose === "function" ? options.onClose : null
  noticeActionHandler = onAction
  noticeCloseHandler = onClose
  if (noticeAction) {
    const showAction = Boolean(actionLabel && onAction)
    noticeAction.textContent = actionLabel
    noticeAction.classList.toggle("is-hidden", !showAction)
    noticeAction.disabled = !showAction
  }

  noticeBackdrop.classList.add("show")
  noticeBackdrop.setAttribute("aria-hidden", "false")
}

function closeNotice(invokeCloseHandler = true) {
  if (!noticeBackdrop) return
  const closeHandler = noticeCloseHandler
  noticeBackdrop.classList.remove("show")
  noticeBackdrop.setAttribute("aria-hidden", "true")
  noticeActionHandler = null
  noticeCloseHandler = null
  if (noticeOk) {
    noticeOk.textContent = "OK"
  }
  if (noticeAction) {
    noticeAction.classList.add("is-hidden")
    noticeAction.textContent = ""
    noticeAction.disabled = true
  }
  if (invokeCloseHandler && typeof closeHandler === "function") {
    closeHandler()
  }
}

function confirmNotice(message, options = {}) {
  return new Promise((resolve) => {
    let settled = false
    const settle = (result) => {
      if (settled) return
      settled = true
      resolve(Boolean(result))
    }

    notify(message, String(options.type || "info"), {
      title: String(options.title || "Confirm"),
      okLabel: String(options.cancelLabel || "Cancel"),
      actionLabel: String(options.confirmLabel || "Confirm"),
      onAction: () => {
        settle(true)
      },
      onClose: () => {
        settle(false)
      }
    })
  })
}

function wireNoticeEvents() {
  if (noticeOk) {
    noticeOk.addEventListener("click", () => {
      closeNotice(true)
    })
  }

  if (noticeAction) {
    noticeAction.addEventListener("click", () => {
      const action = noticeActionHandler
      closeNotice(false)
      if (typeof action === "function") {
        action()
      }
    })
  }

  if (noticeBackdrop) {
    noticeBackdrop.addEventListener("click", (e) => {
      if (e.target === noticeBackdrop) {
        closeNotice(true)
      }
    })
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeNotice(true)
    }
  })
}

export { setStatus, notify, closeNotice, confirmNotice, wireNoticeEvents }
