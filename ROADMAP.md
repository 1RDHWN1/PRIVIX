# Roadmap Privix

Roadmap ini disusun agar bisa dipakai sebagai acuan produk sekaligus eksekusi engineering. Fokus utamanya bukan hanya daftar fitur, tetapi urutan kerja yang realistis, kriteria selesai yang jelas, dan risiko yang perlu dikendalikan lebih awal.

## Ringkasan Status Saat Ini

- Phase 1 selesai.
- Phase 2 selesai.
- Codebase client/server sudah direfactor agar modul lebih kecil dan logic tidak menumpuk di satu file.
- Phase 3 (Voice + On-Cam) selesai dan scope sudah di-freeze.
- Voice stage UI sudah stabil di desktop/mobile (focus speaker, tile ratio kamera, dock/settings responsive).
- Prioritas terdekat: lanjut ke Phase 4 (production foundation) dengan mode maintenance untuk bugfix voice non-blocker.

## Prinsip Prioritas

Urutan kerja yang dipakai:

1. Stabilkan fitur inti yang sudah ada.
2. Kuatkan fondasi production dan deployment.
3. Tambahkan fitur komunikasi utama berikutnya.
4. Tambahkan growth features setelah fondasi cukup aman.
5. Masuk ke mobile app ketika web experience dan backend sudah stabil.

Alasan urutan ini:

- Voice dan on-cam adalah area paling kompleks dan paling berisiko secara teknis.
- Production readiness tidak boleh datang terlambat karena akan memengaruhi semua fase setelahnya.
- Fitur seperti DM, upload, dan search akan lebih aman dibangun di atas backend yang lebih siap.

---

## Phase 1 - Core Chat Engine

Tujuan:
- Membangun fondasi aplikasi chat realtime.

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

Status:
- DONE

Kriteria selesai:
- Chat realtime stabil
- Riwayat pesan tersimpan
- Struktur channel dasar berfungsi

---

## Phase 2 - Community Platform

Tujuan:
- Mengubah Privix dari chat app menjadi platform komunitas.

Fitur:
- Server/komunitas
- Channel per server (`#general`, `#memes`, dll.)
- Invite link (contoh: `privix.gg/abc123`)
- Role system (`admin`, `moderator`, `member`)

Status:
- DONE

Kriteria selesai:
- User bisa bergabung ke server melalui invite
- Role dasar bekerja
- Channel terisolasi per server

---

## Phase 3 - Voice + On-Cam

Tujuan:
- Menyediakan pengalaman voice dan on-cam yang stabil dan nyaman dipakai harian.

Teknologi:
- WebRTC

Status:
- DONE (closed)

Progress fitur:
- Voice channel (DONE)
- Join/leave realtime + presence update untuk non-join viewer (DONE)
- Mute/unmute + mute indicator terlihat oleh peserta lain (DONE)
- Basic audio streaming (DONE)
- On-cam / camera streaming dasar (DONE)
- Camera state sync antar peserta (DONE)
- Voice roster + voice stage UI + speaking indicator + notif join/leave (DONE)
- Video tile / participant video rendering (DONE)
- Input/output device selection + volume controls (DONE)
- Camera device selection + quality settings + camera flip (DONE)
- Push-to-talk (DONE)
- Stabilitas NAT/TURN readiness + env/script bootstrap (DONE)
- Quality monitoring + reconnect logic (DONE)
- Sinkronisasi timer sesi room voice (DONE)
- Voice and camera settings UI/UX (DONE, termasuk popover + dock behavior)
- Mobile responsive untuk panel chat/voice/admin (DONE, ongoing QA)
- Focus speaker mode + toggle layout grid/focus (DONE)
- Fokus speaker tidak memotong participant list (DONE)
- Rasio tile participant mengikuti rasio kamera aktif (DONE)
- Speaking animation smoothing + quality badge per tile (DONE)
- Auto-join voice toggle dihapus untuk simplify UX (DONE)

Target:
- Menutup fase ini dengan quality bar yang jelas, bukan terus menambah fitur kecil tanpa batas.

Definition of done:
- Join/leave voice stabil pada reconnect dan network change
- Device switching tidak memutus pengalaman user secara tidak terduga
- Push-to-talk dan mute state sinkron antar peserta
- Toggle camera dan camera state sinkron antar peserta
- Render video participant stabil tanpa merusak roster dan layout room
- Camera quality/device switching aman dipakai saat sesi berjalan
- Viewer presence konsisten untuk user yang tidak join voice
- Mobile layout untuk panel voice/chat/admin usable tanpa layout break mayor
- Focus speaker layout tetap menampilkan participant lain tanpa clipping saat room ramai
- Tidak ada bug blocker untuk alur join, listen, speak, mute, camera on/off, leave

Risiko utama:
- Bug edge case WebRTC dapat memperpanjang fase ini bila scope stabilisasi tidak dibatasi
- Perbedaan device/browser bisa memunculkan regresi yang sulit dilacak
- Fitur camera menambah beban bandwidth, rendering, dan kompleksitas device compatibility
- Polishing UI mobile bisa melebar jadi pekerjaan desain penuh

Next actions:
- Mode maintenance: hanya bugfix voice/on-cam jika ada regresi kritikal
- Lanjutkan handoff engineering ke Phase 4 (production foundation)
- Monitoring kualitas voice di penggunaan harian sebagai guardrail pasca-closeout

Artefak validasi:
- Checklist regression Phase 3 tersedia di `PHASE3_REGRESSION_CHECKLIST.md`
- Ringkasan closeout tersedia di `PHASE3_CLOSEOUT.md`

Perkiraan:
- Phase 3 selesai, tidak ada feature expansion tambahan di fase ini

---

## Phase 4 - Production Foundation

Tujuan:
- Menyiapkan Privix agar aman, terukur, dan layak dideploy untuk penggunaan publik terbatas.

Catatan:
- Fase ini dinaikkan sebelum DM agar fitur berikutnya dibangun di atas fondasi yang lebih kuat.

Scope engineering:
- Database migration dari SQLite ke PostgreSQL
- Environment configuration yang rapi untuk local/staging/production
- Deployment pipeline backend dan frontend
- Logging dasar untuk backend
- Error tracking dan monitoring dasar
- Rate limiting / abuse protection dasar
- Backup dan rollback plan untuk database

Target platform:
- Backend: Render atau Railway
- Frontend: Vercel

Status:
- TODO

Definition of done:
- Aplikasi bisa jalan di environment production
- PostgreSQL menjadi database utama
- Alur deploy terdokumentasi dan bisa diulang
- Error penting bisa dilihat lewat log/monitoring
- Risiko abuse paling dasar sudah ditangani

Risiko utama:
- Migrasi schema dan query bisa menimbulkan bug kompatibilitas
- Deployment yang terlalu cepat tanpa observability akan menyulitkan debugging

---

## Phase 5 - Private Messaging

Tujuan:
- Menambahkan komunikasi private seperti messenger tanpa merusak model komunitas yang sudah ada.

Fitur:
- DM antar user
- Small private group
- Unread state / indikator pesan baru
- Daftar percakapan
- Message encryption (opsional, hanya jika arsitektur sudah siap)

Status:
- TODO

Definition of done:
- User bisa memulai DM satu lawan satu
- Percakapan private tersimpan dan bisa dibuka kembali
- Unread state konsisten
- Model permission untuk private conversation jelas

Catatan desain:
- Sebisa mungkin reuse arsitektur message/channel yang sudah ada
- Encryption jangan dijadikan blocker bila belum siap secara desain dan operasional

---

## Phase 6 - Growth Features

Tujuan:
- Menambah fitur yang meningkatkan retensi dan kualitas penggunaan saat jumlah user mulai bertambah.

Fitur engagement:
- Emoji reactions
- File upload
- Message edit/delete
- Search message

Fitur operasional:
- Moderation tools

Status:
- TODO

Definition of done:
- Reactions, edit/delete, dan upload bekerja di flow utama chat
- Search bisa dipakai untuk use case dasar
- Moderation tools cukup untuk operasional komunitas awal

Risiko utama:
- File upload akan memengaruhi storage, security, dan moderation
- Search message bisa mendorong perubahan schema/indexing

Catatan:
- Fitur engagement dan moderation bisa dipecah menjadi milestone terpisah bila scope membesar

---

## Phase 7 - Mobile App

Tujuan:
- Membawa pengalaman Privix ke aplikasi mobile native-like setelah web app cukup stabil.

Framework:
- React Native

Status:
- TODO

Prasyarat:
- Web product flow sudah matang
- Backend dan realtime flow cukup stabil
- Prioritas fitur inti untuk mobile sudah jelas

Definition of done:
- User bisa login, browse server, chat, dan join voice dari app mobile
- Pengalaman mobile tidak tertinggal jauh dari web untuk fitur inti

Catatan:
- Jangan mulai fase ini terlalu cepat sebelum production foundation dan fitur inti web benar-benar siap

---

## Milestone yang Disarankan

### Milestone A - Voice/On-Cam Stabilization Closeout
- DONE
- Checklist regression dieksekusi
- Scope Phase 3 di-freeze
- Acceptance notes dan handoff artifact disimpan

### Milestone B - Production Foundation
- Migrasi PostgreSQL
- Siapkan deployment
- Tambahkan logging, monitoring, dan proteksi dasar

### Milestone C - Private Messaging
- Rilis DM satu lawan satu
- Tambahkan unread state
- Evaluasi kebutuhan group private

### Milestone D - Growth Pack 1
- Reactions
- Edit/delete
- File upload

### Milestone E - Growth Pack 2
- Search
- Moderation tools

---

## Checklist Migrasi Voice ke SFU (Discord-like Stability)

Tujuan:
- Meningkatkan stabilitas voice camera/screenshare untuk room multi-user dengan arsitektur SFU (bukan mesh P2P).

Catatan penting:
- Migrasi ini tidak perlu rombak total aplikasi.
- Perubahan terbesar ada di modul voice realtime (`client/voice/*` + signaling server).
- UI utama, permission, chat core, audit, dan channel management bisa tetap dipakai.

### Scope File-per-File

#### 1) Feature Flag & Konfigurasi
- [x] `client/voice/config.js`: tambah flag `VOICE_USE_SFU`.
- [x] `server/server.js`: baca env `VOICE_USE_SFU` + config provider SFU.
- [x] `client/voice/index.js`: routing mode mesh vs SFU agar rollout bertahap aman.

#### 2) Backend SFU Gateway
- [x] `server/services/sfu.js` (baru): helper token room/capabilities publish/subscribe.
- [x] `server/server.js`: event signaling baru (`voice sfu token`, `voice stream state`) sambil pertahankan join/leave/permission lama.

#### 3) State Model Multi-Stream
- [x] `client/voice/state.js`: simpan stream per source (`audio`, `camera`, `screen`) per participant.
- [ ] `client/voice/participants.js`: dukung 1 user punya beberapa source aktif sekaligus.

#### 4) Core RTC Rework (Area Paling Besar)
- [x] `client/voice/rtc.js`: ganti flow mesh (offer/answer antar user) menjadi publish/subscribe SFU.
- [x] `client/voice/actions.js`: join/leave room SFU + publish/unpublish track (mic/camera/screen) sebagai source terpisah.
- [x] `client/voice/socket.js`: kurangi peran `voice signal` untuk media, fokus ke state event room/presence.

#### 5) UI Rendering Multi-Source
- [x] `client/voice/ui.js`: render tile berdasarkan source stream (`participantId::camera`, `participantId::screen`).
- [ ] `client/index.html`: pastikan kontrol camera/share tetap konsisten dengan state publish SFU.
- [ ] `client/handlers/ui.js` + `client/dom.js`: wiring tombol tetap, hanya action backend yang berubah.

Catatan implementasi saat ini:
- Jalur SFU sudah aktif sebagai mode baru (`livekit`) dengan fallback mesh.
- Alur signaling lama tetap dipertahankan agar rollout bisa bertahap.

#### 6) Quality/PTT/Settings Compatibility
- [ ] `client/voice/quality.js`: ambil stats dari SFU transport/publication.
- [ ] `client/voice/ptt.js`: apply mute ke local mic publication.
- [ ] `client/voice/settings.js`: device switch tetap dipakai sebelum republish track.

#### 7) Cleanup Mesh Legacy (Setelah Stabil)
- [ ] `client/voice/rtc.js`: tandai mesh path deprecated lalu remove bertahap.
- [ ] `client/voice/debug.js`, `client/voice/actions.js`, `client/voice/socket.js`, `server/server.js`: bersihkan debug logs sementara setelah UAT lulus.

### Definition of Done untuk Migrasi SFU
- [ ] Share screen tampil konsisten ke semua viewer dalam room (termasuk user yang join setelah share aktif).
- [ ] Camera/share tidak saling menimpa state stream.
- [ ] Audio tetap stabil saat camera/share on/off.
- [ ] Tidak ada blocker di mobile layout untuk tile multi-source.
- [ ] Voice reconnect flow tetap aman (leave/join/network changes).

### Urutan Eksekusi yang Direkomendasikan
1. Backend token + signaling SFU minimal.
2. Rework `state.js` + `rtc.js` untuk publish/subscribe.
3. Rework `actions.js` (mic/camera/screen sebagai source terpisah).
4. Adaptasi `ui.js` ke tile multi-source.
5. Validasi quality/reconnect/PTT lalu cleanup mesh legacy.

---

## Prioritas Eksekusi Saat Ini

Urutan kerja paling masuk akal dari kondisi sekarang:

1. Kerjakan Phase 4 agar fondasi production siap.
2. Masuk ke Phase 5 untuk DM.
3. Lanjut ke Phase 6 secara bertahap.
4. Simpan Phase 7 sampai produk web benar-benar stabil.
5. Tangani bug voice/on-cam hanya sebagai maintenance.

## Catatan Akhir

Roadmap ini sengaja memindahkan fokus dari "sebanyak mungkin fitur" ke "fitur yang selesai dan siap dipakai". Untuk Privix, kualitas stabilitas, voice reliability, dan kesiapan production akan jauh lebih menentukan daripada menambah banyak fitur terlalu cepat.
