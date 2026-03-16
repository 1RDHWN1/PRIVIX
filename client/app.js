const socket = io("http://localhost:3000")

let username = ""
let isSessionReady = false
let sessionRequestId = 0
const USERNAME_KEY = "privix_username"
const CHANNEL_KEY = "privix_channel"
const MAX_MESSAGE_LENGTH = 2000

const msgInput = document.getElementById("msg")
const sendBtn = document.getElementById("send-btn")
const channelSelect = document.getElementById("channel")
const messages = document.getElementById("messages")
const usernameInput = document.getElementById("username")
const connectionStatus = document.getElementById("connection-status")

username = localStorage.getItem(USERNAME_KEY) || ""
usernameInput.value = username

const savedChannel = localStorage.getItem(CHANNEL_KEY)
if (savedChannel && [...channelSelect.options].some(opt => opt.value === savedChannel)) {
  channelSelect.value = savedChannel
}

function setStatus(text, isReady = false) {
  if (!connectionStatus) return
  connectionStatus.textContent = text
  connectionStatus.dataset.state = isReady ? "ready" : "pending"
}

function formatTime(isoString) {
  if (!isoString) return ""
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function renderMessage(data) {
  const div = document.createElement("div")

  const user = document.createElement("b")
  user.textContent = data.username + ": "

  const text = document.createElement("span")
  text.textContent = data.message

  const time = document.createElement("small")
  const friendlyTime = formatTime(data.created_at)
  time.textContent = friendlyTime ? ` (${friendlyTime})` : ""

  div.appendChild(user)
  div.appendChild(text)
  div.appendChild(time)
  messages.appendChild(div)
}

function startSessionForSelectedChannel(showAlertOnMissingUsername = true, onReady) {
  const requestId = ++sessionRequestId
  const nextUsername = usernameInput.value.trim()
  setStatus("Joining channel...", false)

  if (!socket.connected) {
    isSessionReady = false
    setStatus("Disconnected", false)
    alert("Server chat belum terhubung. Jalankan server di port 3000 lalu refresh.")
    return
  }

  if (!nextUsername) {
    isSessionReady = false
    setStatus("Username required", false)
    if (showAlertOnMissingUsername) {
      alert("Masukkan username dulu")
    }
    return
  }

  socket.timeout(2000).emit("set username", nextUsername, (err, res) => {
    if (requestId !== sessionRequestId) return

    if (err) {
      alert("Server tidak merespons saat set username. Coba restart server lalu refresh.")
      isSessionReady = false
      setStatus("Set username timeout", false)
      return
    }

    if (!res || !res.ok) {
      alert((res && res.error) || "Gagal set username")
      isSessionReady = false
      setStatus("Set username failed", false)
      return
    }

    username = res.username
    localStorage.setItem(USERNAME_KEY, username)

    socket.timeout(2000).emit("join channel", channelSelect.value, (joinErr, joinRes) => {
      if (requestId !== sessionRequestId) return

      if (joinErr) {
        alert("Server tidak merespons saat join channel. Coba restart server lalu refresh.")
        isSessionReady = false
        setStatus("Join timeout", false)
        return
      }

      if (!joinRes || !joinRes.ok) {
        alert((joinRes && joinRes.error) || "Gagal join channel")
        isSessionReady = false
        setStatus("Join failed", false)
        return
      }

      const historyMessages = Array.isArray(joinRes.history) ? joinRes.history : []
      messages.innerHTML = ""
      historyMessages.forEach(renderMessage)
      messages.scrollTop = messages.scrollHeight

      isSessionReady = true
      setStatus(`Connected • #${channelSelect.value}`, true)
      msgInput.focus()
      if (typeof onReady === "function") {
        onReady()
      }
    })
  })
}

channelSelect.addEventListener("change", () => {
  localStorage.setItem(CHANNEL_KEY, channelSelect.value)
  messages.innerHTML = ""
  startSessionForSelectedChannel(true)
})

function send(){

  if(!isSessionReady){
    startSessionForSelectedChannel(true, send)
    return
  }

  const msg = msgInput.value.trim()
  if(!msg) return
  if (msg.length > MAX_MESSAGE_LENGTH) {
    alert(`Pesan maksimal ${MAX_MESSAGE_LENGTH} karakter`)
    return
  }

  socket.emit("chat message",{
    channel: channelSelect.value,
    message: msg
  })

  msgInput.value = ""
  msgInput.focus()

}

sendBtn.addEventListener("click", (e) => {
  e.preventDefault()
  send()
})

msgInput.addEventListener("keydown",(e)=>{
  if(e.key === "Enter"){
    e.preventDefault()
    send()
  }
})

socket.on("chat message",(data)=>{
  if (!data || data.channel !== channelSelect.value) return

  renderMessage(data)

  messages.scrollTop = messages.scrollHeight

})

socket.on("connect", () => {
  setStatus("Connected", false)
  startSessionForSelectedChannel(false)
})

socket.on("disconnect", () => {
  sessionRequestId += 1
  isSessionReady = false
  setStatus("Disconnected", false)
})

socket.on("connect_error", () => {
  sessionRequestId += 1
  isSessionReady = false
  setStatus("Connection error", false)
})

socket.on("system error", (payload) => {
  if (!payload || !payload.message) return
  alert(payload.message)
})

usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault()
    startSessionForSelectedChannel(true)
  }
})
