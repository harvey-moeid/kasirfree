// ==========================================================
// tests/unit/helpers.test.mjs — Unit test untuk fungsi murni di
// public/js/lib/helpers.js (logika hitung pembayaran, format kode
// transaksi, konversi tanggal WIB). Ini logika bisnis PALING kritis
// di aplikasi (urusan duit), jadi paling penting ditest otomatis.
//
// Jalankan: node --test tests/unit
// (Tidak butuh dependency tambahan — pakai node:test bawaan Node 18+.)
// ==========================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  kodeTransaksi,
  hitungSplitPayment,
  hitungPembayaranSebagian,
  wibDateExpr,
  todayWIB,
  wibHourExpr,
} from '../../public/js/lib/helpers.js';

describe('kodeTransaksi', () => {
  test('format harus TRX-YYYYMMDD-NNNNNNN (3 digit ms + 4 digit random)', () => {
    const kode = kodeTransaksi();
    assert.match(kode, /^TRX-\d{8}-\d{7}$/);
  });

  test('dua panggilan berturut-turut kemungkinan besar beda (random 4 digit)', () => {
    const results = new Set();
    for (let i = 0; i < 20; i++) results.add(kodeTransaksi());
    // Dengan 20 sampel dari 9000 kemungkinan, semuanya HARUS unik kecuali sial banget.
    assert.ok(results.size >= 18, `Terlalu banyak duplikat: ${20 - results.size} dari 20`);
  });
});

describe('hitungSplitPayment (transaksi kasir biasa)', () => {
  test('bayar cash pas — tidak ada kembalian', () => {
    const r = hitungSplitPayment([{ metode: 'cash', jumlah: 50000 }], 50000);
    assert.equal(r.ok, true);
    assert.equal(r.kembalian, 0);
    assert.equal(r.metodeFinal, 'cash');
  });

  test('bayar cash lebih — kembalian dihitung benar', () => {
    const r = hitungSplitPayment([{ metode: 'cash', jumlah: 100000 }], 73500);
    assert.equal(r.ok, true);
    assert.equal(r.kembalian, 26500);
  });

  test('bayar cash kurang — ditolak dengan pesan jelas', () => {
    const r = hitungSplitPayment([{ metode: 'cash', jumlah: 30000 }], 50000);
    assert.equal(r.ok, false);
    assert.match(r.error, /kurang/i);
  });

  test('QRIS pas — tidak ada kembalian (non-cash tidak boleh lebih)', () => {
    const r = hitungSplitPayment([{ metode: 'qris', jumlah: 50000 }], 50000);
    assert.equal(r.ok, true);
    assert.equal(r.kembalian, 0);
    assert.equal(r.metodeFinal, 'qris');
  });

  test('QRIS melebihi tagihan — DITOLAK (non-tunai tidak ada kembalian fisik)', () => {
    const r = hitungSplitPayment([{ metode: 'qris', jumlah: 60000 }], 50000);
    assert.equal(r.ok, false);
    assert.match(r.error, /non-tunai/i);
  });

  test('split payment: transfer + cash, kembalian dari sisa cash', () => {
    // Tagihan 100rb: transfer 40rb (pas, tidak lebih) + cash 65rb → kembalian 5rb
    const r = hitungSplitPayment(
      [
        { metode: 'transfer', jumlah: 40000 },
        { metode: 'cash', jumlah: 65000 },
      ],
      100000
    );
    assert.equal(r.ok, true);
    assert.equal(r.kembalian, 5000);
    assert.equal(r.metodeFinal, 'split');
  });

  test('split payment: 2 metode non-cash melebihi total — ditolak', () => {
    const r = hitungSplitPayment(
      [
        { metode: 'transfer', jumlah: 30000 },
        { metode: 'qris', jumlah: 30000 },
      ],
      50000
    );
    assert.equal(r.ok, false);
  });

  test('metode tidak valid — ditolak', () => {
    const r = hitungSplitPayment([{ metode: 'kartu_kredit_asing', jumlah: 10000 }], 10000);
    assert.equal(r.ok, false);
    assert.match(r.error, /tidak valid/i);
  });

  test('jumlah 0 atau negatif — ditolak', () => {
    assert.equal(hitungSplitPayment([{ metode: 'cash', jumlah: 0 }], 10000).ok, false);
    assert.equal(hitungSplitPayment([{ metode: 'cash', jumlah: -5000 }], 10000).ok, false);
  });

  test('array kosong — ditolak', () => {
    assert.equal(hitungSplitPayment([], 10000).ok, false);
  });

  test('bukan array — ditolak (tidak crash)', () => {
    assert.equal(hitungSplitPayment(null, 10000).ok, false);
    assert.equal(hitungSplitPayment(undefined, 10000).ok, false);
  });
});

describe('hitungPembayaranSebagian (DP / pelunasan preorder)', () => {
  test('DP separuh dari total — diterima, tidak ada konsep kembalian', () => {
    const r = hitungPembayaranSebagian([{ metode: 'cash', jumlah: 50000 }], 100000);
    assert.equal(r.ok, true);
    assert.equal(r.totalDiterima, 50000);
    assert.equal('kembalian' in r, false); // beda dari hitungSplitPayment, sengaja tidak ada field ini
  });

  test('bayar pas batas atas — diterima', () => {
    const r = hitungPembayaranSebagian([{ metode: 'cash', jumlah: 100000 }], 100000);
    assert.equal(r.ok, true);
  });

  test('melebihi batas atas — ditolak', () => {
    const r = hitungPembayaranSebagian([{ metode: 'cash', jumlah: 150000 }], 100000);
    assert.equal(r.ok, false);
    assert.match(r.error, /melebihi batas/i);
  });

  test('split DP: cash + transfer, totalDiterima akumulasi benar', () => {
    const r = hitungPembayaranSebagian(
      [
        { metode: 'cash', jumlah: 20000 },
        { metode: 'transfer', jumlah: 30000 },
      ],
      100000
    );
    assert.equal(r.ok, true);
    assert.equal(r.totalDiterima, 50000);
    assert.equal(r.cashTotal, 20000);
    assert.equal(r.metodeFinal, 'split');
  });
});

describe('Helper tanggal/jam WIB (UTC+7)', () => {
  test('wibDateExpr menghasilkan fragment SQL yang benar', () => {
    assert.equal(wibDateExpr('created_at'), "date(datetime(created_at, '+7 hours'))");
  });

  test('wibHourExpr menghasilkan fragment SQL yang benar', () => {
    assert.equal(wibHourExpr('created_at'), "strftime('%H', datetime(created_at, '+7 hours'))");
  });

  test('todayWIB mengembalikan format YYYY-MM-DD', () => {
    assert.match(todayWIB(), /^\d{4}-\d{2}-\d{2}$/);
  });

  test('todayWIB konsisten dengan waktu UTC+7 sekarang (bukan waktu server lokal)', () => {
    const expected = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    assert.equal(todayWIB(), expected);
  });
});
