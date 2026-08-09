#!/usr/bin/env node
// ==========================================================
// scripts/patch-android-permissions.mjs — Tambah izin Android yang
// dibutuhkan aplikasi ini tapi TIDAK otomatis ada di template default
// `cap add android`. Dipanggil setelah `cap add android`, sebelum
// `cap sync` — lihat build-apk.yml / build-apk-release.yml.
//
// 1) KAMERA — fitur scan barcode (getUserMedia dari JavaScript) di
// kasir-app.js JALAN NORMAL di browser biasa, tapi kalau dibungkus jadi
// APK (WebView Capacitor), Android TETAP butuh izin
// android.permission.CAMERA dideklarasikan di AndroidManifest.xml BARU
// WebView-nya bisa minta izin kamera ke sistem saat runtime — tanpa ini,
// getUserMedia() akan gagal/diam-diam ditolak di APK walau kodenya sama
// persis dengan yang jalan normal di Chrome/browser biasa.
//
// 2) BLUETOOTH — fitur "Cetak Langsung ke Printer" (Web Bluetooth API,
// navigator.bluetooth.requestDevice di kasir-app.js) butuh izin Bluetooth
// yang beda-beda tergantung versi Android (lihat komentar di
// permissionsNeeded di bawah). CATATAN JUJUR: izin ini PERLU tapi BELUM
// TENTU CUKUP — Web Bluetooth API (device picker dialog-nya khususnya)
// dukungannya di Android System WebView (dasar Capacitor) secara historis
// tidak sekonsisten Chrome browser biasa. Kalau setelah izin ini
// ditambahkan fitur cetak Bluetooth MASIH tidak berfungsi di APK (beda
// gejala dari sekadar "izin ditolak"), kemungkinan besar WebView di
// device itu memang tidak mengimplementasikan device picker-nya sama
// sekali — solusi jangka panjang untuk kasus itu adalah plugin Capacitor
// native khusus Bluetooth (bukan Web Bluetooth API), bukan sekadar
// tambahan izin lagi.
// ==========================================================

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const MANIFEST_PATH = 'android/app/src/main/AndroidManifest.xml';

if (!existsSync(MANIFEST_PATH)) {
  console.error(`GAGAL: ${MANIFEST_PATH} tidak ditemukan — jalankan 'cap add android' dulu.`);
  process.exit(1);
}

let xml = readFileSync(MANIFEST_PATH, 'utf-8');

const permissionsNeeded = [
  '<uses-permission android:name="android.permission.CAMERA" />',
  // Bluetooth — dibutuhkan fitur "Cetak Langsung ke Printer" (Web
  // Bluetooth API, navigator.bluetooth.requestDevice) di kasir-app.js.
  // BLUETOOTH/BLUETOOTH_ADMIN untuk Android lama (sampai API 30), BLUETOOTH_SCAN/
  // BLUETOOTH_CONNECT untuk Android 12+ (API 31+) — beda model izin,
  // device APAPUN butuh salah satu pasangan ini sesuai versi Android-nya,
  // jadi semuanya dideklarasikan sekalian (yang tidak relevan untuk versi
  // Android tertentu otomatis diabaikan sistem, tidak masalah dideklarasikan
  // semua).
  '<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />',
];
const featuresNeeded = [
  // required="false" — HP tanpa kamera (jarang, tapi ada) tetap bisa
  // install app ini, cuma fitur scan barcode-nya yang tidak berfungsi.
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
];

let changed = false;
for (const line of [...permissionsNeeded, ...featuresNeeded]) {
  if (xml.includes(line)) continue; // sudah ada (idempotent), lewati
  const anchor = '<manifest';
  const anchorEnd = xml.indexOf('>', xml.indexOf(anchor));
  if (anchorEnd === -1) {
    console.error(`GAGAL: tag <manifest> tidak ditemukan/tidak wajar di ${MANIFEST_PATH} — struktur template Capacitor mungkin berubah. Tempel isi file itu untuk dibantu perbaiki manual.`);
    process.exit(1);
  }
  xml = xml.slice(0, anchorEnd + 1) + `\n    ${line}` + xml.slice(anchorEnd + 1);
  changed = true;
}

if (!changed) {
  console.log('Izin Android yang dibutuhkan sudah ada semua, lewati (idempotent).');
  process.exit(0);
}

writeFileSync(MANIFEST_PATH, xml, 'utf-8');
console.log('Izin Android (kamera + Bluetooth) berhasil ditambahkan ke', MANIFEST_PATH);
