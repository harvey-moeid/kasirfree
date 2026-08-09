#!/usr/bin/env node
// ==========================================================
// scripts/patch-android-signing.mjs — Suntik konfigurasi signing ke
// android/app/build.gradle (yang di-generate fresh oleh `cap add android`
// tiap build CI — lihat build-apk.yml, folder android/ TIDAK di-commit ke
// repo). Kredensial dibaca dari environment variable (asalnya dari GitHub
// Secrets), TIDAK PERNAH ditulis ke file/log dalam bentuk plain text
// permanen.
//
// Dipanggil dari workflow release APK, BUKAN dari build-apk.yml biasa
// (yang tetap build APK debug tanpa signing, untuk testing/sideload).
// ==========================================================

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const GRADLE_PATH = 'android/app/build.gradle';

const required = ['KEYSTORE_PATH', 'KEYSTORE_PASSWORD', 'KEY_ALIAS', 'KEY_PASSWORD'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`GAGAL: environment variable ${key} tidak diset.`);
    process.exit(1);
  }
}

if (!existsSync(GRADLE_PATH)) {
  console.error(`GAGAL: ${GRADLE_PATH} tidak ditemukan — jalankan 'cap add android' dulu.`);
  process.exit(1);
}

let gradle = readFileSync(GRADLE_PATH, 'utf-8');

if (gradle.includes('signingConfigs.release')) {
  console.log('Signing config sudah ada di build.gradle, lewati (idempotent).');
  process.exit(0);
}

const signingConfigsBlock = `
    signingConfigs {
        release {
            storeFile file(System.getenv("KEYSTORE_PATH"))
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS")
            keyPassword System.getenv("KEY_PASSWORD")
        }
    }
`;

// PENTING soal urutan: cari & tandai "release {" yang ada DI DALAM
// "buildTypes { ... }" SEBELUM menyisipkan signingConfigs — signingConfigs
// sendiri juga punya sub-blok "release { ... }", jadi kalau signingConfigs
// disisipkan duluan, pencarian "release {" generik bisa salah kena blok
// itu, bukan blok buildTypes yang dimaksud.
const buildTypesIdx = gradle.indexOf('buildTypes {');
if (buildTypesIdx === -1) {
  console.error('GAGAL: pola "buildTypes {" tidak ditemukan di build.gradle — struktur template Capacitor mungkin berubah. Tempel isi file itu untuk dibantu perbaiki manual.');
  process.exit(1);
}
const afterBuildTypes = gradle.slice(buildTypesIdx);
const releaseMatch = afterBuildTypes.match(/release\s*\{/);
if (!releaseMatch) {
  console.error('GAGAL: pola "release {" tidak ditemukan di dalam buildTypes — struktur template Capacitor mungkin berubah. Tempel isi file itu untuk dibantu perbaiki manual.');
  process.exit(1);
}
const releaseAbsoluteIdx = buildTypesIdx + releaseMatch.index + releaseMatch[0].length;
gradle = gradle.slice(0, releaseAbsoluteIdx) + '\n            signingConfig signingConfigs.release' + gradle.slice(releaseAbsoluteIdx);

// Sisipkan signingConfigs SEBELUM blok "buildTypes {" (struktur standar
// template Android Gradle Plugin, dipakai Capacitor apa adanya).
gradle = gradle.replace('buildTypes {', `${signingConfigsBlock}\n    buildTypes {`);

writeFileSync(GRADLE_PATH, gradle, 'utf-8');
console.log('Signing config berhasil disuntik ke', GRADLE_PATH);
