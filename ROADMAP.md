# Roadmap Privix

Ringkasan progress saat ini:
- Phase 1 selesai.
- Phase 2 selesai.
- Codebase client/server sudah direfactor agar modul lebih kecil dan logic tidak menumpuk di satu file.
- Phase 3 (Voice Channel) sudah masuk tahap stabilisasi: realtime voice, presence, quality monitor, reconnect logic, push-to-talk, device settings, mobile UI, dan TURN config sudah berjalan.

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

## Phase 3 — Voice Channel
Fitur paling kompleks.

Teknologi:
- WebRTC

Fitur:
- Voice channel (DONE)
- Join/leave realtime + presence update untuk non-join viewer (DONE)
- Mute/unmute + mute indicator terlihat oleh peserta lain (DONE)
- Basic audio streaming (DONE)
- Voice roster + voice stage UI + speaking indicator + notif join/leave (DONE)
- Input/output device selection + volume controls (DONE)
- Push-to-talk (DONE)
- Stabilitas NAT/TURN readiness + env/script bootstrap (DONE)
- Quality monitoring + reconnect logic (DONE)
- Sinkronisasi timer sesi room voice (DONE)
- Voice channel settings (PARTIAL, perapihan lanjutan UI/UX)
- Mobile responsive untuk panel chat/voice/admin (PARTIAL, ongoing polishing)

Target waktu: 2–3 minggu
Status: IN PROGRESS (stabilization)

## Phase 4 — Private Messaging
Mode seperti messenger.

Fitur:
- DM antar user
- Group kecil
- Message encryption (opsional)

Target waktu: 1 minggu
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
