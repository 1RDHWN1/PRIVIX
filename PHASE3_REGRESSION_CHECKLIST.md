# Phase 3 Regression Checklist

Checklist ini dipakai untuk menutup stabilisasi `Voice + On-Cam` di Privix. Fokusnya adalah memastikan flow utama tetap aman setelah perubahan pada reconnect, device switching, on-cam, mobile UI, dan settings.

## Status Closeout (2026-03-29)

- [x] Regression pass untuk flow inti `join, listen, speak, mute, camera on/off, leave`.
- [x] Tidak ada bug blocker aktif untuk Phase 3.
- [x] Scope Phase 3 di-freeze; perubahan berikutnya masuk mode maintenance/hotfix.
- [x] Handoff ke Phase 4 siap dijalankan.

Catatan:
- Saat ini belum ada automated test suite (`npm test` masih placeholder), jadi validasi tetap mengandalkan regression manual terstruktur.

## 1. Join / Leave Dasar

- Join voice dari voice channel berhasil tanpa refresh halaman.
- Join voice sebagai user dengan izin bicara normal mengaktifkan mic sesuai device yang dipilih.
- Join voice sebagai listener tetap berhasil tanpa crash UI.
- Leave voice membersihkan roster, stage tile, dan audio element lokal.
- Join ulang setelah leave manual tetap berjalan normal.

## 2. Presence / Roster / Stage

- User yang tidak join voice tetap melihat presence room dengan benar.
- `voice roster` sinkron dengan `voice stage`.
- Join/leave peserta lain memunculkan update realtime tanpa stale participant.
- Pindah channel voice membersihkan participant dari room lama.
- Pindah server tidak membawa presence room dari server sebelumnya.

## 3. Mic / Speak / Mute

- Mic aktif mengirim audio setelah join.
- Toggle mute mengubah state lokal dan state peserta lain.
- Push-to-talk tetap bekerja saat session baru dimulai.
- Push-to-talk tidak bentrok dengan mute toggle biasa.
- Speaking indicator hilang saat stream berhenti, leave, atau peer disconnect.

## 4. Camera / On-Cam

- Menyalakan kamera saat sudah join voice berhasil membuat video tile lokal.
- Peserta lain menerima state `camera on` secara realtime.
- Mematikan kamera menghapus video tile atau video track tanpa merusak audio room.
- Jika camera track berhenti mendadak, UI kembali ke `camera off` dan state peer sinkron.
- Flip camera tetap bekerja pada device yang mendukung front/back camera.

## 5. Device Switching

- Ganti input device saat sesi aktif memindahkan mic tanpa putus room.
- Ganti camera device saat on-cam aktif memindahkan video tanpa state nyangkut.
- Ganti output device mengubah sink audio untuk voice participant.
- Cabut mic aktif saat sesi berjalan memicu fallback atau notifikasi yang jelas.
- Cabut kamera aktif saat on-cam berjalan memicu fallback atau kamera dimatikan dengan rapi.
- `devicechange` browser tidak menyebabkan UI settings stale.

## 6. Quality / Adaptive Camera

- `Video Quality = Auto` menyesuaikan profil kamera saat kualitas room berubah.
- `Video Quality = High/Balanced/Low` tetap menghormati mode manual.
- `Quality pill` dan `Quality text` ter-update setelah join.
- Kondisi `Poor` berulang dapat memicu recovery/reconnect peer.

## 7. Reconnect / Recovery

- Refresh jaringan sementara tidak membuat state voice permanen rusak.
- Socket reconnect saat user masih di room memicu auto rejoin yang benar.
- Jika kamera aktif sebelum reconnect, kamera bisa dipulihkan kembali bila izin/browser mengizinkan.
- Manual leave tidak memicu auto rejoin.
- Reconnect tidak membawa participant duplikat atau tile ganda.

## 8. Settings UI / UX

- Popover settings menampilkan status sesi, kamera, dan network yang masuk akal.
- Hint untuk input/camera/output berubah sesuai state saat ini.
- Mode listener terlihat jelas dari settings.
- Saat kamera tidak tersedia, camera row dan video quality state tetap jelas.
- Settings tetap usable di layout kecil/mobile.

## 9. Mobile Responsive

- Voice panel tetap bisa dipakai pada viewport mobile.
- Join/mute/camera/leave buttons masih bisa ditekan tanpa overlap.
- Voice stage tidak memotong tile penting pada mobile.
- Settings popover tetap terlihat dan tidak keluar layar parah.
- Flip camera dan on-cam tetap usable pada browser mobile yang mendukung.

## 10. Browser / Permission Edge Cases

- Tolak izin mic tetap memungkinkan join sebagai listener.
- Tolak izin kamera tidak merusak sesi voice yang sudah berjalan.
- Kamera yang mati karena permission/browser/device menampilkan feedback yang jelas.
- Browser tanpa `setSinkId` tetap aman memakai output default.
- Browser tanpa kamera tetap menampilkan state settings yang masuk akal.

## Exit Criteria

Phase 3 bisa dianggap mendekati selesai jika:

- Semua flow utama `join, listen, speak, mute, camera on/off, leave` lolos.
- Tidak ada bug blocker pada reconnect, devicechange, dan sync participant.
- Settings voice/camera cukup jelas dipakai tanpa kebingungan user.
- Mobile layout voice usable untuk alur inti.
