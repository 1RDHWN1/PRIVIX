# Migrasi Privix ke PostgreSQL

Privix sekarang memakai PostgreSQL sebagai default runtime. SQLite hanya dipakai kalau sengaja diset untuk migrasi/dev lama.

## 1. Siapkan PostgreSQL

Buat database kosong, misalnya `privix`.

```powershell
$env:DATABASE_URL="postgres://USER:PASSWORD@HOST:5432/privix"
```

Atau pakai variabel bawaan `pg`:

```powershell
$env:PGHOST="localhost"
$env:PGPORT="5432"
$env:PGDATABASE="privix"
$env:PGUSER="postgres"
$env:PGPASSWORD="password"
```

## 2. Migrasi data SQLite lama

Pastikan env PostgreSQL masih aktif, lalu jalankan:

```powershell
npm run migrate:postgres
```

Script ini akan membuat schema PostgreSQL otomatis sebelum memindahkan data.
Default SQLite source adalah `privix.db` di root project. Kalau file SQLite ada di path lain:

```powershell
$env:PRIVIX_SQLITE_PATH="C:\path\to\privix.db"
npm run migrate:postgres
```

## 3. Jalankan app memakai PostgreSQL

```powershell
npm start
```

Log startup akan menampilkan:

```text
Privix server running on port 3000 (postgres)
```

## Catatan

- Runtime default adalah PostgreSQL. SQLite tetap bisa dipakai hanya kalau `PRIVIX_DB_CLIENT=sqlite` diset eksplisit.
- Jangan migrasi berkali-kali ke database production tanpa backup.
- Script migrasi melakukan upsert berdasarkan `id`, jadi bisa dipakai ulang untuk dev, tapi tetap lebih aman migrasi sekali ke database kosong.
- Kalau SQLite lama masih punya duplikat username, script akan menggabungkan user duplikat ke user pertama agar tidak menabrak unique constraint PostgreSQL.
