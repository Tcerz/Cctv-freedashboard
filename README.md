# CCTV Dashboard – Monitoring Multi-Merk untuk Depot Tangki

Dashboard web untuk memonitor CCTV dari banyak merk berbeda, cukup dengan
IP address, username, dan password kamera. Kamera dikelompokkan per
"folder" (group) sesuai depot (misalnya: Depot Kisaran, Depot Aceh, dst).

## Cara Kerja (penting untuk dipahami)

Browser tidak bisa memutar stream RTSP secara langsung. Karena itu server
ini menjalankan **ffmpeg** untuk mengubah RTSP → HLS per kamera, saat
kamera tersebut sedang ditonton di dashboard. Karena RTSP adalah protokol
standar (didukung hampir semua merk kamera/DVR/NVR), pendekatan ini
**tidak peduli merk** — yang penting IP, port, username, password, dan
path RTSP-nya benar.

Stream otomatis dimatikan jika tidak ada yang menonton selama 60 detik,
supaya CPU dan bandwidth server tidak boros saat kamera banyak.

## Kebutuhan Server

1. **Node.js** versi 18 ke atas.
2. **ffmpeg** ter-install dan bisa dipanggil dari command line (`ffmpeg -version`).
   - Ubuntu/Debian: `sudo apt install ffmpeg`
   - Windows: download dari ffmpeg.org, masukkan ke PATH
3. Server ini **harus punya akses jaringan** ke semua IP kamera (via VPN/MPLS
   internal Pertamina Anda dari Aceh sampai Batam). Kalau server tidak bisa
   ping IP kamera, stream tidak akan jalan.

## Instalasi

```bash
cd cctv-dashboard
npm install
npm start
```

Buka `http://localhost:3000` (atau ganti PORT lewat file `.env`).

## Konfigurasi Opsional (.env)

Buat file `.env` di root folder:

```
PORT=3000
ADMIN_USER=admin
ADMIN_PASS=gantidenganpasswordkuat
```

Jika `ADMIN_USER`/`ADMIN_PASS` diisi, dashboard akan meminta login (HTTP
Basic Auth) — **sangat disarankan** karena dashboard ini menyimpan
password CCTV depot Anda.

## Cara Pakai

1. Klik **"+ Depot"** di sidebar untuk membuat folder/group per depot
   (contoh: "Depot Kisaran").
2. Pilih depot tersebut, lalu klik **"+ Tambah Kamera"**.
3. Isi nama kamera, pilih merk (untuk auto-isi path RTSP umum) atau pilih
   "Custom" dan isi path manual, lalu isi IP, port, username, password.
4. Kamera langsung muncul di grid dan mulai streaming.
5. Ulangi untuk depot lain — cukup buat group baru dan masukkan
   IP/user/password kamera di sana.
6. Atur jumlah kolom grid lewat dropdown "Grid" di kanan atas.

## Preset Path RTSP per Merk (bisa disesuaikan)

| Merk           | Path default                              |
|----------------|--------------------------------------------|
| Hikvision      | `/Streaming/Channels/101`                  |
| Dahua / CP Plus| `/cam/realmonitor?channel=1&subtype=0`     |
| Uniview        | `/media/video1`                            |
| Generic ONVIF  | `/onvif1`                                  |
| Custom         | isi manual sesuai dokumentasi vendor       |

Jika path default tidak cocok dengan unit kamera Anda, cek manual/label di
DVR/NVR terkait, atau tanyakan ke vendor yang memasang — pola path RTSP-nya
biasanya konsisten per merk meskipun modelnya berbeda-beda.

## Catatan Keamanan

- Password kamera disimpan di database lokal (`data/cctv.db`) dalam bentuk
  plain text untuk MVP ini. Batasi akses ke server (firewall/VPN saja,
  jangan expose ke internet publik) dan aktifkan `ADMIN_USER`/`ADMIN_PASS`.
- Untuk produksi jangka panjang, pertimbangkan enkripsi password di
  database dan HTTPS di depan server (reverse proxy nginx + Let's Encrypt).

## Rencana Pengembangan Selanjutnya

Setelah fitur monitoring CCTV ini stabil, fondasi ini bisa dikembangkan
untuk fitur dashboard laporan tangki (input petugas), karena struktur
group/depot yang sama bisa dipakai untuk mengaitkan laporan tangki per
depot dengan kamera pengawasnya.
