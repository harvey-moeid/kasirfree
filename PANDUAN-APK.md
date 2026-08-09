# Panduan Build APK (Capacitor + GitHub Actions)

Aplikasi ini dibungkus jadi APK Android pakai **Capacitor** (bukan rewrite —
kode HTML/JS yang sudah ada dipakai apa adanya, cuma ditaruh di dalam
"cangkang" native Android). APK di-build otomatis di **GitHub Actions**
(server GitHub, gratis untuk repo publik/privat dengan kuota gratis), jadi
kamu **tidak perlu install Android Studio / Android SDK di komputer sendiri**.

## Cara pakai (sekali setup)

> Font, ikon, dan beberapa library (Chart.js, xlsx.js, qrcodejs) sekarang
> di-self-host lokal (bukan dari CDN — lihat `PANDUAN-MODE-LOKAL.md` bagian
> "Asset offline"). Workflow build APK di bawah **sudah otomatis**
> menjalankan langkah download itu setiap kali build, jadi APK yang
> dihasilkan selalu offline-ready dari kali pertama install — tidak perlu
> setup tambahan khusus untuk APK.

1. **Push project ini ke GitHub** (kalau belum ada repo, buat repo baru dulu
   di github.com, lalu `git init && git remote add origin <url-repo-mu> &&
   git push -u origin main`).
2. Buka repo itu di GitHub → tab **Actions**. Workflow bernama
   **"Build APK (Capacitor)"** akan otomatis jalan tiap kali kamu push ke
   branch `main`/`master`. Bisa juga dipicu manual: klik workflow itu →
   tombol **"Run workflow"**.
3. Tunggu sampai selesai (~5-10 menit, ada logo hijau centang kalau sukses).
4. Klik run yang sudah selesai → scroll ke bagian **Artifacts** di bawah →
   unduh **`muidsoft-debug-apk`** (file `.zip`, di dalamnya ada
   `app-debug.apk`).
5. Pindahkan `app-debug.apk` ke HP Android (lewat kabel USB, Google Drive,
   WhatsApp ke diri sendiri, dll), lalu tap file itu di HP untuk install.
   - Android akan minta izin **"Install dari sumber tidak dikenal"** —
     ini normal untuk APK yang tidak dari Play Store, aktifkan izinnya
     khusus untuk file manager yang kamu pakai buka file itu.

## Setiap kali ada update kode

Push lagi ke `main` → workflow otomatis jalan lagi → APK baru muncul di
Artifacts. Tidak perlu setup ulang.

## Kenapa APK-nya "debug", bukan "release"?

APK debug (dari workflow **"Build APK (Capacitor)"**) **bisa langsung
diinstall & dipakai normal** — bedanya cuma tidak di-"tandatangani" (sign)
dengan kunci rilis resmi, jadi tidak bisa diupload ke Google Play Store.
Untuk pemakaian sendiri/dibagikan manual ke kasir di tokomu, APK debug ini
**sudah cukup dan aman dipakai**.

## Release APK bertanda tangan (untuk Play Store)

Kalau mau upload ke Play Store, pakai workflow terpisah **"Build APK
(Release, signed)"**. Setup sekali di awal:

### 1. Bikin keystore (kunci digital penandatangan) — DI KOMPUTERMU SENDIRI

**PENTING**: keystore ini harus kamu buat & simpan sendiri, JANGAN pernah
minta orang lain (termasuk AI apa pun) membuatkannya untukmu — siapa pun
yang pegang file ini + passwordnya bisa terbitkan update palsu mengatasnamakan
app-mu di Play Store. Kalau perlu Java untuk `keytool` dan belum ada di
komputer, install dulu JDK (Java Development Kit).

```bash
keytool -genkeypair -v -keystore release.keystore -alias muidsoft \
  -keyalg RSA -keysize 2048 -validity 10000
```

Ikuti pertanyaan yang muncul (nama, organisasi, dll — bebas isi apa saja).
Kamu akan diminta bikin 2 password (keystore password & key password, boleh
sama). **Simpan `release.keystore` dan kedua password itu di tempat yang
sangat aman** (password manager, dsb) — kalau hilang, kamu tidak akan bisa
menerbitkan update untuk app yang sama di Play Store lagi, selamanya (harus
bikin app baru dari nol dengan identitas terpisah).

### 2. Ubah keystore jadi teks (base64) untuk disimpan sebagai Secret

```bash
base64 -i release.keystore -o release.keystore.base64
```

(Di Linux/Mac bisa juga `base64 -w0 release.keystore`. Di Windows pakai
PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("release.keystore")) | Out-File release.keystore.base64`.)

### 3. Simpan sebagai GitHub Secrets

Repo di GitHub → **Settings → Secrets and variables → Actions → New
repository secret**. Buat 4 secret ini:

| Nama Secret | Isi |
|---|---|
| `KEYSTORE_BASE64` | Isi file `release.keystore.base64` (semua teksnya) |
| `KEYSTORE_PASSWORD` | Password keystore dari langkah 1 |
| `KEY_ALIAS` | `muidsoft` (atau alias lain kalau kamu ganti di langkah 1) |
| `KEY_PASSWORD` | Password key dari langkah 1 |

Setelah tersimpan sebagai Secret, **hapus file `release.keystore.base64`
dari komputer** (isinya sudah pindah ke GitHub, tidak perlu nganggur di
disk) — tapi **`release.keystore` ASLI tetap simpan baik-baik** (butuh lagi
kalau nanti ganti komputer/perlu setup ulang Secrets).

### 4. Jalankan workflow

Tab **Actions** → **"Build APK (Release, signed)"** → **Run workflow** →
isi nomor versi (`version_name`, mis. "1.0.0") dan nomor build
(`version_code`, integer, **wajib naik terus tiap rilis** — 1, 2, 3, dst).
APK hasil sudah bertanda tangan, siap upload ke Play Console.

Keystore hanya ada sebentar di komputer virtual GitHub Actions selama build
berjalan, otomatis terhapus begitu job selesai — tidak pernah tersimpan
permanen atau muncul di log manapun.

## Ganti ikon / nama aplikasi


- **Nama aplikasi**: ubah `appName` di `capacitor.config.json`.
- **Ikon**: ganti file `assets/icon.png` (1024x1024px, PNG persegi — ini
  sumber utama untuk semua ukuran ikon Android/iOS/PWA yang dibutuhkan,
  dipakai `@capacitor/assets generate` tiap build lewat step "Generate ikon
  & splash screen"). Untuk ikon PWA di browser (`public/icons/icon-192.png`,
  `icon-512.png`) ganti terpisah — ukurannya sama tapi tempat/tujuannya beda
  (dipakai `manifest.json`, bukan proses build APK).
- **App ID** (identitas unik aplikasi, format `com.namamu.app`): ubah
  `appId` di `capacitor.config.json`. **Hati-hati**: kalau app sudah pernah
  diinstall dengan App ID lama, ganti App ID = dianggap aplikasi BEDA oleh
  Android (harus uninstall yang lama dulu, tidak bisa "update" begitu saja).

## Kenapa Capacitor (bukan cuma "APK generator" online)?

- Semua fitur yang sudah ada (database lokal sql.js, IndexedDB, PWA offline)
  jalan **persis sama** di dalam APK — WebView Android modern (yang dipakai
  Capacitor) mendukung penuh IndexedDB, Web Crypto API, dan Service Worker,
  jadi tidak ada kode yang perlu diubah.
- `capacitor.config.json` di project ini sudah diatur `androidScheme: "https"`
  — ini PENTING, supaya WebView menganggap app berjalan di konteks aman
  ("secure context"), yang dibutuhkan beberapa API yang dipakai app ini
  (`crypto.subtle` di `crypto.js`, Service Worker).
- Ke depan kalau mau fitur native lebih dalam (misal print langsung ke
  printer thermal Bluetooth tanpa lewat Web Bluetooth API, yang sekarang
  cuma didukung Chrome/Edge), Capacitor punya plugin ekosistem luas untuk
  itu — tinggal ditambah, tidak perlu bongkar app dari nol.

## Troubleshooting

- **Tombol "Cetak Langsung ke Printer" tidak menemukan printer / gagal
  konek**: workflow build APK sudah otomatis menambahkan izin Bluetooth
  (`android.permission.BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, dst — lihat
  `scripts/patch-android-permissions.mjs`). Kalau setelah itu MASIH gagal
  dengan pesan soal "device picker tidak tersedia" atau semacamnya (bukan
  "izin ditolak"), kemungkinan besar **Android System WebView di HP itu
  memang tidak mengimplementasikan pemilih perangkat Bluetooth** — ini
  keterbatasan WebView, bukan sesuatu yang bisa diperbaiki lewat izin
  tambahan. Coba update "Android System WebView" lewat Play Store dulu;
  kalau tetap tidak bisa, solusinya butuh plugin Bluetooth native
  (bukan Web Bluetooth API) — kabari saya kalau sampai di situ, perlu
  perubahan yang lebih besar.

- **Workflow gagal di step `./gradlew assembleDebug`**: biasanya versi
  Android Gradle Plugin/Capacitor yang saling tidak cocok. Cek log error
  di tab Actions, biasanya pesannya jelas menyebut package/versi mana yang
  bentrok — bisa di-paste ke saya untuk dibantu perbaiki.
- **APK terinstall tapi layar putih/blank**: buka `chrome://inspect` di
  Chrome desktop (HP tersambung USB debugging) untuk lihat error console —
  biasanya soal path file yang salah di `capacitor.config.json`.
- **Ikon masih default Capacitor (robot hijau)**: pastikan
  `assets/icon.png` benar-benar ada & ukurannya 1024x1024px persegi,
  lalu re-run workflow.
- **Workflow "Build APK (Release, signed)" gagal di step "Suntik
  konfigurasi signing"**: berarti struktur `android/app/build.gradle` yang
  di-generate Capacitor versi terbaru sudah berubah dari yang diasumsikan
  `scripts/patch-android-signing.mjs`. Pesan errornya akan bilang pola apa
  yang tidak ketemu — paste pesan itu (dan kalau bisa isi
  `android/app/build.gradle` dari log build sebelumnya) ke saya untuk
  diperbaiki.
- **Lupa password keystore**: sayangnya tidak ada cara reset — keystore
  yang hilang password-nya sama saja dengan hilang keystore-nya. Kalau app
  belum pernah rilis ke Play Store, tinggal bikin keystore baru (ulang dari
  langkah 1). Kalau sudah pernah rilis, update selanjutnya harus pakai app
  ID baru (dianggap aplikasi berbeda oleh Play Store).
