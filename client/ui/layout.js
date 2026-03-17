function renderListWithTransition(container, renderFn) {
  if (!container || typeof renderFn !== "function") return
  if (container.__refreshTimer) {
    clearTimeout(container.__refreshTimer)
  }

  container.classList.add("is-refreshing")
  container.__refreshTimer = setTimeout(() => {
    const fragment = document.createDocumentFragment()
    renderFn(fragment)
    container.innerHTML = ""
    container.appendChild(fragment)
    requestAnimationFrame(() => {
      container.classList.remove("is-refreshing")
    })
  }, 85)
}

function setElementHidden(element, hidden) {
  if (!element) return
  const shouldHide = Boolean(hidden)
  element.classList.toggle("is-collapsed", shouldHide)
  element.setAttribute("aria-hidden", shouldHide ? "true" : "false")
}

function setSoftButtonHidden(button, hidden) {
  if (!button) return
  const shouldHide = Boolean(hidden)
  button.classList.toggle("is-soft-hidden", shouldHide)
  button.setAttribute("aria-hidden", shouldHide ? "true" : "false")
  if (shouldHide) {
    button.setAttribute("tabindex", "-1")
  } else {
    button.removeAttribute("tabindex")
  }
}

export { renderListWithTransition, setElementHidden, setSoftButtonHidden }
