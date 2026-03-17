# Roadmap Privix

Ringkasan progress saat ini:
- Phase 1 selesai.
- Phase 2 selesai.
- Codebase client/server sudah direfactor agar modul lebih kecil dan logic tidak menumpuk di satu file.

## Phase 1 — Core Chat Engine (DONE)
Fondasi aplikasi chat.

Fitur:
- Realtime messaging
- Channel system
- Username
- SQLite database
- Chat history
- Basic UI

Teknologi:
- Node.js
- Socket.IO
- SQLite

Status: DONE

## Phase 2 — Community Platform (seperti Discord) (DONE)
Privix berubah dari chat app → platform komunitas.

Fitur:
- Server/komunitas
- Channel per server (#general, #memes, dll.)
- Invite link (contoh: privix.gg/abc123)
- Role system (admin, moderator, member)

Status: DONE

## Phase 4 — Private Messaging
Mode seperti messenger.

Fitur:
- DM antar user
- Group kecil
- Message encryption (opsional)

Target waktu: 1 minggu
Status: TODO

## Phase 3 — Voice Chat
Fitur paling kompleks.

Teknologi:
- WebRTC

Fitur:
- Voice channel
- Mute/unmute
- Basic audio streaming

Target waktu: 2–3 minggu
Status: TODO

## Phase 5 — Production Ready
Agar Privix siap dipakai publik.

Upgrade:
- Database upgrade (SQLite → PostgreSQL)
- Deployment

Target platform:
- Backend: Render atau Railway
- Frontend: Vercel

Status: TODO

## Phase 6 — Growth Features
Saat user mulai banyak.

Fitur:
- Emoji reactions
- File upload
- Message edit/delete
- Search message
- Moderation tools

Status: TODO

## Phase 7 — Mobile App
Jika Privix benar-benar dipakai orang.

Framework:
- React Native

Status: TODO
