// kasir-app.js — Logika halaman Kasir/POS utama (index.html): transaksi,
// keranjang, produk, preorder, dst. Dipindah dari inline <script>
// supaya HTML murni markup.

        // ==========================================
        // 1. DATA & STATE MANAGEMENT
        // ==========================================
        // Ganti ke URL Worker API Anda saat deploy (kosongkan jika Pages & Worker
        // di-serve dari domain/route yang sama).
        const API_BASE = '';

        // Escape nilai apa pun yang berasal dari data (nama produk, kategori,
        // dst) SEBELUM disisipkan ke innerHTML lewat template string. Tanpa
        // ini, nama produk seperti "Teh Po'o" atau yang sengaja diisi tag
        // HTML akan dieksekusi sebagai markup/JS sungguhan — stored XSS.
        function escapeHtml(str) {
            if (str === null || str === undefined) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        // Placeholder foto produk yang BELUM ada gambarnya — di-generate lokal
        // sebagai SVG data URI (2 huruf awal nama produk di atas warna solid),
        // BUKAN dari layanan luar (ui-avatars.com dst). Sebelumnya pakai CDN
        // avatar generator eksternal, yang berarti kartu produk tanpa foto
        // gagal tampil sama sekali kalau HP sedang offline — bertentangan
        // dengan keseluruhan filosofi app ini yang harus 100% offline-ready.
        function localPlaceholderImg(nama) {
            const inisial = (nama || '?').trim().slice(0, 2).toUpperCase();
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">` +
                `<rect width="200" height="200" fill="#eff6ff"/>` +
                `<text x="100" y="100" font-family="system-ui,sans-serif" font-size="72" ` +
                `font-weight="700" fill="#2563eb" text-anchor="middle" dominant-baseline="central">${escapeHtml(inisial)}</text>` +
                `</svg>`;
            return `data:image/svg+xml,${encodeURIComponent(svg)}`;
        }

        // PENTING — kenapa fungsi ini perlu ada: gambar_url berbentuk
        // "/api/gambar/...". Path ini HANYA bisa "diselesaikan" lewat
        // window.fetch() yang di-patch fetch-shim.js (diarahkan ke router
        // lokal, bukan server sungguhan). Tapi <img src="..."> TIDAK
        // memanggil window.fetch() — itu request resource level-browser
        // asli, dan sw.js SENGAJA membiarkan semua /api/* lewat apa
        // adanya ke network asli (desain lama buat versi cloud yang /api/
        // memang server sungguhan). Di mode lokal, tidak ada server
        // sungguhan — jadi <img src="/api/gambar/..."> selalu gagal di
        // mana pun app ini dibuka (termasuk dibungkus APK), walau upload-
        // nya sendiri sukses. Solusi: ambil via fetch() yang benar, ubah
        // jadi blob URL lokal buat <img src>.
        const gambarBlobCache = new Map(); // apiPath -> blob: URL
        async function resolveGambarSrc(url) {
            if (!url || !url.startsWith('/api/gambar/')) return url;
            if (gambarBlobCache.has(url)) return gambarBlobCache.get(url);
            try {
                const res = await fetch(url);
                if (!res.ok) return null;
                const blob = await res.blob();
                const blobUrl = URL.createObjectURL(blob);
                gambarBlobCache.set(url, blobUrl);
                return blobUrl;
            } catch {
                return null;
            }
        }

        let products = []; // diisi via loadProducts() dari GET /api/produk
        let currentUser = null; // diisi via checkAuth() dari GET /api/auth/me
        let currentToko = null; // diisi via loadTokoInfo() dari GET /api/toko (toko milik user yang login)
        let activeShift = null; // diisi via checkShiftStatus() dari GET /api/shift/aktif

        // Cache status shift TERVERIFIKASI terakhir (hasil sukses dari server),
        // dipakai sebagai fallback saat checkShiftStatus() gagal karena koneksi
        // putus — supaya kasir yang sudah punya shift aktif TIDAK terkunci di
        // tengah jualan hanya karena satu request refresh badge gagal. Lihat
        // checkShiftStatus() untuk detail kapan ini dipakai/di-update.
        // Di-scope per-user (bukan key global) supaya kasir lain yang login di
        // perangkat yang sama (mis. shift bergantian) tidak salah mewarisi
        // status shift kasir sebelumnya saat device sedang offline.
        function shiftCacheKey() {
            return `kasir_shift_cache_v1_${currentUser?.id ?? 'anon'}`;
        }
        function cacheShiftState(shift) {
            try { localStorage.setItem(shiftCacheKey(), JSON.stringify({ shift, cachedAt: Date.now() })); } catch {}
        }
        function readCachedShiftState() {
            try {
                const raw = localStorage.getItem(shiftCacheKey());
                return raw ? JSON.parse(raw).shift : null;
            } catch { return null; }
        }
        function clearCachedShiftState() {
            try { localStorage.removeItem(shiftCacheKey()); } catch {}
        }

        // FIX (offline): dipakai sebagai fallback saat checkAuth() gagal karena
        // koneksi putus (bukan karena sesi sungguhan tidak valid) — supaya kasir
        // yang device-nya benar-benar offline saat app di-reload tidak langsung
        // terlempar ke login.html (yang juga butuh internet), padahal seluruh
        // tujuan antrian offline (IndexedDB) adalah supaya jualan tetap jalan
        // tanpa koneksi. Key tunggal (bukan per-user) karena identitas user
        // BELUM diketahui sebelum checkAuth() sukses sekali.
        function cacheAuthState(user) {
            try { localStorage.setItem('kasir_auth_cache_v1', JSON.stringify({ user, cachedAt: Date.now() })); } catch {}
        }
        function readCachedAuthState() {
            try {
                const raw = localStorage.getItem('kasir_auth_cache_v1');
                return raw ? JSON.parse(raw).user : null;
            } catch { return null; }
        }
        function clearCachedAuthState() {
            try { localStorage.removeItem('kasir_auth_cache_v1'); } catch {}
        }

        let cart = [];
        let heldCarts = [];
        // isRealOffline: status koneksi internet, dipantau otomatis lewat event
        // 'online'/'offline' browser (lihat listener di bawah). Kalau true,
        // transaksi baru disimpan lokal dulu (antrian IndexedDB) dan disinkron
        // otomatis begitu koneksi kembali.
        let isRealOffline = typeof navigator !== 'undefined' && 'onLine' in navigator ? !navigator.onLine : false;
        let activePaymentMethod = 'cash';
        let currentTotalPay = 0;
        let uangDiterimaStr = "";
        let currentCategory = 'Semua';
        let audioCtx;
        let cartDiskon = 0; // diskon transaksi (nominal Rp), diterapkan lewat modal-diskon

        // Pajak (%) — dulu dipaksa 11% di setiap transaksi. Sekarang bisa diedit
        // lewat modal-pajak, default KOSONG (0%) kalau belum pernah diatur.
        // Disimpan di localStorage (per perangkat/browser) supaya kasir tidak
        // perlu isi ulang tiap transaksi, tapi tetap bebas diubah kapan saja.
        let cartPajakPersen = parseFloat(localStorage.getItem('kasir_pajak_persen') || '0') || 0;

        // Split payment (bayar >1 metode dalam satu transaksi)
        let splitRows = [];
        let splitRowSeq = 0;
        const METODE_LABEL = { cash: 'Tunai', qris: 'QRIS', debit: 'Debit', transfer: 'Transfer' };

        const formatRp = (num) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(num);

        // ==========================================
        // 1.5 API INTEGRATION (Auth & Produk)
        // ==========================================

        /**
         * Pastikan user sudah login (cookie sesi valid). Redirect ke login.html
         * HANYA kalau server secara eksplisit bilang sesi tidak valid (401 /
         * success:false) — BUKAN kalau fetch-nya sendiri gagal karena device
         * benar-benar offline. Sebelumnya kedua kasus ini diperlakukan sama
         * (langsung redirect), yang berarti kasir yang offline saat app
         * di-reload/relaunch akan terkunci total di login.html (yang juga
         * butuh internet) — padahal tujuan antrian offline (IndexedDB) justru
         * supaya jualan tetap bisa jalan tanpa koneksi. Pola ini sama seperti
         * checkShiftStatus() di bawah.
         */
        async function checkAuth() {
            try {
                const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
                if (res.status === 401) {
                    clearCachedAuthState();
                    window.location.href = 'login.html';
                    return false;
                }
                const data = await res.json();
                if (!res.ok || !data.success) {
                    clearCachedAuthState();
                    window.location.href = 'login.html';
                    return false;
                }

                currentUser = data.user;
                cacheAuthState(currentUser);
                document.getElementById('receipt-kasir-nama').innerText = `Kasir: ${currentUser.nama_lengkap}`;
                updateDashboardMenuUI();
                return true;
            } catch {
                // fetch melempar error (bukan respons server) → kegagalan jaringan
                // murni. Pakai identitas TERVERIFIKASI terakhir kalau ada.
                const cached = readCachedAuthState();
                if (cached) {
                    currentUser = cached;
                    document.getElementById('receipt-kasir-nama').innerText = `Kasir: ${currentUser.nama_lengkap}`;
                    updateDashboardMenuUI();
                    showToast('Offline — memakai sesi terakhir yang tersimpan di perangkat ini.', 'warning');
                    return true;
                }
                window.location.href = 'login.html';
                return false;
            }
        }

        /** Menu "Dashboard Admin" di menu Akun cuma tampil untuk role admin_toko/super_admin — kasir tidak punya akses ke admin.html (lihat pengecekan role di admin.html juga). */
        function updateDashboardMenuUI() {
            const menu = document.getElementById('menu-dashboard');
            if (menu) menu.classList.toggle('hidden', !currentUser || currentUser.role === 'kasir');
        }

        /** Ambil judul aplikasi (bisa diubah via panel admin) & terapkan ke header + tab browser + struk. */
        // Pengaturan kustomisasi struk (diisi dari /api/settings, dipakai saat buildReceipt()
        // & cetak Bluetooth). Nilai default di sini dipakai kalau fetch gagal (mis. offline).
        let strukSettings = {
            struk_footer: 'Terima kasih atas kunjungan Anda',
            struk_catatan: '',
            struk_lebar_kertas: '58',
            struk_tampilkan_alamat: '1',
            struk_tampilkan_antrian: '1',
            struk_footer_ikon: 'tidak',
            struk_qr_data: '',
        };

        /** Ambil judul aplikasi & kustomisasi struk (bisa diubah via panel admin) & terapkan ke header + tab browser + struk. */
        async function loadAppTitle() {
            try {
                const res = await fetch(`${API_BASE}/api/settings`, { credentials: 'include' });
                const data = await res.json();
                const title = (data.success && data.data?.app_title) ? data.data.app_title : 'muidsoft';
                document.title = title;
                const headerEl = document.getElementById('app-title-header');
                if (headerEl) headerEl.innerText = title;

                if (data.success) {
                    strukSettings = {
                        struk_footer: data.data.struk_footer || strukSettings.struk_footer,
                        struk_catatan: data.data.struk_catatan ?? strukSettings.struk_catatan,
                        struk_lebar_kertas: data.data.struk_lebar_kertas || strukSettings.struk_lebar_kertas,
                        struk_tampilkan_alamat: data.data.struk_tampilkan_alamat ?? strukSettings.struk_tampilkan_alamat,
                        struk_tampilkan_antrian: data.data.struk_tampilkan_antrian ?? strukSettings.struk_tampilkan_antrian,
                        struk_footer_ikon: data.data.struk_footer_ikon || strukSettings.struk_footer_ikon,
                        struk_qr_data: data.data.struk_qr_data ?? strukSettings.struk_qr_data,
                    };
                    const printArea = document.getElementById('print-area');
                    if (printArea) printArea.classList.toggle('paper-80', strukSettings.struk_lebar_kertas === '80');
                    const alamatEl = document.getElementById('receipt-toko-alamat');
                    if (alamatEl) alamatEl.style.display = strukSettings.struk_tampilkan_alamat === '1' ? '' : 'none';
                }
            } catch {
                // Gagal ambil pengaturan (mis. offline) — biarkan judul & struk pakai default.
            }
        }

        /** Ambil data toko milik user yang login, dipakai untuk nama & alamat di kop struk. */
        async function loadTokoInfo() {
            try {
                const res = await fetch(`${API_BASE}/api/toko`, { credentials: 'include' });
                const data = await res.json();
                if (data.success && Array.isArray(data.data) && data.data.length > 0) {
                    currentToko = data.data.find(t => t.id === currentUser?.toko_id) || data.data[0];
                    const namaEl = document.getElementById('receipt-toko-nama');
                    const alamatEl = document.getElementById('receipt-toko-alamat');
                    if (namaEl) namaEl.innerText = currentToko.nama;
                    if (alamatEl) alamatEl.innerText = currentToko.alamat || '';
                }
            } catch {
                // Gagal ambil data toko — struk tetap tampilkan nilai default di HTML.
            }
        }



        /**
         * Cek status shift ke server. Untuk role 'kasir', kalau TERKONFIRMASI
         * belum ada shift aktif (server sukses menjawab), tampilkan modal
         * blocking (wajib diisi sebelum bisa jualan) — ini murni UX; validasi
         * sebenarnya tetap dipaksa di server saat POST /api/transaksi (jangan
         * pernah percaya validasi client saja).
         *
         * PENTING: kalau fetch GAGAL (jaringan putus, bukan respons server yang
         * bilang "tidak ada shift"), JANGAN anggap sama dengan "tidak ada shift"
         * — itu akan mengunci kasir yang sebenarnya sudah punya shift aktif
         * hanya karena satu request refresh gagal (mis. tepat setelah koneksi
         * putus di tengah jualan). Sebagai gantinya, pakai status TERVERIFIKASI
         * terakhir dari cache lokal. Modal blocking hanya muncul kalau memang
         * belum pernah ada shift terkonfirmasi SAMA SEKALI (mis. buka app
         * pertama kali dalam kondisi offline) — itu tetap butuh koneksi karena
         * shift baru tidak bisa dibuka/diverifikasi tanpa server.
         */
        async function checkShiftStatus() {
            let networkOk = true;
            try {
                const res = await fetch(`${API_BASE}/api/shift/aktif`, { credentials: 'include' });
                const data = await res.json();
                activeShift = data.success ? data.data : null;
                cacheShiftState(activeShift); // simpan hasil TERVERIFIKASI dari server
            } catch {
                networkOk = false;
                activeShift = readCachedShiftState(); // fallback ke status terverifikasi terakhir yang kita tahu
            }

            const btnShift = document.getElementById('btn-shift');
            const modalBuka = document.getElementById('modal-buka-shift');
            const errEl = document.getElementById('buka-shift-error');

            if (activeShift) {
                btnShift.classList.remove('hidden');
                document.getElementById('shift-badge-text').innerText =
                    (networkOk ? '' : '(offline) ') + formatRp(activeShift.perkiraan_kas_saat_ini ?? activeShift.modal_awal);
                modalBuka.classList.add('hidden'); modalBuka.classList.remove('flex');
            } else if (currentUser?.role === 'kasir') {
                // Kasir wajib buka shift dulu — modal ini tidak punya tombol tutup.
                btnShift.classList.add('hidden');
                modalBuka.classList.remove('hidden'); modalBuka.classList.add('flex');
                if (!networkOk) {
                    errEl.innerText = 'Tidak ada koneksi internet — sambungkan dulu untuk memverifikasi atau membuka shift.';
                    errEl.classList.remove('hidden');
                } else {
                    errEl.classList.add('hidden');
                }
            } else {
                // admin_toko/super_admin tidak dipaksa disiplin shift formal.
                btnShift.classList.add('hidden');
            }
        }

        async function submitBukaShift() {
            const raw = document.getElementById('input-modal-awal').value;
            const modalAwal = parseInt(raw || '0');
            const errEl = document.getElementById('buka-shift-error');
            errEl.classList.add('hidden');

            try {
                const res = await fetch(`${API_BASE}/api/shift/buka`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ modal_awal: modalAwal })
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || 'Gagal membuka shift');

                document.getElementById('input-modal-awal').value = '';
                await checkShiftStatus();
                showToast(`Shift dibuka dengan modal ${formatRp(modalAwal)}`);
            } catch (err) {
                // Shift TIDAK BISA dibuka offline (perlu server untuk memastikan
                // tidak ada shift ganda) — bedakan pesannya dari error validasi biasa
                // supaya kasir tahu ini soal koneksi, bukan input yang salah.
                errEl.innerText = (err instanceof TypeError)
                    ? 'Tidak ada koneksi internet — sambungkan dulu untuk membuka shift.'
                    : err.message;
                errEl.classList.remove('hidden');
            }
        }

        async function openTutupShiftModal() {
            // Refresh dulu supaya "perkiraan kas sistem" akurat sampai detik ini
            await checkShiftStatus();
            if (!activeShift) return;

            document.getElementById('ts-modal-awal').innerText = formatRp(activeShift.modal_awal);
            document.getElementById('ts-kas-sistem').innerText = formatRp(activeShift.perkiraan_kas_saat_ini);
            document.getElementById('input-kas-fisik').value = '';
            document.getElementById('input-catatan-shift').value = '';
            document.getElementById('selisih-preview').classList.add('hidden');

            const m = document.getElementById('modal-tutup-shift');
            m.classList.remove('hidden'); m.classList.add('flex');
        }

        function closeTutupShiftModal() {
            const m = document.getElementById('modal-tutup-shift');
            m.classList.add('hidden'); m.classList.remove('flex');
        }

        function updateSelisihPreview() {
            if (!activeShift) return;
            const kasFisik = parseInt(document.getElementById('input-kas-fisik').value || '0');
            const selisih = kasFisik - activeShift.perkiraan_kas_saat_ini;
            const box = document.getElementById('selisih-preview');
            box.classList.remove('hidden');

            if (selisih === 0) {
                box.className = 'rounded-xl p-3 text-center font-bold text-sm bg-green-50 text-green-700';
                box.innerText = 'Pas — tidak ada selisih ✓';
            } else if (selisih < 0) {
                box.className = 'rounded-xl p-3 text-center font-bold text-sm bg-red-50 text-red-600';
                box.innerText = `Kurang ${formatRp(Math.abs(selisih))}`;
            } else {
                box.className = 'rounded-xl p-3 text-center font-bold text-sm bg-amber-50 text-amber-700';
                box.innerText = `Lebih ${formatRp(selisih)}`;
            }
        }

        async function submitTutupShift() {
            const kasFisik = parseInt(document.getElementById('input-kas-fisik').value || '0');
            const catatan = document.getElementById('input-catatan-shift').value.trim();

            try {
                const res = await fetch(`${API_BASE}/api/shift/tutup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ kas_fisik_akhir: kasFisik, catatan: catatan || null })
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || 'Gagal menutup shift');

                closeTutupShiftModal();
                showShiftSelesai(data.data);
                activeShift = null;
                clearCachedShiftState();
                document.getElementById('btn-shift').classList.add('hidden');
            } catch (err) {
                showToast(err.message, 'error');
            }
        }

        function showShiftSelesai(shift) {
            const icon = document.getElementById('shift-selesai-icon');
            const detail = document.getElementById('shift-selesai-detail');
            const selisih = shift.selisih ?? 0;

            if (selisih === 0) {
                icon.className = 'w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-3 text-3xl bg-green-50 text-green-600';
                icon.innerHTML = '<i class="fas fa-check-circle"></i>';
            } else {
                icon.className = 'w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-3 text-3xl bg-amber-50 text-amber-600';
                icon.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
            }

            const label = selisih === 0 ? 'Kas pas, tidak ada selisih.' : selisih < 0
                ? `Kas kurang ${formatRp(Math.abs(selisih))} dari sistem.`
                : `Kas lebih ${formatRp(selisih)} dari sistem.`;
            detail.innerText = `Kas sistem: ${formatRp(shift.kas_sistem_akhir)} • Kas fisik: ${formatRp(shift.kas_fisik_akhir)}. ${label}`;

            const m = document.getElementById('modal-shift-selesai');
            m.classList.remove('hidden'); m.classList.add('flex');
        }

        /** Ambil daftar produk aktif dari backend & mapping ke bentuk yang dipakai UI. */
        async function loadProducts() {
            try {
                const res = await fetch(`${API_BASE}/api/produk`, { credentials: 'include' });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || 'Gagal memuat produk');

                products = data.data.map(p => ({
                    id: p.id,
                    nama: p.nama,
                    harga: p.harga_jual,
                    img: localPlaceholderImg(p.nama), // render cepat dulu; foto asli (kalau ada) menyusul async, lihat resolveProductImagesAsync()
                    apiGambarUrl: p.gambar_url || null,
                    barcode: p.kode_produk,
                    kategori: p.kategori_nama || 'Lainnya'
                }));

                renderCategoryFilters();
                renderProducts();
                resolveProductImagesAsync();
            } catch (err) {
                showToast(err.message || 'Gagal memuat produk. Cek koneksi.', 'error');
            }
        }

        /**
         * Ambil foto produk asli (kalau ada) di LATAR BELAKANG setelah grid
         * sudah tampil dengan placeholder — supaya kasir tidak menunggu
         * network/IndexedDB selesai dulu baru bisa lihat produk (grid yang
         * responsif itu penting banget di layar ini, dipakai terus-menerus
         * sepanjang hari). Begitu satu foto selesai di-resolve, langsung
         * ditempel ke <img> yang sesuai lewat data-product-img — tidak perlu
         * render ulang grid semuanya.
         */
        async function resolveProductImagesAsync() {
            const withPhoto = products.filter(p => p.apiGambarUrl);
            for (const p of withPhoto) {
                const src = await resolveGambarSrc(p.apiGambarUrl);
                if (!src) continue; // gagal resolve — biarkan placeholder tetap tampil
                p.img = src;
                const el = document.querySelector(`[data-product-img="${p.id}"]`);
                if (el) el.src = src;
            }
        }

        /** Render tombol filter kategori secara dinamis berdasarkan kategori yang benar-benar ada di data produk. */
        function renderCategoryFilters() {
            const wrap = document.getElementById('category-filters');
            const kategoriList = ['Semua', ...new Set(products.map(p => p.kategori))];
            wrap.innerHTML = kategoriList.map((k, i) => `
                <button class="cat-btn px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap active:scale-95 transition ${i === 0 ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'bg-white text-slate-600 border border-slate-200'}" data-cat="${escapeHtml(k)}">${escapeHtml(k)}</button>
            `).join('');
            bindCategoryFilterEvents();
        }

        function bindCategoryFilterEvents() {
            document.querySelectorAll('.cat-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    document.querySelectorAll('.cat-btn').forEach(b => {
                        b.classList.remove('bg-blue-600', 'text-white', 'shadow-md', 'shadow-blue-200');
                        b.classList.add('bg-white', 'text-slate-600', 'border-slate-200');
                    });
                    const target = e.currentTarget;
                    target.classList.remove('bg-white', 'text-slate-600', 'border-slate-200');
                    target.classList.add('bg-blue-600', 'text-white', 'shadow-md', 'shadow-blue-200');
                    currentCategory = target.dataset.cat;
                    renderProducts(document.getElementById('search-input').value);
                });
            });
        }

        // ==========================================
        // KONFIRMASI KUSTOM (pengganti native confirm() browser)
        // ==========================================
        let _confirmResolver = null;

        /**
         * Tampilkan modal konfirmasi bergaya app (bukan popup bawaan browser).
         * Return Promise<boolean> — resolve(true) kalau user tekan tombol Oke.
         */
        function showConfirm(message, opts = {}) {
            const {
                title = 'Konfirmasi',
                okText = 'Oke',
                cancelText = 'Batal',
                icon = 'fa-triangle-exclamation',
                tone = 'danger', // 'danger' (merah) atau 'primary' (biru)
            } = opts;

            document.getElementById('confirm-title').innerText = title;
            document.getElementById('confirm-message').innerText = message;
            document.getElementById('confirm-btn-ok').innerText = okText;
            document.getElementById('confirm-btn-cancel').innerText = cancelText;

            const iconWrap = document.getElementById('confirm-icon-wrap');
            const iconEl = document.getElementById('confirm-icon');
            const okBtn = document.getElementById('confirm-btn-ok');
            iconEl.className = `fas ${icon} text-xl ${tone === 'danger' ? 'text-red-500' : 'text-blue-500'}`;
            iconWrap.className = `w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-4 ${tone === 'danger' ? 'bg-red-50' : 'bg-blue-50'}`;
            okBtn.className = `py-3.5 rounded-2xl text-white font-bold shadow-lg active:scale-[0.98] transition ${tone === 'danger' ? 'bg-red-500 shadow-red-200' : 'bg-blue-600 shadow-blue-200'}`;

            const m = document.getElementById('modal-confirm');
            m.classList.remove('hidden'); m.classList.add('flex');

            return new Promise((resolve) => { _confirmResolver = resolve; });
        }

        function resolveConfirm(result) {
            const m = document.getElementById('modal-confirm');
            m.classList.add('hidden'); m.classList.remove('flex');
            if (_confirmResolver) { _confirmResolver(result); _confirmResolver = null; }
        }

        async function doLogout() {
            const ok = await showConfirm('Anda akan keluar dari sesi kasir saat ini.', {
                title: 'Keluar dari Kasir?',
                okText: 'Ya, Keluar',
                icon: 'fa-sign-out-alt',
                tone: 'danger',
            });
            if (!ok) return;
            try {
                await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
            } finally {
                sessionStorage.removeItem('kasir_user');
                clearCachedAuthState();
                window.location.href = 'login.html';
            }
        }

        function toggleAccountMenu() {
            const m = document.getElementById('modal-account');
            if (m.classList.contains('hidden')) {
                document.getElementById('account-nama').innerText = currentUser ? currentUser.nama_lengkap : 'Akun';
                m.classList.remove('hidden'); m.classList.add('flex');
            } else {
                m.classList.add('hidden'); m.classList.remove('flex');
            }
        }

        function openChangePasswordModal() {
            document.getElementById('form-password').reset();
            document.getElementById('password-error').classList.add('hidden');
            const m = document.getElementById('modal-password');
            m.classList.remove('hidden'); m.classList.add('flex');
        }

        function closeChangePasswordModal() {
            const m = document.getElementById('modal-password');
            m.classList.add('hidden'); m.classList.remove('flex');
        }

        async function submitChangePassword(e) {
            e.preventDefault();
            const errEl = document.getElementById('password-error');
            errEl.classList.add('hidden');

            const password_lama = document.getElementById('password-lama').value;
            const password_baru = document.getElementById('password-baru').value;
            const konfirmasi = document.getElementById('password-konfirmasi').value;

            if (password_baru !== konfirmasi) {
                errEl.innerText = 'Konfirmasi password baru tidak cocok.';
                errEl.classList.remove('hidden');
                return;
            }

            try {
                const res = await fetch(`${API_BASE}/api/auth/change-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ password_lama, password_baru }),
                });
                const data = await res.json();
                if (!data.success) {
                    errEl.innerText = data.error || 'Gagal mengubah password.';
                    errEl.classList.remove('hidden');
                    return;
                }
                closeChangePasswordModal();
                showToast('Password berhasil diubah');
            } catch (err) {
                errEl.innerText = 'Gagal terhubung ke server.';
                errEl.classList.remove('hidden');
            }
        }

        // ==========================================
        // 2. INDEXED DB LOGIC (REAL IMPLEMENTATION)
        // ==========================================
        const DB_NAME = 'KasirCloud_MobileDB';
        const STORE_NAME = 'offline_tx';
        let db;

        function initDB() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, 1);
                request.onupgradeneeded = (event) => {
                    db = event.target.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME, { keyPath: 'offline_uuid' });
                    }
                };
                request.onsuccess = (event) => { db = event.target.result; resolve(); checkOfflineQueue(); };
                request.onerror = (event) => reject("DB Error");
            });
        }

        function saveTxToIDB(tx) {
            return new Promise((resolve) => {
                const transaction = db.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                store.add(tx);
                transaction.oncomplete = () => { checkOfflineQueue(); resolve(); };
            });
        }

        function getTxFromIDB() {
            return new Promise((resolve) => {
                const transaction = db.transaction([STORE_NAME], 'readonly');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result);
            });
        }

        function deleteTxFromIDB(uuid) {
            return new Promise((resolve) => {
                const transaction = db.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                store.delete(uuid);
                transaction.oncomplete = () => resolve();
            });
        }

        async function checkOfflineQueue() {
            if(!db) return;
            const records = await getTxFromIDB();
            const badge = document.getElementById('header-status');

            if (isRealOffline) {
                badge.innerHTML = `<i class="fas fa-circle text-[8px] text-red-500 mr-1 shadow-[0_0_5px_#ef4444]"></i>Offline — ${records.length} transaksi tertunda`;
            } else {
                badge.innerHTML = `<i class="fas fa-circle text-[8px] text-green-400 mr-1 shadow-[0_0_5px_#4ade80]"></i>Online`;
                if (records.length > 0) syncOfflineData();
            }
        }

        async function syncOfflineData() {
            if(isRealOffline) return;
            const records = await getTxFromIDB();
            if(records.length === 0) return;

            const ind = document.getElementById('sync-indicator');
            const icon = document.getElementById('sync-icon');
            const text = document.getElementById('sync-text');
            
            ind.classList.remove('-translate-y-10', 'opacity-0');
            ind.classList.add('translate-y-4', 'opacity-100');
            icon.className = 'fas fa-sync fa-spin text-blue-400';
            text.innerText = `Syncing ${records.length} transaksi...`;

            let berhasil = 0;
            let gagal = 0;

            for (let tx of records) {
                try {
                    const subtotalTx = tx.items.reduce((s, i) => s + i.harga * i.qty, 0);
                    const diskonTx = tx.diskon || 0; // fallback 0 untuk record IDB lama sebelum fitur diskon ada
                    const payload = {
                        offline_uuid: tx.offline_uuid,
                        items: tx.items.map(i => ({
                            id: i.id,
                            qty: i.qty,
                        })),
                        diskon: diskonTx,
                        pajak: tx.total - (subtotalTx - diskonTx),
                        is_preorder: tx.is_preorder || undefined,
                        waktu_ambil: tx.waktu_ambil || undefined,
                        nama_pemesan: tx.nama_pemesan || undefined,
                        hp_pemesan: tx.hp_pemesan || undefined,
                        status_bayar: tx.status_bayar || undefined,
                    };
                    // Format baru (pembayaran array/split-payment); fallback ke format
                    // lama untuk record IndexedDB yang tersimpan sebelum update ini.
                    if (tx.pembayaran) {
                        payload.pembayaran = tx.pembayaran;
                    } else {
                        payload.metode_bayar = tx.metode;
                        payload.uang_diterima = tx.metode === 'cash' ? tx.diterima : undefined;
                    }
                    const res = await fetch(`${API_BASE}/api/transaksi`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify(payload)
                    });
                    const data = await res.json();
                    if (!res.ok || !data.success) throw new Error(data.error);

                    // Server mengecek offline_uuid untuk mencegah duplikasi (idempotent),
                    // jadi baris ini aman dihapus dari antrian lokal setelah dikonfirmasi server.
                    await deleteTxFromIDB(tx.offline_uuid);
                    berhasil++;
                } catch {
                    // Biarkan tersisa di antrian, dicoba lagi di sync berikutnya
                    gagal++;
                }
            }

            if (gagal === 0) {
                icon.className = 'fas fa-check-circle text-green-400';
                text.innerText = `Semua data tersinkronisasi! (${berhasil} transaksi)`;
            } else {
                icon.className = 'fas fa-exclamation-triangle text-orange-400';
                text.innerText = `${berhasil} sukses, ${gagal} gagal — dicoba lagi nanti`;
            }
            checkOfflineQueue();

            setTimeout(() => {
                ind.classList.remove('translate-y-4', 'opacity-100');
                ind.classList.add('-translate-y-10', 'opacity-0');
            }, 2000);
        }

        // ==========================================
        // 3. UI RENDERING & FILTERING
        // ==========================================
        function initAudio() {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
        }

        function playFeedback(type) {
            initAudio();
            if (navigator.vibrate) navigator.vibrate(type === 'success' ? [30, 50, 30] : 20);
            const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
            osc.connect(gain); gain.connect(audioCtx.destination);
            
            if (type === 'beep') {
                osc.type = 'sine'; osc.frequency.setValueAtTime(850, audioCtx.currentTime);
                gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
                osc.start(); gain.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.1);
                osc.stop(audioCtx.currentTime + 0.1);
            } else if (type === 'success') {
                osc.type = 'triangle'; osc.frequency.setValueAtTime(523.25, audioCtx.currentTime);
                osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.1);
                gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
                osc.start(); gain.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.3);
                osc.stop(audioCtx.currentTime + 0.3);
            }
        }

        function renderProducts(searchQuery = '') {
            const grid = document.getElementById('product-grid');
            grid.innerHTML = '';
            
            let filtered = products;
            if (currentCategory !== 'Semua') {
                filtered = filtered.filter(p => p.kategori === currentCategory);
            }
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                filtered = filtered.filter(p => p.nama.toLowerCase().includes(q) || p.barcode.includes(q));
            }

            if(filtered.length === 0) {
                grid.innerHTML = `
                    <div class="col-span-2 sm:col-span-3 flex flex-col items-center justify-center text-center py-16 px-6">
                        <div class="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style="background:linear-gradient(160deg,#eef1fb,#dbe2f4);">
                            <i class="fas fa-box-open text-2xl" style="color:#8497ce;"></i>
                        </div>
                        <p class="text-slate-600 font-bold text-sm mb-1">Produk tidak ditemukan</p>
                        <p class="text-slate-400 text-xs">Coba kata kunci lain, atau tambah produk baru lewat menu Admin.</p>
                    </div>`;
                return;
            }

            filtered.forEach((p, index) => {
                const card = document.createElement('div');
                card.className = 'card-hover product-card rounded-2xl p-3 flex flex-col active:scale-95 transition-transform touch-manipulation cursor-pointer product-pop-in';
                card.style.animationDelay = `${Math.min(index * 22, 260)}ms`;
                card.onclick = () => {
                    playFeedback('beep');
                    card.classList.add('animate-tap');
                    setTimeout(() => card.classList.remove('animate-tap'), 200);
                    addToCart(p);
                };
                card.innerHTML = `
                    <div class="relative mb-2">
                        <img src="${escapeHtml(p.img)}" data-product-img="${p.id}" class="w-full aspect-square object-cover rounded-xl bg-slate-50 border border-slate-100" loading="lazy">
                    </div>
                    <h3 class="font-bold text-slate-700 text-[11px] leading-tight mb-1 line-clamp-2">${escapeHtml(p.nama)}</h3>
                    <p class="price-figure text-[#a17423] font-bold text-sm mt-auto">${formatRp(p.harga)}</p>
                `;
                grid.appendChild(card);
            });
        }

        // ==========================================
        // 4. CART & DRAWER LOGIC
        // ==========================================
        let isDrawerOpen = false;
        
        function toggleCartDrawer() {
            isDrawerOpen = !isDrawerOpen;
            const drawer = document.getElementById('cart-drawer');
            const bg = document.getElementById('cart-drawer-bg');
            const floating = document.getElementById('floating-cart');
            
            if (isDrawerOpen) {
                drawer.classList.remove('drawer-closed'); drawer.classList.add('drawer-open');
                bg.classList.remove('opacity-0', 'pointer-events-none');
                floating.classList.add('translate-y-24'); 
            } else {
                drawer.classList.remove('drawer-open'); drawer.classList.add('drawer-closed');
                bg.classList.add('opacity-0', 'pointer-events-none');
                if(cart.length > 0) floating.classList.remove('translate-y-24');
            }
        }

        // Produk digabung per id (klik berkali-kali cukup nambah qty).
        function addToCart(product) {
            const idx = cart.findIndex(i => i.cartKey === `p${product.id}`);
            if (idx > -1) cart[idx].qty += 1;
            else cart.push({ id: product.id, nama: product.nama, harga: product.harga, qty: 1, cartKey: `p${product.id}` });

            updateCartUI();

            if (!isDrawerOpen) {
                const fc = document.getElementById('floating-cart');
                fc.classList.remove('hidden', 'translate-y-24');
                fc.classList.add('animate-tap');
                setTimeout(() => fc.classList.remove('animate-tap'), 200);
                showToast(product.nama);
            }
        }

        function updateQty(idx, delta) {
            playFeedback('beep');
            cart[idx].qty += delta;
            if (cart[idx].qty <= 0) cart.splice(idx, 1);
            updateCartUI();
        }

        // ==========================================
        // 4c. INPUT QTY MANUAL (ketuk angka qty di cart)
        // ==========================================
        let qtyModalIdx = null;

        function editQtyManual(idx) {
            qtyModalIdx = idx;
            const item = cart[idx];
            document.getElementById('qty-modal-nama').innerText = item.nama;
            const input = document.getElementById('input-qty-manual');
            input.value = String(item.qty);
            const m = document.getElementById('modal-qty');
            m.classList.remove('hidden'); m.classList.add('flex');
            setTimeout(() => { input.focus(); input.select(); }, 50);
        }

        function closeQtyModal() {
            const m = document.getElementById('modal-qty');
            m.classList.add('hidden'); m.classList.remove('flex');
            qtyModalIdx = null;
        }

        function applyQtyManual() {
            if (qtyModalIdx === null) return;
            const val = parseInt(document.getElementById('input-qty-manual').value || '0');
            if (val <= 0) cart.splice(qtyModalIdx, 1);
            else cart[qtyModalIdx].qty = val;
            closeQtyModal();
            updateCartUI();
        }
        function clearCart(fromDrawer = false) { if(cart.length === 0) return; cart = []; cartDiskon = 0; updateCartUI(); if(fromDrawer) toggleCartDrawer(); }

        function updateCartUI() {
            const container = document.getElementById('cart-items');
            const floating = document.getElementById('floating-cart');
            
            if (cart.length === 0) {
                container.innerHTML = '<div class="text-center text-slate-400 py-10"><i class="fas fa-shopping-basket text-4xl mb-2 text-slate-200"></i><p class="font-bold text-sm">Keranjang Kosong</p></div>';
                document.getElementById('btn-pay').disabled = true;
                floating.classList.add('translate-y-24'); 
                setTimeout(() => { if(cart.length===0) floating.classList.add('hidden'); }, 300);
                cartDiskon = 0; // diskon tidak boleh nyangkut ke transaksi berikutnya
                updateTotals(0);
                return;
            }

            let subtotal = 0; let totalItems = 0;
            container.innerHTML = '';
            
            cart.forEach((item, index) => {
                subtotal += (item.harga * item.qty);
                totalItems += item.qty;
                const detailLines = [];
                const detailHtml = detailLines.length > 0
                    ? `<p class="text-[10px] text-slate-400 truncate">${escapeHtml(detailLines.join(' • '))}</p>` : '';
                const catatanHtml = item.catatan
                    ? `<p class="text-[10px] text-amber-600 italic truncate">"${escapeHtml(item.catatan)}"</p>` : '';
                container.innerHTML += `
                    <div class="flex items-center gap-3 bg-white p-3 rounded-2xl border border-slate-100 shadow-sm">
                        <div class="flex-1 min-w-0">
                            <h4 class="font-bold text-xs text-slate-800 truncate">${escapeHtml(item.nama)}</h4>
                            ${detailHtml}
                            ${catatanHtml}
                            <p class="text-[10px] text-blue-600 font-bold mt-0.5">${formatRp(item.harga)}</p>
                        </div>
                        <div class="flex flex-col items-end shrink-0 gap-2">
                            <p class="font-bold text-xs text-slate-800">${formatRp(item.harga * item.qty)}</p>
                            <div class="flex items-center gap-2 bg-slate-50 rounded-lg border border-slate-200 p-1">
                                <button onclick="updateQty(${index}, -1)" class="w-6 h-6 flex items-center justify-center bg-white rounded shadow-sm text-slate-600 active:scale-95"><i class="fas fa-minus text-[10px]"></i></button>
                                <button onclick="editQtyManual(${index})" class="w-8 text-center text-xs font-bold active:text-blue-600 transition">${item.qty}</button>
                                <button onclick="updateQty(${index}, 1)" class="w-6 h-6 flex items-center justify-center bg-white rounded shadow-sm text-slate-600 active:scale-95"><i class="fas fa-plus text-[10px]"></i></button>
                            </div>
                        </div>
                    </div>`;
            });

            document.getElementById('btn-pay').disabled = false;
            updateTotals(subtotal, totalItems);
        }

        function updateTotals(subtotal, totalItems = 0) {
            const diskon = Math.min(cartDiskon, subtotal);
            const dpp = subtotal - diskon; // Dasar Pengenaan Pajak (setelah diskon)
            const tax = dpp * (cartPajakPersen / 100);
            currentTotalPay = dpp + tax;
            document.getElementById('cart-subtotal').innerText = formatRp(subtotal);
            document.getElementById('cart-diskon').innerText = `- ${formatRp(diskon)}`;
            document.getElementById('cart-tax').innerText = formatRp(tax);
            document.getElementById('cart-total').innerText = formatRp(currentTotalPay);
            document.getElementById('fc-count').innerText = totalItems;
            const fcTotalEl = document.getElementById('fc-total');
            const totalBerubah = fcTotalEl.innerText !== formatRp(currentTotalPay);
            fcTotalEl.innerText = formatRp(currentTotalPay);
            // Denyut kecil tiap kali angkanya beneran berubah — feedback taktil
            // ringan tanpa kasir perlu baca ulang angka tiap nambah/kurang item.
            if (totalBerubah && currentTotalPay > 0) {
                fcTotalEl.classList.remove('animate-number-pop');
                void fcTotalEl.offsetWidth; // restart animasi kalau dipanggil beruntun
                fcTotalEl.classList.add('animate-number-pop');
            }
        }

        // ==========================================
        // 4b. DISKON TRANSAKSI
        // ==========================================
        // Status bayar preorder saat ini: 'lunas' (bayar penuh di muka, default),
        // 'dp' (bayar sebagian, sisanya dilunasi saat ambil), atau 'belum_bayar'
        // (belum ada yang diterima, bayar penuh saat ambil). Cuma relevan kalau
        // form preorder sedang dibuka — untuk transaksi biasa selalu 'lunas'.
        let preorderStatusBayar = 'lunas';

        function togglePreorderForm() {
            playFeedback('beep');
            const form = document.getElementById('preorder-form');
            const chevron = document.getElementById('preorder-chevron');
            const willOpen = form.classList.contains('hidden');
            form.classList.toggle('hidden');
            chevron.classList.toggle('rotate-180', willOpen);
            document.getElementById('preorder-toggle-btn').classList.toggle('border-amber-300', willOpen);
            document.getElementById('preorder-toggle-btn').classList.toggle('bg-amber-50', willOpen);
            if (willOpen) {
                // Default waktu ambil: 1 jam dari sekarang, dibulatkan ke 15 menit terdekat.
                const d = new Date(Date.now() + 60 * 60 * 1000);
                d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
                document.getElementById('preorder-waktu').value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                setPreorderStatusBayar('lunas');
            } else {
                updatePayButtonLabel();
            }
        }

        function resetPreorderForm() {
            document.getElementById('preorder-form').classList.add('hidden');
            document.getElementById('preorder-chevron').classList.remove('rotate-180');
            document.getElementById('preorder-toggle-btn').classList.remove('border-amber-300', 'bg-amber-50');
            document.getElementById('preorder-waktu').value = '';
            document.getElementById('preorder-nama').value = '';
            document.getElementById('preorder-hp').value = '';
            setPreorderStatusBayar('lunas');
        }

        // Ganti status bayar preorder (Lunas/DP/Bayar Nanti) — mengatur tampilan
        // input DP, grid metode bayar, dan label tombol utama supaya kasir tidak
        // bingung apa yang akan terjadi saat menekan tombol bayar.
        function setPreorderStatusBayar(status) {
            preorderStatusBayar = status;
            document.querySelectorAll('.preorder-status-btn').forEach(btn => {
                const active = btn.dataset.status === status;
                btn.classList.toggle('border-amber-500', active);
                btn.classList.toggle('bg-amber-500', active);
                btn.classList.toggle('text-white', active);
                btn.classList.toggle('border-slate-200', !active);
                btn.classList.toggle('bg-white', !active);
                btn.classList.toggle('text-slate-500', !active);
            });
            const methodGrid = document.getElementById('payment-methods');
            const note = document.getElementById('preorder-status-bayar-note');
            // Grid metode bayar cuma relevan untuk 'lunas' (dibayar penuh
            // sekarang lewat alur normal). 'dp' & 'belum_bayar' punya alurnya
            // sendiri lewat tombol utama (modal pembayaran sebagian / langsung
            // simpan tanpa bayar), jadi grid disembunyikan biar tidak membingungkan.
            methodGrid.classList.toggle('hidden', status !== 'lunas');
            const notes = {
                lunas: 'Pelanggan bayar penuh sekarang.',
                dp: 'Tekan tombol di bawah untuk input jumlah DP yang diterima (bisa >1 metode bayar). Sisanya dilunasi saat ambil pesanan.',
                belum_bayar: 'Belum ada yang dibayar. Total tagihan dilunasi penuh saat pelanggan ambil pesanan.',
            };
            note.innerText = notes[status] || '';
            updatePayButtonLabel();
        }

        // Label tombol utama menyesuaikan konteks: transaksi biasa/preorder lunas
        // tetap "Bayar Sekarang", tapi DP/Bayar Nanti diberi label yang jujur
        // supaya kasir tidak salah kira uang penuh sudah diterima.
        function updatePayButtonLabel() {
            const preorderAktif = !document.getElementById('preorder-form').classList.contains('hidden');
            const label = document.getElementById('btn-pay-label');
            if (!preorderAktif || preorderStatusBayar === 'lunas') {
                label.innerText = 'Bayar Sekarang';
            } else if (preorderStatusBayar === 'dp') {
                label.innerText = 'Simpan Pesanan + Terima DP';
            } else {
                label.innerText = 'Simpan Pesanan (Bayar Nanti)';
            }
        }

        function openDiskonModal() {
            if (cart.length === 0) return;
            const subtotal = cart.reduce((s, i) => s + i.harga * i.qty, 0);
            document.getElementById('diskon-max-info').innerText = formatRp(subtotal);
            document.getElementById('input-diskon').value = cartDiskon > 0 ? String(cartDiskon) : '';
            const m = document.getElementById('modal-diskon');
            m.classList.remove('hidden'); m.classList.add('flex');
        }

        function closeDiskonModal() {
            const m = document.getElementById('modal-diskon');
            m.classList.add('hidden'); m.classList.remove('flex');
        }

        function applyDiskon() {
            const subtotal = cart.reduce((s, i) => s + i.harga * i.qty, 0);
            let val = parseInt(document.getElementById('input-diskon').value || '0');
            if (val > subtotal) val = subtotal; // diskon tidak boleh melebihi subtotal
            cartDiskon = val;
            closeDiskonModal();
            updateCartUI();
            if (val > 0) showToast(`Diskon ${formatRp(val)} diterapkan`);
        }

        // ==========================================
        // 4c. PAJAK TRANSAKSI
        // ==========================================
        function openPajakModal() {
            if (cart.length === 0) return;
            document.getElementById('input-pajak').value = cartPajakPersen > 0 ? String(cartPajakPersen) : '';
            const m = document.getElementById('modal-pajak');
            m.classList.remove('hidden'); m.classList.add('flex');
        }

        function closePajakModal() {
            const m = document.getElementById('modal-pajak');
            m.classList.add('hidden'); m.classList.remove('flex');
        }

        function setPajakQuick(persen) {
            document.getElementById('input-pajak').value = persen > 0 ? String(persen) : '';
        }

        function applyPajak() {
            let val = parseFloat(document.getElementById('input-pajak').value || '0');
            if (isNaN(val) || val < 0) val = 0;
            if (val > 100) val = 100; // jaga-jaga input tidak masuk akal
            cartPajakPersen = val;
            localStorage.setItem('kasir_pajak_persen', String(val)); // diingat untuk transaksi berikutnya
            closePajakModal();
            updateCartUI();
            showToast(val > 0 ? `Pajak ${val}% diterapkan` : 'Pajak dihapus (0%)');
        }

        let _toastTimer = null;
        function showToast(msg, type = 'success') {
            const t = document.getElementById('toast');
            const iconWrap = document.getElementById('toast-icon-wrap');
            const iconEl = document.getElementById('toast-icon');
            document.getElementById('toast-msg').innerText = msg;

            // FIX: sebelumnya ikon toast selalu hijau/centang walau pesannya error
            // (mis. gagal akses kamera) — sekarang warna & ikon menyesuaikan tipe.
            const styles = {
                success: { bg: 'bg-blue-500', icon: 'fa-check' },
                error: { bg: 'bg-red-500', icon: 'fa-xmark' },
                warning: { bg: 'bg-amber-500', icon: 'fa-triangle-exclamation' },
            };
            const s = styles[type] || styles.success;
            iconWrap.className = `w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${s.bg}`;
            iconEl.className = `fas ${s.icon} text-white`;

            // FIX: sebelumnya setTimeout tidak disimpan/di-clear — kalau ada toast
            // baru muncul sebelum toast sebelumnya selesai (mis. tap produk
            // beruntun), timer LAMA tetap jalan dan menyembunyikan toast BARU
            // sebelum waktunya (toast berkedip/hilang lebih cepat dari 2 detik).
            if (_toastTimer) clearTimeout(_toastTimer);
            t.classList.remove('-translate-y-32'); t.classList.add('translate-y-0');
            _toastTimer = setTimeout(() => { t.classList.remove('translate-y-0'); t.classList.add('-translate-y-32'); }, 2000);
        }

        // ==========================================
        // 5. PAYMENT & NUMPAD
        // ==========================================
        document.querySelectorAll('.pay-method').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.pay-method').forEach(b => {
                    b.classList.remove('border-blue-600', 'bg-blue-50', 'text-blue-700', 'border-2');
                    b.classList.add('border-slate-200', 'text-slate-500', 'border');
                });
                const target = e.currentTarget;
                target.classList.remove('border-slate-200', 'text-slate-500', 'border');
                target.classList.add('border-blue-600', 'bg-blue-50', 'text-blue-700', 'border-2');
                activePaymentMethod = target.dataset.method;
            });
        });

        function triggerPayment() {
            if (cart.length === 0) return;
            const preorderAktif = !document.getElementById('preorder-form').classList.contains('hidden');
            if (preorderAktif && preorderStatusBayar === 'belum_bayar') {
                // Tidak ada uang diterima sekarang — langsung simpan pesanan,
                // sisa bayar dilunasi penuh nanti saat pelanggan ambil.
                finalizeTransaction([]);
                return;
            }
            if (preorderAktif && preorderStatusBayar === 'dp') {
                if (isDrawerOpen) toggleCartDrawer();
                openPartialPayModal('dp', currentTotalPay);
                return;
            }
            if (activePaymentMethod === 'cash') {
                uangDiterimaStr = "";
                document.getElementById('numpad-tagihan').innerText = formatRp(currentTotalPay);
                updateNumpadDisplay();
                const m = document.getElementById('numpad-modal');
                m.classList.remove('drawer-closed'); m.classList.add('drawer-open');
                toggleCartDrawer(); // Tutup keranjang di belakang layar
            } else if (activePaymentMethod === 'split') {
                openSplitModal();
            } else {
                processFinalPayment(0, 0); 
            }
        }

        function cancelNumpad() {
            const m = document.getElementById('numpad-modal');
            m.classList.remove('drawer-open'); m.classList.add('drawer-closed');
            // Buka kembali drawer keranjang karena dibatalkan
            setTimeout(() => { if(!isDrawerOpen) toggleCartDrawer(); }, 300);
        }

        function typeNumpad(val) {
            playFeedback('beep');
            // Mencegah "0" di awal
            if(uangDiterimaStr === "" && (val === "0" || val === "000")) return;
            
            if (val === 'C') uangDiterimaStr = uangDiterimaStr.slice(0, -1);
            else if (uangDiterimaStr.length < 10) uangDiterimaStr += val;
            updateNumpadDisplay();
        }
        function setUangDiterima(val) { playFeedback('beep'); if (val === 'pas') uangDiterimaStr = currentTotalPay.toString(); updateNumpadDisplay(); }
        function addUang(val) { 
            playFeedback('beep'); 
            let current = parseInt(uangDiterimaStr || "0"); 
            uangDiterimaStr = (current + val).toString(); 
            updateNumpadDisplay(); 
        }

        function updateNumpadDisplay() {
            const val = parseInt(uangDiterimaStr || "0");
            document.getElementById('input-diterima').value = val > 0 ? formatRp(val) : "";
            let kembalian = val - currentTotalPay;
            const elKembalian = document.getElementById('numpad-kembalian');
            const btnConfirm = document.getElementById('btn-confirm-pay');
            
            if (kembalian >= 0 && val > 0) {
                elKembalian.innerText = formatRp(kembalian); elKembalian.classList.replace('text-red-500', 'text-green-500'); btnConfirm.disabled = false;
            } else {
                elKembalian.innerText = val > 0 ? "- " + formatRp(Math.abs(kembalian)) : "Rp 0"; elKembalian.classList.replace('text-green-500', 'text-red-500'); btnConfirm.disabled = true;
            }
        }

        // Wrapper tipis untuk alur single-method lama (numpad tunai / tap QRIS-debit
        // langsung). Membungkus input jadi 1 baris `pembayaran`, lalu diteruskan ke
        // finalizeTransaction() yang sama dengan alur split payment.
        async function processFinalPayment(forceDiterima, forceKembali) {
            const diterima = forceDiterima !== undefined ? forceDiterima : parseInt(uangDiterimaStr);

            const m = document.getElementById('numpad-modal');
            if(m.classList.contains('drawer-open')){
                m.classList.remove('drawer-open'); m.classList.add('drawer-closed');
            }
            if(isDrawerOpen) toggleCartDrawer();

            const entries = activePaymentMethod === 'cash'
                ? [{ metode: 'cash', jumlah: diterima }]
                : [{ metode: activePaymentMethod, jumlah: currentTotalPay }];

            await finalizeTransaction(entries);
        }

        /**
         * Titik masuk tunggal untuk menyimpan transaksi, dipakai baik oleh alur
         * pembayaran satu metode (cash/qris/debit) maupun split payment. `entries`
         * berbentuk [{ metode, jumlah }, ...] — kembalian dihitung ulang di sini
         * dengan aturan yang sama seperti server (kembalian hanya sah dari tunai)
         * supaya struk yang tampil di layar konsisten dengan yang tersimpan di DB.
         */
        async function finalizeTransaction(entries) {
            const uuid = crypto.randomUUID ? crypto.randomUUID() : `OFF-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const subtotal = cart.reduce((s, i) => s + i.harga * i.qty, 0);
            const diskon = Math.min(cartDiskon, subtotal);
            const dpp = subtotal - diskon; // Dasar Pengenaan Pajak, samakan dengan updateTotals()
            const pajak = currentTotalPay - dpp;

            const cashTotal = entries.filter(e => e.metode === 'cash').reduce((s, e) => s + e.jumlah, 0);
            const nonCashTotal = entries.filter(e => e.metode !== 'cash').reduce((s, e) => s + e.jumlah, 0);
            const kembalian = Math.max(0, cashTotal - (currentTotalPay - nonCashTotal));

            // Preorder (opsional) — dibaca dari form yang di-toggle di cart drawer.
            const preorderAktif = !document.getElementById('preorder-form').classList.contains('hidden');
            const preorderWaktu = document.getElementById('preorder-waktu').value;
            if (preorderAktif && !preorderWaktu) {
                showToast('Isi tanggal & jam ambil untuk preorder, atau matikan togglenya', 'warning');
                if (!isDrawerOpen) toggleCartDrawer();
                return;
            }
            // Sisa bayar dihitung di sini juga (bukan cuma andalkan respons
            // server) supaya struk tetap benar walau transaksi jatuh ke antrian
            // offline (belum sempat dapat respons server sama sekali).
            const diterimaSekarang = entries.reduce((s, e) => s + e.jumlah, 0);
            let sisaBayarPreorder = 0;
            let statusBayarEfektif = 'lunas';
            if (preorderAktif && preorderStatusBayar === 'belum_bayar') {
                sisaBayarPreorder = currentTotalPay;
                statusBayarEfektif = 'belum_bayar';
            } else if (preorderAktif && preorderStatusBayar === 'dp') {
                sisaBayarPreorder = Math.max(0, currentTotalPay - diterimaSekarang);
                statusBayarEfektif = sisaBayarPreorder > 0 ? 'dp' : 'lunas';
            }

            const preorderData = preorderAktif ? {
                is_preorder: true,
                waktu_ambil: new Date(preorderWaktu).toISOString(),
                nama_pemesan: document.getElementById('preorder-nama').value.trim() || undefined,
                hp_pemesan: document.getElementById('preorder-hp').value.trim() || undefined,
                status_bayar: preorderStatusBayar,
            } : {};

            const txData = {
                offline_uuid: uuid,
                items: [...cart],
                total: currentTotalPay,
                diskon,
                pembayaran: entries,
                kembalian,
                timestamp: new Date().toISOString(),
                nomor_antrian: null, // diisi dari respons server di bawah (offline: tetap null sampai sync)
                id: null, // idem — dipakai tombol "Batalkan Transaksi Ini"
                ...preorderData,
                status_bayar: statusBayarEfektif,
                sisa_bayar: sisaBayarPreorder,
            };

            const payload = {
                offline_uuid: uuid,
                items: cart.map(i => ({
                    id: i.id,
                    qty: i.qty,
                })),
                pembayaran: entries,
                diskon,
                pajak: pajak,
                ...preorderData,
            };

            if (isRealOffline) {
                // Koneksi asli sedang terputus → langsung antre lokal, tidak usah coba fetch dulu (pasti gagal/timeout).
                await saveTxToIDB(txData);
            } else {
                // Mode online: coba kirim langsung ke server. Kalau fetch gagal
                // (mati listrik router, sinyal hilang, dsb — bukan cuma simulasi),
                // otomatis fallback ke antrian offline agar transaksi TIDAK HILANG.
                //
                // FIX (offline): sebelumnya blok catch ini menangkap DUA hal yang
                // beda — kegagalan jaringan ASLI (fetch() melempar) DAN penolakan
                // SAH dari server (respons balik tapi success:false, mis. shift
                // belum dibuka / produk nonaktif / stok berubah) — keduanya
                // diperlakukan sama: masuk antrian IndexedDB dengan pesan "koneksi
                // bermasalah". Transaksi yang DITOLAK server itu akan gagal lagi
                // dan lagi setiap kali disinkronkan (ditolak dengan alasan yang
                // sama), macet permanen di antrian TANPA pernah tercatat di
                // database — padahal struk sudah tercetak & barang sudah keluar,
                // jadi penjualan ini tidak akan pernah muncul di laporan. Sekarang
                // keduanya dibedakan: hanya kegagalan jaringan murni yang masuk
                // antrian offline; penolakan server ditampilkan apa adanya supaya
                // kasir tahu harus memperbaiki sesuatu (mis. buka shift dulu),
                // bukan mengira ini cuma masalah sinyal.
                let res;
                try {
                    res = await fetch(`${API_BASE}/api/transaksi`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify(payload)
                    });
                } catch (networkErr) {
                    await saveTxToIDB(txData);
                    showToast('Koneksi bermasalah — transaksi disimpan & akan disinkronkan otomatis.', 'warning');
                    resetPreorderForm();
                    setTimeout(() => buildReceipt(txData), 350);
                    if (activeShift) checkShiftStatus();
                    return;
                }

                const data = await res.json().catch(() => ({ success: false, error: 'Respons server tidak valid' }));
                if (!res.ok || !data.success) {
                    // Server benar-benar MENOLAK transaksi ini — jangan diam-diam
                    // ditumpuk ke antrian offline (akan gagal terus tanpa henti).
                    // Beri tahu kasir apa adanya supaya transaksi bisa diperbaiki
                    // & dicoba ulang secara sadar.
                    showToast(data.error || 'Transaksi ditolak server', 'error');
                    return;
                }
                txData.nomor_antrian = data.nomor_antrian ?? null;
                txData.id = data.id ?? null; // dipakai tombol "Batalkan Transaksi Ini" di struk
                // PENTING: timpa dgn angka yg SERVER hitung ulang (bukan cuma
                // perkiraan client). Server selalu recompute total_bayar dari
                // harga produk TERKINI — kalau harga berubah antara barang
                // masuk keranjang & tombol bayar ditekan, sisa_bayar/status_bayar
                // versi client bisa beda dari yang tersimpan di DB. Struk harus
                // ikut angka yang benar-benar tercatat.
                if (data.sisa_bayar !== undefined) txData.sisa_bayar = data.sisa_bayar;
                if (data.status_bayar !== undefined) txData.status_bayar = data.status_bayar;
                if (data.jumlah_dp !== undefined) txData.jumlah_dp = data.jumlah_dp;
            }

            resetPreorderForm();
            setTimeout(() => buildReceipt(txData), 350);

            // Refresh perkiraan kas di badge header (hanya relevan kalau ada shift
            // aktif; transaksi yang jatuh ke antrian offline baru tercermin di kas
            // sistem setelah tersinkronisasi ke server).
            if (activeShift) checkShiftStatus();
        }

        // Data transaksi terakhir yang berhasil dibuat strukmya — dipakai ulang oleh
        // cetak Bluetooth (printReceiptViaBluetooth) supaya tidak perlu baca ulang DOM.
        let lastReceiptData = null;

        /**
         * Render area ikon footer struk sesuai pengaturan admin (Kustomisasi Struk):
         * - 'tidak'  : kosong, footer cuma teks
         * - 'qr'     : QR code ASLI (bisa di-scan) dari strukSettings.struk_qr_data,
         *              digenerate client-side pakai QRCode.js (tidak kirim data ke
         *              server pihak ketiga mana pun — semua diproses di browser).
         * - 'judul'  : nama aplikasi/toko ditampilkan sebagai teks besar (mirip logo teks)
         */
        function renderReceiptIcon() {
            const area = document.getElementById('receipt-icon-area');
            if (!area) return;
            area.innerHTML = '';

            if (strukSettings.struk_footer_ikon === 'qr' && strukSettings.struk_qr_data) {
                try {
                    const box = document.createElement('div');
                    box.style.display = 'inline-block';
                    area.appendChild(box);
                    new QRCode(box, { text: strukSettings.struk_qr_data, width: 90, height: 90, correctLevel: QRCode.CorrectLevel.M });
                } catch {
                    // Library QR gagal dimuat (mis. sedang offline) — biarkan area kosong,
                    // jangan sampai gagal render struk gara-gara ini.
                }
            } else if (strukSettings.struk_footer_ikon === 'judul') {
                const el = document.createElement('p');
                el.className = 'font-extrabold text-sm tracking-wide';
                el.innerText = currentToko?.nama || document.title || 'muidsoft';
                area.appendChild(el);
            }
            // 'tidak' → area dibiarkan kosong
        }

        /**
         * Toggle "cetak nomor antrian" LOKAL per-device — beda dengan
         * strukSettings.struk_tampilkan_antrian (setting global dari admin,
         * ke semua device/kasir). Ini cuma override di device ini saja,
         * disimpan di localStorage (bukan dikirim ke server), untuk kasir
         * yang mau nyala/matiin nomor antrian sendiri tanpa masuk ke admin
         * dan tanpa mengubah setting kasir lain. null = ikut setting admin.
         */
        const LOCAL_ANTRIAN_KEY = 'kasir_local_cetak_antrian';

        function getEfektifTampilkanAntrian() {
            const lokal = localStorage.getItem(LOCAL_ANTRIAN_KEY);
            return lokal !== null ? lokal : (strukSettings.struk_tampilkan_antrian ?? '1');
        }

        function toggleAntrianLokal(checked) {
            localStorage.setItem(LOCAL_ANTRIAN_KEY, checked ? '1' : '0');
            const antrianWrap = document.getElementById('receipt-antrian-wrap');
            if (antrianWrap) antrianWrap.classList.toggle('hidden', !checked);
        }

        // Warna confetti dari palet brand sendiri (navy/gold/emerald) supaya
        // tetap terasa "punya identitas", bukan confetti pelangi generik.
        const BURST_COLORS = ['#d6ac42', '#34d399', '#60a5fa', '#f59e0b', '#16244d'];

        function triggerSuccessBurst() {
            const wrap = document.getElementById('success-burst');
            if (!wrap) return;
            const particles = Array.from({ length: 14 }).map((_, i) => {
                const angle = (360 / 14) * i + (Math.random() * 14 - 7);
                const dist = 70 + Math.random() * 50;
                const color = BURST_COLORS[i % BURST_COLORS.length];
                return `<span class="burst-particle" style="--angle:${angle}deg; --dist:${dist}px; background:${color}; animation-delay:${(Math.random() * 0.08).toFixed(2)}s;"></span>`;
            }).join('');
            wrap.innerHTML = `
                <div class="burst-ring"></div>
                <div class="burst-ring ring-2"></div>
                <div class="burst-check"><i class="fas fa-check"></i></div>
                ${particles}
            `;
            wrap.classList.remove('hidden'); wrap.classList.add('flex');
            wrap.style.opacity = '1';
            clearTimeout(triggerSuccessBurst._t);
            triggerSuccessBurst._t = setTimeout(() => {
                wrap.style.transition = 'opacity 0.25s ease-out';
                wrap.style.opacity = '0';
                setTimeout(() => {
                    wrap.classList.add('hidden'); wrap.classList.remove('flex');
                    wrap.style.transition = ''; wrap.style.opacity = '1';
                    wrap.innerHTML = '';
                }, 250);
            }, 700);
        }

        function buildReceipt(txData) {
            playFeedback('success');
            triggerSuccessBurst();
            const trxId = `TRX-${Date.now().toString().slice(-6)}`;
            lastReceiptData = { ...txData, trxId, timestampMs: Date.now(), dibatalkan: false };
            document.getElementById('receipt-date').innerText = new Date().toLocaleString('id-ID', {dateStyle:'short', timeStyle:'short'});
            document.getElementById('receipt-trx').innerText = trxId;
            document.getElementById('receipt-method').innerText = txData.pembayaran.length === 0
                ? 'BELUM BAYAR'
                : txData.pembayaran.length > 1
                ? 'SPLIT'
                : (METODE_LABEL[txData.pembayaran[0].metode] || txData.pembayaran[0].metode).toUpperCase();

            // Tombol batal (di header, tetap ada walau struk sudah ditutup) cuma
            // aktif kalau transaksinya sudah benar-benar tercatat di server (punya
            // id). Kalau masih di antrian offline (id belum ada), sembunyikan —
            // pembatalannya di luar cakupan tombol ini, jarang terjadi & butuh
            // penanganan manual.
            updateBatalTerakhirButton();

            const footerEl = document.getElementById('receipt-footer');
            if (footerEl) footerEl.innerText = strukSettings.struk_footer || 'Terima Kasih';
            const catatanEl = document.getElementById('receipt-catatan');
            if (catatanEl) {
                if (strukSettings.struk_catatan) {
                    catatanEl.innerText = strukSettings.struk_catatan;
                    catatanEl.style.display = '';
                } else {
                    catatanEl.style.display = 'none';
                }
            }
            renderReceiptIcon();

            // Offline: nomor antrian baru diketahui setelah tersinkron ke server.
            const antrianWrap = document.getElementById('receipt-antrian-wrap');
            const tampilkanAntrian = getEfektifTampilkanAntrian() === '1';
            const toggleAntrianEl = document.getElementById('toggle-antrian-lokal');
            if (toggleAntrianEl) toggleAntrianEl.checked = tampilkanAntrian;
            if (tampilkanAntrian) {
                antrianWrap.classList.remove('hidden');
                document.getElementById('receipt-antrian').innerText = txData.nomor_antrian != null ? String(txData.nomor_antrian) : '—';
            } else {
                antrianWrap.classList.add('hidden');
            }

            const preorderWrap = document.getElementById('receipt-preorder-wrap');
            if (txData.is_preorder && txData.waktu_ambil) {
                preorderWrap.classList.remove('hidden');
                document.getElementById('receipt-preorder-waktu').innerText = new Date(txData.waktu_ambil).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
                const siapa = [txData.nama_pemesan, txData.hp_pemesan].filter(Boolean).join(' — ');
                document.getElementById('receipt-preorder-pemesan').innerText = siapa;
            } else {
                preorderWrap.classList.add('hidden');
            }

            let itemsHtml = ''; let sub = 0;
            txData.items.forEach(i => {
                sub += (i.harga * i.qty);
                const detailLines = [];
                const detailHtml = detailLines.length > 0 ? `<div class="text-[10px] text-slate-500">${escapeHtml(detailLines.join(' • '))}</div>` : '';
                const catatanHtml = i.catatan ? `<div class="text-[10px] italic text-slate-500">"${escapeHtml(i.catatan)}"</div>` : '';
                itemsHtml += `<div><div class="font-bold">${escapeHtml(i.nama)}</div>${detailHtml}${catatanHtml}<div class="flex justify-between text-[10px]"><span>${i.qty} x ${formatRp(i.harga)}</span><span>${formatRp(i.harga * i.qty)}</span></div></div>`;
            });
            document.getElementById('receipt-items').innerHTML = itemsHtml;
            document.getElementById('r-subtotal').innerText = formatRp(sub);

            const diskonRow = document.getElementById('r-diskon-row');
            const diskon = txData.diskon || 0;
            if (diskon > 0) {
                diskonRow.style.display = 'flex';
                document.getElementById('r-diskon').innerText = `- ${formatRp(diskon)}`;
            } else {
                diskonRow.style.display = 'none';
            }

            const dpp = sub - diskon;
            const pajakNominal = txData.pajak || 0;
            const taxRow = document.getElementById('r-tax-row');
            if (pajakNominal > 0) {
                taxRow.style.display = 'flex';
                // Persen dihitung balik dari nominal supaya struk selalu cocok
                // dengan pajak yang benar-benar diterapkan saat transaksi ini,
                // bukan diasumsikan 11% seperti sebelumnya.
                const persen = dpp > 0 ? Math.round((pajakNominal / dpp) * 1000) / 10 : 0;
                document.getElementById('r-tax-label').innerText = `Pajak (${persen}%):`;
                document.getElementById('r-tax').innerText = formatRp(pajakNominal);
            } else {
                taxRow.style.display = 'none';
            }
            document.getElementById('r-total').innerText = formatRp(txData.total);

            // Rincian tiap metode yang dipakai (1 baris kalau single-method, >1 kalau split)
            document.getElementById('receipt-payment-rows').innerHTML = txData.pembayaran.map(p => `
                <div class="flex justify-between"><span>${METODE_LABEL[p.metode] || p.metode}:</span><span>${formatRp(p.jumlah)}</span></div>
            `).join('');

            const changeRow = document.getElementById('receipt-change-row');
            if (txData.kembalian > 0) {
                changeRow.style.display = 'flex';
                document.getElementById('r-change').innerText = formatRp(txData.kembalian);
            } else {
                changeRow.style.display = 'none';
            }

            // Sisa bayar (khusus preorder DP / belum bayar) — dicetak mencolok
            // supaya tidak kelewat saat serah terima barang.
            const sisaRow = document.getElementById('receipt-sisa-row');
            const sisaBayar = txData.sisa_bayar || 0;
            if (txData.is_preorder && sisaBayar > 0) {
                sisaRow.classList.remove('hidden');
                document.getElementById('r-sisa-label').innerText = txData.status_bayar === 'dp' ? 'SISA BAYAR (saat ambil):' : 'BELUM DIBAYAR (saat ambil):';
                document.getElementById('r-sisa-bayar').innerText = formatRp(sisaBayar);
            } else {
                sisaRow.classList.add('hidden');
            }

            const m = document.getElementById('modal-receipt');
            m.classList.remove('hidden'); m.classList.add('flex');
            clearCart();
        }

        function closeReceipt() {
            const m = document.getElementById('modal-receipt');
            m.classList.add('hidden'); m.classList.remove('flex');
        }

        const BATAS_WAKTU_BATAL_MENIT = 30; // samakan dengan batas di server (src/index.ts)

        /**
         * Tombol "Batalkan" di header — SENGAJA terpisah dari modal struk (bukan
         * di dalamnya) supaya tetap bisa diakses walau kasir sudah klik "Tutup &
         * Transaksi Baru" (alur normal: cetak struk lalu tutup buat lanjut ke
         * pembeli berikutnya). Cuma tampil kalau transaksi terakhir sudah
         * tercatat di server (punya id) & masih dalam batas waktu pembatalan.
         */
        function updateBatalTerakhirButton() {
            const btn = document.getElementById('menu-batalkan');
            if (!lastReceiptData?.id || lastReceiptData.dibatalkan) {
                btn.classList.add('hidden');
                return;
            }
            const menitBerlalu = (Date.now() - lastReceiptData.timestampMs) / 60000;
            btn.classList.toggle('hidden', menitBerlalu > BATAS_WAKTU_BATAL_MENIT);
        }
        // Cek berkala tiap 30 detik supaya tombol otomatis hilang begitu lewat
        // batas waktu, bukan nunggu kasir buka transaksi lain dulu baru ke-update.
        setInterval(updateBatalTerakhirButton, 30000);

        /**
         * Batalkan transaksi terakhir yang dibuat kasir ini — bisa dipanggil dari
         * menu Akun (kapan saja dalam 30 menit). Buka modal pemilih item supaya
         * kasir bisa batalkan sebagian item saja (mis. cuma 1 dari 3 produk),
         * bukan cuma seluruh transaksi.
         */
        let batalItemTransaksiId = null;

        async function batalkanTransaksiIni() {
            if (!lastReceiptData?.id) return;
            await openBatalItemModal(lastReceiptData.id);
        }

        let batalItemPembayaran = []; // metode pembayaran transaksi yg lagi dibuka di modal batal item

        async function openBatalItemModal(transaksiId) {
            try {
                const res = await fetch(`${API_BASE}/api/transaksi/${transaksiId}`, { credentials: 'include' });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || 'Gagal memuat detail transaksi');

                batalItemTransaksiId = transaksiId;
                batalItemPembayaran = data.data.pembayaran || [];
                document.getElementById('batal-item-kode').innerText = data.data.kode_transaksi;
                document.getElementById('batal-item-alasan').value = '';

                const itemAktif = data.data.items.filter(i => !i.is_batal);
                if (itemAktif.length === 0) {
                    showToast('Semua item di transaksi ini sudah dibatalkan', 'warning');
                    return;
                }
                document.getElementById('batal-item-list').innerHTML = itemAktif.map(i => {
                    const detailLines = [];
                    if (i.ukuran_nama) detailLines.push(i.ukuran_nama);
                    if (i.topping_json) {
                        try { detailLines.push(JSON.parse(i.topping_json).map(t => t.nama).join(', ')); } catch {}
                    }
                    return `
                        <label class="flex items-start gap-3 border border-slate-200 rounded-xl px-3 py-2.5 cursor-pointer">
                            <input type="checkbox" checked value="${i.id}" data-subtotal="${i.subtotal}" class="batal-item-chk mt-0.5 accent-red-600 rounded">
                            <span class="flex-1 min-w-0">
                                <span class="block text-sm font-bold text-slate-700">${i.qty}x ${escapeHtml(i.nama_produk)}</span>
                                ${detailLines.length > 0 ? `<span class="block text-[11px] text-slate-400">${escapeHtml(detailLines.join(' • '))}</span>` : ''}
                            </span>
                            <span class="text-xs font-bold text-slate-500 shrink-0">${formatRp(i.subtotal)}</span>
                        </label>`;
                }).join('');

                const m = document.getElementById('modal-batal-item');
                m.classList.remove('hidden'); m.classList.add('flex');
            } catch (err) {
                showToast(err.message || 'Gagal memuat detail transaksi', 'error');
            }
        }

        function closeBatalItemModal() {
            const m = document.getElementById('modal-batal-item');
            m.classList.add('hidden'); m.classList.remove('flex');
            batalItemTransaksiId = null;
        }

        async function submitBatalItem() {
            const checkedEls = [...document.querySelectorAll('.batal-item-chk:checked')];
            if (checkedEls.length === 0) {
                showToast('Pilih minimal 1 item untuk dibatalkan', 'warning');
                return;
            }
            const checked = checkedEls.map(el => Number(el.value));
            const nominalDibatalkan = checkedEls.reduce((s, el) => s + Number(el.dataset.subtotal), 0);
            const totalItem = document.querySelectorAll('.batal-item-chk').length;
            const alasan = document.getElementById('batal-item-alasan').value.trim();

            // Pengingat kembalikan uang tunai — pembayaran tunai sudah diterima
            // fisik saat transaksi dibuat, sistem TIDAK otomatis mengatur ulang
            // kas laci/kembalian saat item dibatalkan, jadi kasir wajib
            // mengembalikan uang tunainya sendiri secara fisik ke pembeli.
            const adaCash = batalItemPembayaran.some(p => p.metode_bayar === 'cash');
            const pesanUang = adaCash
                ? `\n\n⚠️ Kembalikan uang tunai ${formatRp(nominalDibatalkan)} ke pembeli secara fisik — sistem tidak melakukan ini otomatis.`
                : `\n\nNominal ${formatRp(nominalDibatalkan)} ini dibayar non-tunai (${batalItemPembayaran.map(p => METODE_LABEL[p.metode_bayar] || p.metode_bayar).join('/')}) — proses pengembaliannya di luar aplikasi ini.`;

            const ok = await showConfirm(
                (checked.length === totalItem
                    ? 'Seluruh transaksi ini akan ditandai batal dan tidak ikut dihitung ke laporan penjualan.'
                    : `${checked.length} item yang dicentang akan ditandai batal. Sisanya tetap dihitung normal.`) + pesanUang,
                { title: 'Batalkan item ini?', okText: 'Ya, Batalkan', icon: 'fa-ban', tone: 'danger' }
            );
            if (!ok) return;

            try {
                const res = await fetch(`${API_BASE}/api/transaksi/${batalItemTransaksiId}/batalkan`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ item_ids: checked, alasan: alasan || undefined }),
                });
                const data = await res.json().catch(() => ({ success: false, error: 'Respons server tidak valid' }));
                if (!res.ok || !data.success) {
                    showToast(data.error || 'Gagal membatalkan item', 'error');
                    return;
                }
                showToast(`${data.jumlah_item_dibatalkan} item dibatalkan (${formatRp(data.nominal_dikurangi)})`);
                closeBatalItemModal();
                if (lastReceiptData && lastReceiptData.id === batalItemTransaksiId && data.transaksi_dibatalkan_total) {
                    lastReceiptData.dibatalkan = true;
                }
                updateBatalTerakhirButton();
            } catch (err) {
                showToast('Gagal membatalkan item — cek koneksi internet', 'error');
            }
        }

        // ==========================================================
        // CETAK LANGSUNG KE PRINTER (Bluetooth thermal, ESC/POS)
        // ==========================================================
        // Catatan kompatibilitas: pakai Web Bluetooth API — HANYA didukung
        // Chrome/Edge di Android & Desktop (Safari/iOS TIDAK mendukung Web
        // Bluetooth sama sekali). Printer thermal Bluetooth murah umumnya
        // meng-expose profil serial generik, bukan profil "Bluetooth Printer"
        // standar, jadi daftar UUID di bawah mencakup kandidat paling umum
        // dipakai vendor printer kasir. Aplikasi ini SENGAJA hanya menyediakan
        // jalur cetak Bluetooth langsung (bukan cetak lewat dialog browser) —
        // kalau printer tidak cocok dengan salah satu profil ini, coba
        // sambungkan ke printer lain.
        const BT_PRINTER_SERVICES = [0x18f0, 0xffe0, 0xff00];
        let btDevice = null;
        let btCharacteristic = null;

        function updateBtPrinterLabel() {
            const label = document.getElementById('btn-bt-print-label');
            if (label) label.innerText = btCharacteristic ? `Cetak ke ${btDevice?.name || 'Printer'}` : 'Cetak Langsung ke Printer';
        }

        async function connectBluetoothPrinter() {
            if (!navigator.bluetooth) {
                showToast('Perangkat/browser ini tidak mendukung Bluetooth langsung (pakai Chrome di Android/Desktop)', 'error');
                return false;
            }
            try {
                const device = await navigator.bluetooth.requestDevice({
                    acceptAllDevices: true,
                    optionalServices: BT_PRINTER_SERVICES,
                });
                const server = await device.gatt.connect();
                let characteristic = null;
                for (const svcId of BT_PRINTER_SERVICES) {
                    try {
                        const service = await server.getPrimaryService(svcId);
                        const chars = await service.getCharacteristics();
                        characteristic = chars.find(c => c.properties.writeWithoutResponse) || chars.find(c => c.properties.write) || null;
                        if (characteristic) break;
                    } catch {
                        // Service ini tidak ada di printer ini — coba kandidat berikutnya.
                    }
                }
                if (!characteristic) {
                    showToast('Printer terhubung, tapi profil cetak tidak dikenali. Coba sambungkan ke printer lain.', 'error');
                    return false;
                }
                device.addEventListener('gattserverdisconnected', () => {
                    btDevice = null; btCharacteristic = null;
                    updateBtPrinterLabel();
                });
                btDevice = device;
                btCharacteristic = characteristic;
                updateBtPrinterLabel();
                showToast(`Printer "${device.name || 'Bluetooth'}" terhubung`, 'success');
                return true;
            } catch (err) {
                if (err.name === 'NotFoundError') return false; // user batal pilih device — bukan error
                // Pesan spesifik per jenis error — sama pola dengan openScanModal().
                // NotSupportedError DAN pesan yang menyebut "not implemented"/
                // "not available" biasanya berarti WebView di HP ini memang tidak
                // punya UI device-picker Bluetooth sama sekali (beda dari sekadar
                // izin ditolak) — lihat catatan di scripts/patch-android-
                // permissions.mjs soal keterbatasan Web Bluetooth di WebView.
                const pesanKhusus = {
                    SecurityError: 'Izin Bluetooth ditolak. Buka Pengaturan HP → Aplikasi → izinkan akses Bluetooth & Lokasi (untuk pencarian perangkat) untuk app ini, lalu coba lagi.',
                    NotSupportedError: 'Fitur pemilih perangkat Bluetooth tidak tersedia di versi Android/WebView HP ini. Coba update "Android System WebView" lewat Play Store.',
                    NetworkError: 'Gagal terhubung ke printer — pastikan printer menyala, dekat dengan HP, dan tidak sedang tersambung ke perangkat lain.',
                }[err.name];
                showToast(pesanKhusus || `Gagal menghubungkan printer (${err.name || 'error'}): ${err.message}`, 'error');
                return false;
            }
        }

        /**
         * Bangun perintah ESC/POS standar "GS ( k" untuk mencetak QR code NATIF
         * di printer (bukan gambar) — didukung hampir semua printer thermal
         * modern (Epson TM-series & kompatibelnya). Model 2, ukuran modul 6,
         * error correction M (15%) — kombinasi paling umum & aman dipakai.
         */
        function escposQrCode(data) {
            const enc = new TextEncoder();
            const dataBytes = enc.encode(data);
            const parts = [];
            const push = (arr) => parts.push(new Uint8Array(arr));

            push([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]); // pilih model QR 2
            push([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]); // ukuran modul = 6
            push([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]); // error correction level M

            const len = dataBytes.length + 3;
            push([0x1d, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30]); // simpan data QR
            parts.push(dataBytes);
            push([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]); // cetak QR dari buffer

            const total = parts.reduce((s, c) => s + c.length, 0);
            const out = new Uint8Array(total);
            let offset = 0;
            for (const c of parts) { out.set(c, offset); offset += c.length; }
            return out;
        }

        /** Bangun perintah ESC/POS (byte mentah) dari data struk terakhir. */
        function buildEscPosReceipt(txData) {
            const lebar = strukSettings.struk_lebar_kertas === '80' ? 48 : 32; // perkiraan karakter/baris pakai font default
            const enc = new TextEncoder();
            const chunks = [];
            // FIX: Intl.NumberFormat('id-ID', {style:'currency'...}) menyisipkan
            // NO-BREAK SPACE (U+00A0) antara "Rp" dan angkanya (bukan spasi biasa
            // U+0020) — kalau dikirim apa adanya, printer thermal murah (yang
            // cuma paham 1-byte code page seperti CP437, bukan UTF-8) akan
            // mencetak karakter aneh/rusak di TIAP harga di struk. Dinormalisasi
            // ke spasi biasa di sini, sebelum di-encode jadi byte utk printer.
            const text = (s) => chunks.push(enc.encode(s.replace(/\u00a0/g, ' ')));
            const line = (left = '', right = '') => {
                const space = Math.max(1, lebar - left.length - right.length);
                text(left + ' '.repeat(space) + right + '\n');
            };
            const hr = () => text('-'.repeat(lebar) + '\n');
            const ESC = 0x1b, GS = 0x1d;
            const init = () => chunks.push(new Uint8Array([ESC, 0x40]));
            const align = (n) => chunks.push(new Uint8Array([ESC, 0x61, n])); // 0 kiri, 1 tengah, 2 kanan
            const bold = (on) => chunks.push(new Uint8Array([ESC, 0x45, on ? 1 : 0]));
            const cut = () => chunks.push(new Uint8Array([GS, 0x56, 0x42, 0x00]));
            const feed = (n) => chunks.push(new Uint8Array([ESC, 0x64, n]));

            init();
            align(1); bold(true);
            text(`${currentToko?.nama || 'muidsoft'}\n`);
            bold(false);
            if (strukSettings.struk_tampilkan_alamat === '1' && currentToko?.alamat) text(`${currentToko.alamat}\n`);
            align(0);
            hr();
            text(`${txData.trxId}\n`);
            text(`${new Date().toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}\n`);
            text(`Kasir: ${currentUser?.nama_lengkap || '-'}\n`);
            hr();

            // Nomor antrian besar-besaran (mirip di layar) — kalau belum diketahui
            // (transaksi masih di antrian offline), tampilkan placeholder. Bisa
            // dimatikan lewat pengaturan admin (Kustomisasi Struk), atau di-override
            // khusus device ini lewat toggle di modal struk (lihat toggleAntrianLokal).
            if (getEfektifTampilkanAntrian() === '1') {
                align(1); bold(true);
                text(`NOMOR ANTRIAN: ${txData.nomor_antrian != null ? txData.nomor_antrian : '-'}\n`);
                bold(false); align(0);
            }
            if (txData.is_preorder && txData.waktu_ambil) {
                hr();
                align(1);
                text(`** PREORDER - AMBIL NANTI **\n`);
                text(`${new Date(txData.waktu_ambil).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}\n`);
                const siapa = [txData.nama_pemesan, txData.hp_pemesan].filter(Boolean).join(' - ');
                if (siapa) text(`${siapa}\n`);
                align(0);
            }
            hr();

            txData.items.forEach(i => {
                text(`${i.nama}\n`);
                if (i.catatan) text(`  "${i.catatan}"\n`);
                line(`${i.qty} x ${formatRp(i.harga)}`, formatRp(i.harga * i.qty));
            });
            hr();
            const sub = txData.items.reduce((s, i) => s + (i.harga * i.qty), 0);
            line('Subtotal', formatRp(sub));
            const diskon = txData.diskon || 0;
            if (diskon > 0) line('Diskon', `-${formatRp(diskon)}`);
            const pajakNominal = txData.pajak || 0;
            if (pajakNominal > 0) line('Pajak', formatRp(pajakNominal));
            bold(true);
            line('TOTAL', formatRp(txData.total));
            bold(false);
            hr();
            if (txData.pembayaran.length === 0) {
                text('BELUM ADA PEMBAYARAN DITERIMA\n');
            } else {
                txData.pembayaran.forEach(p => line(METODE_LABEL[p.metode] || p.metode, formatRp(p.jumlah)));
            }
            if (txData.kembalian > 0) line('Kembali', formatRp(txData.kembalian));
            if (txData.is_preorder && (txData.sisa_bayar || 0) > 0) {
                bold(true);
                line(txData.status_bayar === 'dp' ? 'SISA (saat ambil)' : 'BELUM DIBAYAR (saat ambil)', formatRp(txData.sisa_bayar));
                bold(false);
            }
            hr();
            align(1);
            if (strukSettings.struk_footer_ikon === 'qr' && strukSettings.struk_qr_data) {
                chunks.push(escposQrCode(strukSettings.struk_qr_data));
                text('\n');
            } else if (strukSettings.struk_footer_ikon === 'judul') {
                bold(true);
                text(`${currentToko?.nama || 'muidsoft'}\n`);
                bold(false);
            }
            text(`${strukSettings.struk_footer || 'Terima Kasih'}\n`);
            if (strukSettings.struk_catatan) text(`${strukSettings.struk_catatan}\n`);
            feed(4);
            cut();

            const total = chunks.reduce((s, c) => s + c.length, 0);
            const out = new Uint8Array(total);
            let offset = 0;
            for (const c of chunks) { out.set(c, offset); offset += c.length; }
            return out;
        }

        async function printReceiptViaBluetooth() {
            if (!lastReceiptData) {
                showToast('Tidak ada struk untuk dicetak', 'error');
                return;
            }
            if (!btCharacteristic) {
                const ok = await connectBluetoothPrinter();
                if (!ok || !btCharacteristic) return;
            }
            try {
                const bytes = buildEscPosReceipt(lastReceiptData);
                // Kirim bertahap (chunk kecil):
                // 1) MTU default BLE cuma 23 byte (20 byte usable) kalau tidak ada
                //    negosiasi MTU yang lebih besar — banyak printer BLE murah
                //    (chip generik/lama) tidak menegosiasikan MTU lebih besar,
                //    jadi chunk 20 byte adalah ukuran paling aman secara universal
                //    (bukan 100 byte, yang cuma aman kalau MTU sempat dinegosiasi
                //    naik — tidak terjamin di semua device/printer).
                // 2) Delay kecil antar chunk: writeValueWithoutResponse() resolve
                //    begitu OS selesai MENGANTRE data, BUKAN begitu printer selesai
                //    MEMPROSESnya — kalau dikirim beruntun tanpa jeda, buffer
                //    internal printer yang kecil bisa overflow & bikin hasil cetak
                //    terpotong/rusak (masalah umum di printer thermal BLE murah).
                const CHUNK = 20;
                const DELAY_MS = 20;
                const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
                for (let i = 0; i < bytes.length; i += CHUNK) {
                    const part = bytes.slice(i, i + CHUNK);
                    if (btCharacteristic.properties.writeWithoutResponse) {
                        await btCharacteristic.writeValueWithoutResponse(part);
                        await sleep(DELAY_MS);
                    } else {
                        await btCharacteristic.writeValue(part);
                    }
                }
                showToast('Struk terkirim ke printer', 'success');
            } catch (err) {
                showToast('Gagal mencetak ke printer: ' + err.message, 'error');
            }
        }

        // ==========================================
        // 5b. SPLIT PAYMENT MODAL
        // ==========================================
        function openSplitModal() {
            splitRows = [{ id: ++splitRowSeq, metode: 'cash', jumlah: '' }];
            document.getElementById('split-tagihan').innerText = formatRp(currentTotalPay);
            renderSplitRows();
            const m = document.getElementById('modal-split');
            m.classList.remove('hidden'); m.classList.add('flex');
            toggleCartDrawer(); // Tutup keranjang di belakang layar
        }

        function closeSplitModal() {
            const m = document.getElementById('modal-split');
            m.classList.add('hidden'); m.classList.remove('flex');
        }

        function addSplitRow() {
            const used = splitRows.map(r => r.metode);
            const next = ['cash', 'qris', 'debit', 'transfer'].find(m => !used.includes(m)) || 'cash';
            splitRows.push({ id: ++splitRowSeq, metode: next, jumlah: '' });
            renderSplitRows();
        }

        function removeSplitRow(id) {
            if (splitRows.length <= 1) return; // minimal 1 baris
            splitRows = splitRows.filter(r => r.id !== id);
            renderSplitRows();
        }

        function updateSplitRowMetode(id, metode) {
            const row = splitRows.find(r => r.id === id);
            if (row) row.metode = metode;
            renderSplitSummary();
        }

        function updateSplitRowJumlah(id, value) {
            const row = splitRows.find(r => r.id === id);
            if (row) row.jumlah = value.replace(/[^0-9]/g, '');
            const input = document.getElementById(`split-jumlah-${id}`);
            if (input && input.value !== row.jumlah) input.value = row.jumlah;
            renderSplitSummary();
        }

        function renderSplitRows() {
            const wrap = document.getElementById('split-rows');
            wrap.innerHTML = splitRows.map((row, idx) => `
                <div class="border border-slate-200 rounded-xl p-3 bg-slate-50/60">
                    <div class="flex items-center justify-between mb-2">
                        <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Metode ${idx + 1}</span>
                        <button onclick="removeSplitRow(${row.id})" ${splitRows.length <= 1 ? 'disabled' : ''}
                                class="w-7 h-7 rounded-lg bg-red-50 text-red-500 flex items-center justify-center active:bg-red-100 transition shrink-0 disabled:opacity-30">
                            <i class="fas fa-trash-alt text-[11px]"></i>
                        </button>
                    </div>
                    <div class="flex gap-2">
                        <select onchange="updateSplitRowMetode(${row.id}, this.value)" class="min-w-0 flex-1 border border-slate-200 rounded-xl px-2 py-3 text-xs font-bold text-slate-700 bg-white">
                            ${Object.entries(METODE_LABEL).map(([val, label]) => `<option value="${val}" ${row.metode === val ? 'selected' : ''}>${label}</option>`).join('')}
                        </select>
                        <input id="split-jumlah-${row.id}" type="text" inputmode="numeric" placeholder="Rp 0" value="${row.jumlah}"
                               oninput="updateSplitRowJumlah(${row.id}, this.value)"
                               class="min-w-0 flex-1 border border-slate-200 rounded-xl px-3 py-3 text-sm font-bold text-slate-800 text-right font-mono">
                    </div>
                </div>
            `).join('');
            renderSplitSummary();
        }

        function renderSplitSummary() {
            const cashTotal = splitRows.filter(r => r.metode === 'cash').reduce((s, r) => s + (parseInt(r.jumlah) || 0), 0);
            const nonCashTotal = splitRows.filter(r => r.metode !== 'cash').reduce((s, r) => s + (parseInt(r.jumlah) || 0), 0);
            const totalDibayar = cashTotal + nonCashTotal;
            document.getElementById('split-total-dibayar').innerText = formatRp(totalDibayar);

            const labelEl = document.getElementById('split-sisa-label');
            const sisaEl = document.getElementById('split-sisa');
            const btn = document.getElementById('btn-confirm-split');
            const adaJumlahKosong = splitRows.some(r => !r.jumlah || parseInt(r.jumlah) <= 0);

            if (nonCashTotal > currentTotalPay) {
                // Non-tunai tidak boleh melebihi tagihan — kembalian cuma sah untuk tunai
                labelEl.innerText = 'Non-tunai berlebih';
                sisaEl.innerText = 'Kurangi nominal';
                sisaEl.className = 'text-red-500';
                btn.disabled = true;
                return;
            }

            const kembalian = cashTotal - (currentTotalPay - nonCashTotal);
            if (kembalian < 0) {
                labelEl.innerText = 'Kurang Bayar';
                sisaEl.innerText = formatRp(Math.abs(kembalian));
                sisaEl.className = 'text-red-500';
                btn.disabled = true;
            } else {
                labelEl.innerText = kembalian > 0 ? 'Kembalian (tunai)' : 'Lunas';
                sisaEl.innerText = formatRp(kembalian);
                sisaEl.className = 'text-green-600';
                btn.disabled = adaJumlahKosong;
            }
        }

        async function confirmSplitPayment() {
            const entries = splitRows
                .filter(r => parseInt(r.jumlah) > 0)
                .map(r => ({ metode: r.metode, jumlah: parseInt(r.jumlah) }));
            if (entries.length === 0) return;

            closeSplitModal();
            if (isDrawerOpen) toggleCartDrawer();
            await finalizeTransaction(entries);
        }

        // ==========================================
        // MODAL PEMBAYARAN SEBAGIAN (DP preorder & pelunasan sisa bayar)
        // Reuse 1 modal untuk 2 konteks lewat partialPayCtx.mode:
        //   'dp'        -> dipanggil dari triggerPayment() saat bikin preorder,
        //                  hasil konfirmasi lanjut ke finalizeTransaction()
        //   'pelunasan' -> dipanggil dari list preorder, hasil konfirmasi
        //                  langsung POST ke /api/preorder/:id/pelunasan
        // ==========================================
        let partialPayRows = [];
        let partialPayRowSeq = 0;
        let partialPayCtx = { mode: 'dp', batasAtas: 0, preorderId: null };

        function openPartialPayModal(mode, batasAtas, preorderId = null) {
            partialPayCtx = { mode, batasAtas, preorderId };
            partialPayRows = [{ id: ++partialPayRowSeq, metode: 'cash', jumlah: '' }];
            document.getElementById('partial-pay-title').innerText = mode === 'dp' ? 'Terima DP' : 'Terima Pelunasan';
            document.getElementById('partial-pay-subtitle').innerHTML =
                (mode === 'dp' ? 'Maks DP (dari total tagihan): ' : 'Sisa tagihan: ') +
                `<span id="partial-pay-batas" class="font-bold text-blue-600">${formatRp(batasAtas)}</span>`;
            renderPartialPayRows();
            const m = document.getElementById('modal-partial-pay');
            m.classList.remove('hidden'); m.classList.add('flex');
        }

        function closePartialPayModal() {
            const m = document.getElementById('modal-partial-pay');
            m.classList.add('hidden'); m.classList.remove('flex');
        }

        function addPartialPayRow() {
            const used = partialPayRows.map(r => r.metode);
            const next = ['cash', 'qris', 'debit', 'transfer'].find(m => !used.includes(m)) || 'cash';
            partialPayRows.push({ id: ++partialPayRowSeq, metode: next, jumlah: '' });
            renderPartialPayRows();
        }

        function removePartialPayRow(id) {
            if (partialPayRows.length <= 1) return;
            partialPayRows = partialPayRows.filter(r => r.id !== id);
            renderPartialPayRows();
        }

        function updatePartialPayRowMetode(id, metode) {
            const row = partialPayRows.find(r => r.id === id);
            if (row) row.metode = metode;
            renderPartialPaySummary();
        }

        function updatePartialPayRowJumlah(id, value) {
            const row = partialPayRows.find(r => r.id === id);
            if (row) row.jumlah = value.replace(/[^0-9]/g, '');
            const input = document.getElementById(`partial-pay-jumlah-${id}`);
            if (input && input.value !== row.jumlah) input.value = row.jumlah;
            renderPartialPaySummary();
        }

        function renderPartialPayRows() {
            const wrap = document.getElementById('partial-pay-rows');
            wrap.innerHTML = partialPayRows.map((row, idx) => `
                <div class="border border-slate-200 rounded-xl p-3 bg-slate-50/60">
                    <div class="flex items-center justify-between mb-2">
                        <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Metode ${idx + 1}</span>
                        <button onclick="removePartialPayRow(${row.id})" ${partialPayRows.length <= 1 ? 'disabled' : ''}
                                class="w-7 h-7 rounded-lg bg-red-50 text-red-500 flex items-center justify-center active:bg-red-100 transition shrink-0 disabled:opacity-30">
                            <i class="fas fa-trash-alt text-[11px]"></i>
                        </button>
                    </div>
                    <div class="flex gap-2">
                        <select onchange="updatePartialPayRowMetode(${row.id}, this.value)" class="min-w-0 flex-1 border border-slate-200 rounded-xl px-2 py-3 text-xs font-bold text-slate-700 bg-white">
                            ${Object.entries(METODE_LABEL).map(([val, label]) => `<option value="${val}" ${row.metode === val ? 'selected' : ''}>${label}</option>`).join('')}
                        </select>
                        <input id="partial-pay-jumlah-${row.id}" type="text" inputmode="numeric" placeholder="Rp 0" value="${row.jumlah}"
                               oninput="updatePartialPayRowJumlah(${row.id}, this.value)"
                               class="min-w-0 flex-1 border border-slate-200 rounded-xl px-3 py-3 text-sm font-bold text-slate-800 text-right font-mono">
                    </div>
                </div>
            `).join('');
            renderPartialPaySummary();
        }

        function renderPartialPaySummary() {
            const total = partialPayRows.reduce((s, r) => s + (parseInt(r.jumlah) || 0), 0);
            document.getElementById('partial-pay-total').innerText = formatRp(total);
            const labelEl = document.getElementById('partial-pay-sisa-label');
            const sisaEl = document.getElementById('partial-pay-sisa');
            const btn = document.getElementById('btn-confirm-partial-pay');
            const adaKosong = partialPayRows.some(r => !r.jumlah || parseInt(r.jumlah) <= 0);

            // Batas atas: total tagihan (mode DP) atau sisa tagihan (mode pelunasan).
            // Beda dari modal-split, di sini total BOLEH lebih kecil dari batas
            // (itu memang tujuannya) tapi tidak boleh melebihinya.
            if (total > partialPayCtx.batasAtas + 0.5) {
                labelEl.innerText = partialPayCtx.mode === 'dp' ? 'DP melebihi total tagihan' : 'Melebihi sisa tagihan';
                sisaEl.innerText = 'Kurangi nominal';
                sisaEl.className = 'text-red-500 font-bold';
                btn.disabled = true;
                return;
            }
            const sisaSetelah = Math.max(0, partialPayCtx.batasAtas - total);
            labelEl.innerText = partialPayCtx.mode === 'dp' ? 'Sisa setelah DP (dilunasi saat ambil)' : 'Sisa setelah pelunasan ini';
            sisaEl.innerText = formatRp(sisaSetelah);
            sisaEl.className = (sisaSetelah > 0 ? 'text-amber-600' : 'text-emerald-600') + ' font-bold';
            btn.disabled = adaKosong || total <= 0;
        }

        async function confirmPartialPay() {
            const entries = partialPayRows
                .filter(r => parseInt(r.jumlah) > 0)
                .map(r => ({ metode: r.metode, jumlah: parseInt(r.jumlah) }));
            if (entries.length === 0) return;

            if (partialPayCtx.mode === 'dp') {
                closePartialPayModal();
                if (isDrawerOpen) toggleCartDrawer();
                await finalizeTransaction(entries);
                return;
            }

            // Mode pelunasan — langsung kirim ke server, tidak lewat finalizeTransaction
            // karena ini bukan transaksi baru, cuma update transaksi preorder yang sudah ada.
            const btn = document.getElementById('btn-confirm-partial-pay');
            btn.disabled = true;
            try {
                const res = await fetch(`${API_BASE}/api/preorder/${partialPayCtx.preorderId}/pelunasan`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pembayaran: entries }),
                });
                const data = await res.json();
                if (!data.success) throw new Error(data.error || 'Gagal mencatat pelunasan');
                closePartialPayModal();
                showToast(data.status_bayar === 'lunas' ? 'Preorder lunas!' : `Tercatat. Sisa Rp ${formatRp(data.sisa_bayar).replace('Rp', '').trim()}`);
                loadPreorderKasir();
                refreshPreorderBadge();
            } catch (e) {
                showToast(e.message, 'error');
                btn.disabled = false;
            }
        }

        // ==========================================
        // 6. HOLD CART LOGIC
        // ==========================================
        function holdCart() {
            if (cart.length === 0) return;
            heldCarts.push({ id: `HOLD-${Date.now().toString().slice(-4)}`, time: new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}), items: [...cart], total: currentTotalPay });
            updateHoldBadge(); clearCart(true); showToast("Pesanan ditahan.");
        }
        function updateHoldBadge() {
            const b = document.getElementById('badge-hold');
            if (heldCarts.length > 0) { b.innerText = heldCarts.length; b.classList.remove('hidden'); }
            else b.classList.add('hidden');
        }
        function toggleHoldList() {
            const m = document.getElementById('modal-hold');
            const list = document.getElementById('hold-list');
            if (m.classList.contains('hidden')) {
                list.innerHTML = heldCarts.length ? '' : '<p class="text-center text-slate-400 py-6 text-sm font-bold">Kosong</p>';
                heldCarts.forEach((hc, i) => {
                    list.innerHTML += `
                        <div class="flex justify-between items-center p-3 border border-slate-200 rounded-2xl bg-slate-50 mb-2">
                            <div><p class="font-bold text-sm text-blue-600">${hc.id}</p><p class="text-[10px] font-bold text-slate-500">${hc.time} • ${formatRp(hc.total)}</p></div>
                            <button onclick="restoreHold(${i})" class="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold active:scale-95 shadow-md transition">Buka</button>
                        </div>
                    `;
                });
                m.classList.remove('hidden'); m.classList.add('flex');
            } else {
                m.classList.add('hidden'); m.classList.remove('flex');
            }
        }
        function restoreHold(idx) {
            if (cart.length > 0) { toggleHoldList(); alert("Kosongkan keranjang saat ini terlebih dahulu!"); return; }
            cart = [...heldCarts[idx].items]; 
            heldCarts.splice(idx, 1); updateHoldBadge(); toggleHoldList(); updateCartUI();
            toggleCartDrawer(); 
        }

        // ==========================================
        // 6b. PESANAN MENDATANG (PREORDER) — lihat & tandai selesai/batal.
        // Menampilkan preorder SATU TOKO (bukan cuma yang diinput kasir yang
        // sedang login), supaya kasir shift lain yang jaga pas pelanggan
        // datang ambil tetap bisa lihat & memprosesnya. Lihat juga fix di
        // GET/PUT /api/preorder di src/index.ts.
        // ==========================================
        function openPreorderModal() {
            const m = document.getElementById('modal-preorder');
            m.classList.remove('hidden'); m.classList.add('flex');
            loadPreorderKasir();
        }
        function closePreorderModal() {
            const m = document.getElementById('modal-preorder');
            m.classList.add('hidden'); m.classList.remove('flex');
        }

        async function loadPreorderKasir() {
            const wrap = document.getElementById('preorder-kasir-list');
            wrap.innerHTML = '<p class="text-center text-slate-400 py-6 text-sm font-bold">Memuat...</p>';
            try {
                const status = document.getElementById('preorder-filter-status').value;
                const res = await fetch(`${API_BASE}/api/preorder${status ? `?status=${status}` : ''}`, { credentials: 'include' });
                const data = await res.json();
                if (!data.success) throw new Error(data.error || 'Gagal memuat preorder');
                renderPreorderKasirList(data.data);
            } catch (e) {
                wrap.innerHTML = `<p class="text-center text-red-500 py-6 text-sm font-bold">${escapeHtml(e.message)}</p>`;
            }
        }

        function renderPreorderKasirList(list) {
            const wrap = document.getElementById('preorder-kasir-list');
            if (list.length === 0) {
                wrap.innerHTML = '<p class="text-center text-slate-400 py-6 text-sm font-bold">Tidak ada pesanan</p>';
                return;
            }
            const badgeClass = { menunggu: 'bg-amber-50 text-amber-700', selesai: 'bg-emerald-50 text-emerald-700', dibatalkan: 'bg-red-50 text-red-500' };
            const bayarBadgeClass = { lunas: 'bg-emerald-50 text-emerald-700', dp: 'bg-amber-50 text-amber-700', belum_bayar: 'bg-red-50 text-red-600' };
            const bayarLabel = { lunas: 'Lunas', dp: 'DP', belum_bayar: 'Belum Bayar' };
            const now = Date.now();
            wrap.innerHTML = list.map(p => {
                const statusBayar = p.status_bayar || 'lunas';
                const sisaBayar = p.sisa_bayar || 0;
                // Terlambat = waktu ambil sudah lewat tapi masih 'menunggu' —
                // risiko ganda kalau juga belum lunas (barang sudah dibuat,
                // pelanggan belum tentu datang/bayar).
                const terlambat = p.status_preorder === 'menunggu' && new Date(p.waktu_ambil).getTime() < now;
                return `
                <div class="border ${terlambat ? 'border-red-300 bg-red-50/60' : 'border-slate-200 bg-slate-50'} rounded-2xl p-3.5">
                    <div class="flex items-start justify-between gap-2 mb-1.5">
                        <div class="min-w-0">
                            <p class="font-extrabold text-sm text-slate-800">${new Date(p.waktu_ambil).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                            <p class="text-[11px] text-slate-500 font-medium truncate">${escapeHtml([p.nama_pemesan, p.hp_pemesan].filter(Boolean).join(' — ') || 'Tanpa nama pemesan')} &middot; ${escapeHtml(p.kode_transaksi)}</p>
                            ${terlambat ? `<p class="text-[10px] font-bold text-red-600 mt-0.5"><i class="fas fa-triangle-exclamation mr-1"></i>Sudah lewat waktu ambil${sisaBayar > 0 ? ' & belum lunas' : ''}</p>` : ''}
                        </div>
                        <div class="flex flex-col items-end gap-1 shrink-0">
                            <span class="px-2 py-1 rounded-lg text-[10px] font-bold ${badgeClass[p.status_preorder] || 'bg-slate-100 text-slate-500'}">${escapeHtml(p.status_preorder)}</span>
                            <span class="px-2 py-1 rounded-lg text-[10px] font-bold ${bayarBadgeClass[statusBayar] || 'bg-slate-100 text-slate-500'}">${bayarLabel[statusBayar] || statusBayar}</span>
                        </div>
                    </div>
                    <div class="text-[11px] text-slate-600 space-y-0.5 mb-2.5 pl-0.5">
                        ${(p.items || []).map(it => `<p>• ${it.qty}x ${escapeHtml(it.nama_produk)}${it.ukuran_nama ? ` (${escapeHtml(it.ukuran_nama)})` : ''}</p>`).join('')}
                    </div>
                    <div class="flex items-center justify-between gap-2">
                        <div class="shrink-0">
                            <span class="font-bold text-sm text-blue-600 block">${formatRp(p.total_bayar)}</span>
                            ${sisaBayar > 0 ? `<span class="text-[10px] font-bold text-red-500">Sisa ${formatRp(sisaBayar)}</span>` : ''}
                        </div>
                        ${p.status_preorder === 'menunggu' ? `
                            <div class="flex gap-1.5 flex-wrap justify-end">
                                ${sisaBayar > 0 ? `<button onclick="pelunasiPreorderKasir(${p.id}, ${sisaBayar})" class="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[11px] font-bold active:scale-95 transition">Lunasi</button>` : ''}
                                <button onclick="updatePreorderStatusKasir(${p.id}, 'selesai')" class="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-bold active:scale-95 transition">Selesai</button>
                                <button onclick="updatePreorderStatusKasir(${p.id}, 'dibatalkan')" class="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-[11px] font-bold active:scale-95 transition">Batal</button>
                            </div>` : ''}
                    </div>
                </div>`;
            }).join('');
        }

        async function updatePreorderStatusKasir(id, status) {
            try {
                const res = await fetch(`${API_BASE}/api/preorder/${id}/status`, {
                    method: 'PUT',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status }),
                });
                const data = await res.json();
                if (!data.success) throw new Error(data.error || 'Gagal mengubah status');
                showToast('Status preorder diperbarui');
                loadPreorderKasir();
                refreshPreorderBadge();
            } catch (e) { showToast(e.message, 'error'); }
        }

        // Terima pelunasan sisa bayar preorder saat pelanggan datang ambil
        // pesanan — buka modal pembayaran sebagian (mendukung split metode).
        function pelunasiPreorderKasir(id, sisaBayar) {
            openPartialPayModal('pelunasan', sisaBayar, id);
        }

        // Badge jumlah preorder "menunggu" di menu akun — supaya kasir langsung
        // sadar ada pesanan yang perlu disiapkan tanpa harus buka menunya dulu.
        async function refreshPreorderBadge() {
            try {
                const res = await fetch(`${API_BASE}/api/preorder?status=menunggu`, { credentials: 'include' });
                const data = await res.json();
                const badge = document.getElementById('badge-preorder-menu');
                if (!badge || !data.success) return;
                const jumlah = data.data.length;
                const adaTerlambat = data.data.some(p => new Date(p.waktu_ambil).getTime() < Date.now());
                if (jumlah > 0) {
                    badge.innerText = jumlah > 99 ? '99+' : String(jumlah);
                    badge.classList.remove('hidden');
                    // Berdenyut kalau ada preorder yang waktu ambilnya sudah lewat —
                    // sinyal visual biar kasir sadar ada yang perlu segera ditindak.
                    badge.classList.toggle('animate-pulse', adaTerlambat);
                    badge.classList.toggle('bg-red-500', adaTerlambat);
                    badge.classList.toggle('bg-amber-500', !adaTerlambat);
                } else {
                    badge.classList.add('hidden');
                }
            } catch {
                // Gagal ambil badge (mis. sedang offline) — biarkan diam,
                // bukan hal kritis yang perlu mengganggu kasir dengan error.
            }
        }

        // ==========================================
        // 6b. SCAN BARCODE VIA KAMERA HP
        // Prioritas: native BarcodeDetector API (Chrome/Android, tanpa library
        // tambahan). Kalau tidak didukung (mis. Safari/iOS, Firefox desktop),
        // fallback otomatis ke ZXing (dimuat lazy dari CDN hanya saat dipakai,
        // supaya tidak membebani load awal PWA).
        // ==========================================
        let scanStream = null;
        let scanRAF = null;
        let zxingReader = null;
        let zxingLoadPromise = null;

        function loadZXing() {
            if (window.ZXingBrowser) return Promise.resolve();
            if (zxingLoadPromise) return zxingLoadPromise;
            zxingLoadPromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                // Di-self-host lokal (lihat scripts/vendor-fetch.mjs), BUKAN dari
                // CDN unpkg.com — supaya scanner tetap jalan walau HP offline
                // total (banyak WebView Android/APK tidak punya BarcodeDetector
                // native, jadi fallback ZXing ini yang paling sering kepakai
                // sebenarnya, bukan cuma cadangan langka).
                script.src = '/js/vendor/zxing-browser.min.js';
                script.onload = resolve;
                script.onerror = () => reject(new Error('Gagal memuat pustaka scanner'));
                document.head.appendChild(script);
            });
            return zxingLoadPromise;
        }

        function onBarcodeDetected(rawValue) {
            const kode = String(rawValue).trim();
            const p = products.find((x) => x.barcode === kode);
            if (!p) {
                document.getElementById('scan-status').innerText = `Barcode "${kode}" tidak dikenali`;
                playFeedback('beep');
                return;
            }
            playFeedback('success');
            addToCart(p);
            closeScanModal();
            showToast(`${p.nama} ditambahkan`);
        }

        async function openScanModal() {
            const modal = document.getElementById('modal-scan');
            const video = document.getElementById('scan-video');
            const status = document.getElementById('scan-status');
            status.innerText = 'Arahkan kamera ke barcode produk';
            modal.classList.remove('hidden');
            modal.classList.add('flex');

            // Cek dulu SEBELUM minta kamera — supaya pesan errornya spesifik
            // (bukan cuma "cek izin kamera" generik untuk semua kemungkinan
            // penyebab, yang bikin kasir bingung harus benerin apa).
            if (!window.isSecureContext) {
                showToast('Kamera cuma bisa diakses lewat HTTPS. Buka via alamat https:// atau install sebagai app.', 'error');
                closeScanModal();
                return;
            }
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                showToast('Browser ini tidak mendukung akses kamera. Coba Chrome versi terbaru.', 'error');
                closeScanModal();
                return;
            }

            try {
                scanStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
                    audio: false,
                });
                video.srcObject = scanStream;
                await video.play();
            } catch (err) {
                // Pesan spesifik per jenis error, bukan satu pesan generik —
                // NotAllowedError (izin ditolak user/OS) beda solusinya dari
                // NotFoundError (HP tidak punya kamera) atau NotReadableError
                // (kamera lagi dipakai app lain).
                const pesan = {
                    NotAllowedError: 'Izin kamera ditolak. Buka Pengaturan HP → Aplikasi → izinkan akses Kamera untuk app ini, lalu coba lagi.',
                    PermissionDeniedError: 'Izin kamera ditolak. Buka Pengaturan HP → Aplikasi → izinkan akses Kamera untuk app ini, lalu coba lagi.',
                    NotFoundError: 'Tidak ditemukan kamera di perangkat ini.',
                    NotReadableError: 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi lain yang mungkin memakai kamera, lalu coba lagi.',
                    OverconstrainedError: 'Kamera perangkat ini tidak mendukung mode yang diminta.',
                }[err.name] || `Tidak bisa mengakses kamera (${err.name || err.message || 'error tidak diketahui'}).`;
                showToast(pesan, 'error');
                closeScanModal();
                return;
            }

            if ('BarcodeDetector' in window) {
                startNativeDetector(video, status);
            } else {
                try {
                    await loadZXing();
                    startZXingDetector(video, status);
                } catch (err) {
                    status.innerText = 'Scanner tidak didukung di perangkat ini — ketik manual saja';
                }
            }
        }

        function startNativeDetector(video, status) {
            const detector = new window.BarcodeDetector({
                formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'],
            });
            const loop = async () => {
                if (!scanStream) return; // modal sudah ditutup
                try {
                    const codes = await detector.detect(video);
                    if (codes.length > 0) {
                        onBarcodeDetected(codes[0].rawValue);
                        return; // stop loop, onBarcodeDetected akan menutup modal
                    }
                } catch { /* frame belum siap / video belum ada gambar, abaikan & coba lagi */ }
                scanRAF = requestAnimationFrame(loop);
            };
            scanRAF = requestAnimationFrame(loop);
        }

        function startZXingDetector(video, status) {
            // decodeFromVideoElement mencoba berulang kali secara internal sampai
            // barcode ditemukan (atau reader di-reset lewat closeScanModal), jadi
            // cukup satu panggilan — tidak perlu loop manual seperti native detector.
            const { BrowserMultiFormatReader } = window.ZXingBrowser;
            zxingReader = new BrowserMultiFormatReader();
            zxingReader
                .decodeFromVideoElement(video)
                .then((result) => { if (result) onBarcodeDetected(result.getText()); })
                .catch(() => { /* reader di-reset saat modal ditutup — bukan error, abaikan */ });
        }

        function closeScanModal() {
            const modal = document.getElementById('modal-scan');
            modal.classList.add('hidden');
            modal.classList.remove('flex');

            if (scanRAF) { cancelAnimationFrame(scanRAF); scanRAF = null; }
            if (zxingReader) { try { zxingReader.reset(); } catch {} zxingReader = null; }
            if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }

            const video = document.getElementById('scan-video');
            if (video) video.srcObject = null;
        }

        // ==========================================
        // 7. UTILS & EVENT LISTENERS
        // ==========================================

        /** Sinkronkan tampilan tombol ikon labu di header dengan state saat ini
         *  (idle/testing/offline-asli) — dipanggil tiap kali salah satu state berubah. */
        /** Sinkronkan tampilan ikon status koneksi di header — ini murni indikator, tidak bisa diklik/toggle. */
        function updateNetworkButtonUI() {
            const btn = document.getElementById('btn-network');
            if (isRealOffline) {
                btn.className = 'w-10 h-10 bg-red-500 rounded-full flex items-center justify-center text-white shadow-lg shadow-red-500/30';
                btn.innerHTML = '<i class="fas fa-wifi-slash"></i>';
                btn.title = 'Koneksi internet terputus';
            } else {
                btn.className = 'w-10 h-10 bg-white/10 rounded-full flex items-center justify-center text-white';
                btn.innerHTML = '<i class="fas fa-wifi"></i>';
                btn.title = 'Status koneksi: online';
            }
        }

        // Deteksi koneksi internet — browser sendiri yang memberi tahu lewat
        // event ini saat wifi/data mati-nyala. Saat offline, transaksi baru
        // otomatis disimpan lokal dulu (antrian IndexedDB) dan disinkron balik
        // ke server begitu koneksi kembali (lihat syncOfflineData()).
        window.addEventListener('offline', () => {
            isRealOffline = true;
            updateNetworkButtonUI();
            checkOfflineQueue();
            showToast('Koneksi internet terputus — transaksi akan disimpan lokal dulu', 'warning');
        });
        window.addEventListener('online', () => {
            isRealOffline = false;
            updateNetworkButtonUI();
            checkOfflineQueue();
        });

        document.getElementById('search-input').addEventListener('input', (e) => renderProducts(e.target.value));
        
        let barcodeBuf = ''; let barcodeTimer;
        window.addEventListener('keydown', (e) => {
            if (document.activeElement.tagName === 'INPUT') {
                if(e.key === 'Enter' && e.target.id === 'search-input' && e.target.value) {
                    const q = e.target.value.trim();
                    const p = products.find(x => x.barcode === q);
                    if(p) { addToCart(p); e.target.value=''; e.target.blur(); renderProducts();}
                }
                return;
            }
            if (e.key === 'Enter' && barcodeBuf.length > 3) {
                const p = products.find(x => x.barcode === barcodeBuf.trim());
                if(p) addToCart(p);
                barcodeBuf = ''; e.preventDefault();
            } else if (e.key.length === 1) {
                barcodeBuf += e.key;
                clearTimeout(barcodeTimer);
                barcodeTimer = setTimeout(() => barcodeBuf = '', 50);
            }
        });

        // INIT APP
        window.onload = async () => {
            loadAppTitle(); // tidak perlu ditunggu (await) — non-blocking, boleh gagal diam-diam
            updateNetworkButtonUI(); // set ikon status koneksi sesuai keadaan saat halaman dibuka
            updateBatalTerakhirButton(); // tombol batal disembunyikan default (belum ada transaksi di sesi ini)
            const authOk = await checkAuth(); // redirect ke login.html jika sesi tidak valid
            if (!authOk) return;

            await loadTokoInfo();    // Nama & alamat toko untuk kop struk
            await initDB();          // Init database lokal (IndexedDB, antrian offline)
            await loadProducts();    // Ambil produk asli dari /api/produk
            await checkShiftStatus(); // Tampilkan modal wajib buka shift (khusus role kasir) jika belum ada shift aktif
            refreshPreorderBadge();  // Non-blocking — badge jumlah preorder "menunggu" di menu akun
        };
