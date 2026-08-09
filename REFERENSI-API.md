# Referensi API — muidsoft POS

> ⚠️ Dokumen ini ditulis untuk versi cloud lama (Cloudflare Worker + D1).
> Aplikasi sekarang jalan **100% lokal di browser** (lihat
> `PANDUAN-MODE-LOKAL.md`) — tidak ada Base URL/server sungguhan lagi,
> tapi bentuk request/response tiap endpoint di bawah ini **masih akurat**
> karena router lokal (`public/js/local-app.js` + `public/js/routes/*.js`)
> sengaja dibuat meniru persis kontrak API yang sama. Base URL & cookie
> sesi di bawah tidak berlaku lagi; abaikan bagian itu saja.

Kode sumber (implementasi yang BENERAN jalan): `public/js/local-app.js` +
`public/js/routes/*.js`. Kalau ada perbedaan dengan dokumen ini,
**kode sumber yang benar** — dokumen ini dibuat dari hasil baca kode per
14 Juli 2026, tapi bisa saja kode berubah lagi setelahnya.

Role: `super_admin` (semua toko) · `admin_toko` (toko sendiri) · `kasir`

---

## Autentikasi

| Method | Path | Role | Keterangan |
|---|---|---|---|
| GET | `/` | publik | Redirect ke `/login.html` |
| POST | `/api/auth/login` | publik | `{ username, password }` → set cookie sesi |
| POST | `/api/auth/logout` | publik | Hapus cookie sesi |
| GET | `/api/auth/me` | auth | Data user yang sedang login |
| POST | `/api/auth/change-password` | auth | `{ password_lama, password_baru }` |

## Produk

| Method | Path | Role | Keterangan |
|---|---|---|---|
| GET | `/api/produk` | auth | List produk toko |
| POST | `/api/produk` | admin | Tambah produk |
| PUT | `/api/produk/:id` | admin | Ubah produk |
| DELETE | `/api/produk/:id` | admin | Soft-delete (`is_active=0`) |
| POST | `/api/produk/:id/koreksi-stok` | admin | *(legacy, tidak dipakai UI — stok tidak dilacak lagi)* |

`admin` = `super_admin` atau `admin_toko`.

## Bahan Baku & Resep (HPP)

| Method | Path | Role | Keterangan |
|---|---|---|---|
| GET | `/api/bahan-baku` | admin | List bahan baku toko |
| POST | `/api/bahan-baku` | admin | Tambah (`nama`, `satuan`, `harga_per_satuan`) |
| PUT | `/api/bahan-baku/:id` | admin | Ubah |
| DELETE | `/api/bahan-baku/:id` | admin | Soft-delete |
| GET | `/api/resep?ref_type=produk&ref_id=` | admin | Resep untuk produk tertentu + `total_hpp` |
| POST | `/api/resep` | admin | Tambah baris resep (`ref_type`, `ref_id`, `bahan_baku_id`, `jumlah`) |
| DELETE | `/api/resep/:id` | admin | Hard-delete (bukan soft-delete — tabel penghubung ringan) |

## Upload & Gambar

| Method | Path | Role | Keterangan |
|---|---|---|---|
| POST | `/api/upload/produk` | admin | Upload foto produk ke R2 |
| GET | `/api/gambar/*` | publik | Serve foto produk dari R2 |

## Toko, Pengaturan, Kategori

| Method | Path | Role | Keterangan |
|---|---|---|---|
| GET | `/api/toko` | auth | List toko (scoped by role) |
| POST | `/api/toko` | super_admin | Tambah toko |
| PUT | `/api/toko/:id` | super_admin | Ubah toko |
| GET | `/api/settings` | publik | Judul app + kustomisasi struk (publik karena halaman login butuh ini) |
| PUT | `/api/settings` | super_admin | Ubah judul app & kustomisasi struk |
| GET | `/api/kategori` | auth | List kategori |
| POST | `/api/kategori` | admin | Tambah kategori |

## Shift Kasir

| Method | Path | Role | Keterangan |
|---|---|---|---|
| POST | `/api/shift/buka` | auth | Buka shift (`modal_awal`) |
| GET | `/api/shift/aktif` | auth | Shift aktif milik user + perkiraan kas saat ini |
| POST | `/api/shift/tutup` | auth | Tutup shift (`kas_akhir`, `catatan?`) |
| GET | `/api/shift` | admin | Riwayat shift |

## Transaksi

| Method | Path | Role | Keterangan |
|---|---|---|---|
| POST | `/api/transaksi` | auth | Buat transaksi (lihat detail di bawah) |
| GET | `/api/transaksi` | auth | List transaksi (filter `dari`, `sampai`, `tanggal`, `kasir_id`, `limit`) |
| GET | `/api/transaksi/:id` | auth | Detail transaksi + `items[]` + `pembayaran[]` |
| POST | `/api/transaksi/:id/batalkan` | auth | Batalkan seluruh/sebagian item (lihat detail) |
| DELETE | `/api/transaksi/bulk` | super_admin | Hapus permanen (`dari?`, `sampai?`, `konfirmasi: "HAPUS"`) |

### `POST /api/transaksi` — body

```jsonc
{
  "offline_uuid": "uuid-v4",      // buat idempotency saat sinkronisasi offline
  "items": [
    {
      "id": 7,                     // produk_id
      "qty": 2,
      "catatan": "..."              // opsional
    }
  ],
  "pembayaran": [{ "metode": "cash", "jumlah": 60000 }],  // boleh >1 (split payment)
  "diskon": 0,
  "pajak": 0,
  "is_preorder": false,
  "waktu_ambil": "2026-07-20T15:00:00",  // wajib kalau is_preorder=true
  "nama_pemesan": "...", "hp_pemesan": "...",
  "status_bayar": "lunas"  // khusus preorder: 'lunas' (default) | 'dp' | 'belum_bayar'
}
```
Harga **selalu dihitung ulang di server** dari `produk.harga_jual` saat ini
— nilai harga dari client tidak pernah dipercaya. Response menyertakan
`nomor_antrian`, `id` (dipakai untuk pembatalan nanti), serta `status_bayar`,
`jumlah_dp`, `sisa_bayar`.

`status_bayar` cuma berlaku untuk preorder (`is_preorder: true`) — transaksi
biasa selalu dipaksa `'lunas'` apa pun yang dikirim. Kalau `'belum_bayar'`,
`pembayaran` boleh dikosongkan/di-omit (tidak ada uang diterima sekarang).
Kalau `'dp'`, `pembayaran` wajib diisi tapi totalnya boleh **kurang** dari
total tagihan (beda dari transaksi normal yang wajib menutupi seluruh
tagihan) — sisanya tersimpan di `sisa_bayar` dan dilunasi lewat
`POST /api/preorder/:id/pelunasan` saat pelanggan datang ambil pesanan. Kalau
DP yang dikirim kebetulan menutup seluruh tagihan, server otomatis
mengubahnya jadi `status_bayar: 'lunas'`.

### `POST /api/transaksi/:id/batalkan` — body

```jsonc
{
  "item_ids": [12, 13],   // opsional — kosongkan untuk batalkan SEMUA item aktif
  "alasan": "..."          // opsional
}
```
Aturan akses: `kasir` cuma bisa transaksi miliknya sendiri & dalam 30 menit
sejak dibuat; `admin_toko`/`super_admin` bebas kapan saja (dibatasi toko
untuk `admin_toko`). Kalau semua item di transaksi jadi batal, `status`
transaksi ikut berubah jadi `dibatalkan` (dan `status_preorder` ikut kalau
transaksi itu preorder). Diskon/pajak **tidak** disesuaikan proporsional
saat batal sebagian — cuma subtotal item yang batal yang dikurangkan.

## Laporan

| Method | Path | Role | Keterangan |
|---|---|---|---|
| GET | `/api/laporan/harian?tanggal=` | auth | Total penjualan & jumlah transaksi 1 hari |
| GET | `/api/laporan/tren-penjualan?hari=` | auth | Penjualan per hari, N hari terakhir (maks 90) |
| GET | `/api/laporan/margin?dari=&sampai=` | auth | Omzet, HPP, margin kotor + daftar produk tanpa resep |
| GET | `/api/laporan/kombinasi-terlaris?dari=&sampai=&limit=` | auth | Produk terlaris berdasarkan qty terjual |
| GET | `/api/laporan/jam-ramai?dari=&sampai=` | auth | Jumlah transaksi per jam (00–23, WIB) |
| GET | `/api/laporan/produk-terlaris` | auth | *(legacy, tidak dipakai UI — sudah digantikan kombinasi-terlaris)* |
| GET | `/api/laporan/stok-menipis` | auth | *(legacy, tidak dipakai UI — stok tidak dilacak lagi)* |

Semua laporan yang berbasis `detail_transaksi` (margin, kombinasi-terlaris)
otomatis menyaring item yang sudah dibatalkan (`is_batal=0`) dan transaksi
berstatus `dibatalkan`.

## Preorder

| Method | Path | Role | Keterangan |
|---|---|---|---|
| GET | `/api/preorder?status=` | auth | List preorder (`menunggu`\|`selesai`\|`dibatalkan`, kosong=semua) — tiap baris menyertakan `status_bayar`, `jumlah_dp`, `sisa_bayar` |
| PUT | `/api/preorder/:id/status` | auth | Ubah status preorder. **Menandai `'selesai'` ditolak** kalau `status_bayar` masih `'dp'`/`'belum_bayar'` (lunasi dulu lewat endpoint di bawah) |
| POST | `/api/preorder/:id/pelunasan` | auth | Terima pelunasan sisa bayar. Body: `{ "pembayaran": [{ "metode": "cash", "jumlah": 20000 }] }` (boleh >1 metode, boleh dicicil — tidak wajib langsung lunas dalam satu panggilan). Response: `{ status_bayar, sisa_bayar }` |

## Users

| Method | Path | Role | Keterangan |
|---|---|---|---|
| GET | `/api/users` | admin | List kasir/admin |
| POST | `/api/users` | admin | Tambah user |
| PUT | `/api/users/:id` | admin | Ubah user (termasuk reset password) |

## Log Aktivitas

| Method | Path | Role | Keterangan |
|---|---|---|---|
| GET | `/api/log-aktivitas` | admin | Audit trail |

---

## Catatan desain penting

- **Harga selalu server-truth.** Tidak ada satu pun endpoint yang menerima
  harga dari client dan langsung memakainya — semua dihitung ulang dari
  tabel `produk` saat request diterima.
- **Soft-delete vs hard-delete.** Produk/bahan-baku
  pakai `is_active=0` (bisa "dihidupkan" lagi manual). `resep_item` dan
  hasil `DELETE /api/transaksi/bulk` beneran hilang dari database.
- **Zona waktu.** Semua `created_at` disimpan UTC. Perbandingan "hari ini"/
  filter tanggal selalu digeser +7 jam (WIB) di level SQL lewat helper
  `wibDateExpr()`/`wibHourExpr()` di `public/js/lib/helpers.js` — jangan bandingkan
  tanggal mentah tanpa helper ini kalau menambah query baru.
- **HPP di-snapshot, bukan dihitung ulang.** `detail_transaksi.hpp_satuan`
  diisi sekali saat transaksi dibuat (dari resep yang berlaku saat itu),
  supaya laporan margin historis tidak berubah kalau harga bahan baku
  di-update belakangan.
