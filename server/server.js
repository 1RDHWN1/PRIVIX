const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const cors = require("cors")
const path = require("path")
const sqlite3 = require("sqlite3").verbose()

const db = new sqlite3.Database("./privix.db")
const MAX_USERNAME_LENGTH = 32
const MAX_CHANNEL_LENGTH = 32
const MAX_MESSAGE_LENGTH = 2000

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : ""
}

function isValidLength(value, maxLength) {
  return value.length > 0 && value.length <= maxLength
}

// buat tabel jika belum ada
db.run(`
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  channel TEXT,
  message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`)

const app = express()
app.use(cors())
app.use(express.static(path.join(__dirname, "..", "client")))

const server = http.createServer(app)

const io = new Server(server, {
  cors: { origin: "*" }
})

io.on("connection", (socket) => {

  console.log("user connected")

  socket.data.username = ""
  socket.data.channel = ""
  socket.data.joinVersion = 0

  socket.on("set username", (rawUsername, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}

    if (typeof rawUsername !== "string") {
      reply({ ok: false, error: "Username tidak valid" })
      return
    }

    const nextUsername = normalizeText(rawUsername)
    if (!isValidLength(nextUsername, MAX_USERNAME_LENGTH)) {
      reply({ ok: false, error: `Username wajib 1-${MAX_USERNAME_LENGTH} karakter` })
      return
    }

    socket.data.username = nextUsername
    reply({ ok: true, username: nextUsername })
  })

  socket.on("join channel", (channel, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}

    if (!socket.data.username) {
      reply({ ok: false, error: "Set username dulu" })
      return
    }

    if (typeof channel !== "string") {
      reply({ ok: false, error: "Channel tidak valid" })
      return
    }
    const nextChannel = normalizeText(channel)
    if (!isValidLength(nextChannel, MAX_CHANNEL_LENGTH)) {
      reply({ ok: false, error: `Channel wajib 1-${MAX_CHANNEL_LENGTH} karakter` })
      return
    }

    const previousChannel = socket.data?.channel

    if (previousChannel) {
      socket.leave(previousChannel)
    }

    socket.join(nextChannel)
    socket.data.channel = nextChannel
    socket.data.joinVersion += 1
    const currentJoinVersion = socket.data.joinVersion

    console.log("user joined", nextChannel)

    // kirim history chat
    db.all(
      "SELECT username, channel, message, created_at FROM messages WHERE channel=? ORDER BY id DESC LIMIT 20",
      [nextChannel],
      (err, rows) => {
        if (err) {
          console.error("DB history error:", err)
          reply({ ok: false, error: "Gagal memuat history channel" })
          return
        }

        if (socket.data.channel !== nextChannel || socket.data.joinVersion !== currentJoinVersion) {
          reply({ ok: false, error: "Join channel dibatalkan" })
          return
        }

        const history = Array.isArray(rows) ? rows.reverse() : []
        reply({
          ok: true,
          channel: nextChannel,
          username: socket.data.username,
          history
        })

      }
    )

  })

  socket.on("chat message", (data) => {

    if (!data || typeof data.channel !== "string" || typeof data.message !== "string") return

    const channel = normalizeText(data.channel)
    const message = normalizeText(data.message)
    const username = socket.data.username

    if (!username) return
    if (!isValidLength(channel, MAX_CHANNEL_LENGTH)) return
    if (!isValidLength(message, MAX_MESSAGE_LENGTH)) {
      socket.emit("system error", { message: `Pesan maksimal ${MAX_MESSAGE_LENGTH} karakter` })
      return
    }
    if (socket.data.channel !== channel) return

    const createdAt = new Date().toISOString()

    // simpan ke database
    db.run(
      "INSERT INTO messages (username, channel, message, created_at) VALUES (?, ?, ?, ?)",
      [username, channel, message, createdAt],
      (err) => {
        if (err) {
          console.error("DB insert error:", err)
          socket.emit("system error", { message: "Gagal menyimpan pesan" })
        }
      }
    )

    // broadcast ke channel
    io.to(channel).emit("chat message", {
      username,
      channel,
      message,
      created_at: createdAt
    })

  })

  socket.on("disconnect", () => {
    console.log("user disconnected")
  })

})

const PORT = Number(process.env.PORT) || 3000

server.listen(PORT, () => {
  console.log(`Privix server running on port ${PORT}`)
})

server.on("error", (err) => {

  if (err && err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} sedang dipakai. Jalankan dengan port lain.`)
    return
  }

  console.error("Server error:", err)

})
