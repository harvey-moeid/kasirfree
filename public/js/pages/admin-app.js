// admin-app.js — Logika halaman Admin (dashboard, produk, laporan, dst).
// Dipindah dari inline <script> di admin.html supaya HTML murni markup.

// ==========================================================
// KONFIGURASI
// ==========================================================
const API_BASE = ''; // isi URL Worker jika Pages & Worker beda domain

let currentUser = null;
let produkList = [];
let userList = [];
let tokoList = [];
let kategoriList = [];

const formatRp = (n) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n || 0);
const METODE_LABEL = { cash: 'Cash', transfer: 'Transfer', qris: 'QRIS', debit: 'Debit' };

// Animasi hitung naik untuk angka KPI dashboard — angka "berlari" dari 0 ke
// nilai sebenarnya tiap kali data dimuat/di-refresh, bukan cuma nongol
// statis. formatFn dipanggil ulang tiap frame supaya format Rupiah/pemisah
// ribuan tetap benar di angka antara (bukan cuma di angka akhir).
function animateCountUp(el, endValue, formatFn, duration = 800) {
    if (!el) return;
    const target = Number(endValue) || 0;
    const startTime = performance.now();
    function tick(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic — cepat di awal, mendarat halus
        el.innerText = formatFn(Math.round(target * eased));
        if (progress < 1) requestAnimationFrame(tick);
        else el.innerText = formatFn(target);
    }
    requestAnimationFrame(tick);
}

let _toastTimer = null;
function showToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    const icon = document.getElementById('toast-icon');
    document.getElementById('toast-msg').innerText = msg;
    // FIX: tambahkan gaya 'warning' (amber) — sebelumnya cuma error/sukses,
    // jadi pesan peringatan (mis. export terpotong) tampil seolah error/gagal
    // padahal aksinya sendiri berhasil.
    const styles = {
        error: { bg: 'bg-red-500', icon: 'fa-xmark' },
        warning: { bg: 'bg-amber-500', icon: 'fa-triangle-exclamation' },
    };
    const s = styles[type] || { bg: 'bg-emerald-500', icon: 'fa-check' };
    icon.className = `fas ${s.icon} text-white text-xs`;
    icon.parentElement.className = `w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${s.bg}`;

    // FIX: sebelumnya setTimeout tidak disimpan/di-clear — kalau ada toast baru
    // muncul sebelum toast sebelumnya selesai, timer LAMA tetap jalan dan
    // menyembunyikan toast BARU sebelum waktunya (berkedip/hilang lebih cepat).
    if (_toastTimer) clearTimeout(_toastTimer);
    t.classList.remove('-translate-y-32'); t.classList.add('translate-y-0');
    _toastTimer = setTimeout(() => { t.classList.remove('translate-y-0'); t.classList.add('-translate-y-32'); }, 2800);
}

function closeModal(id) {
    const m = document.getElementById(id);
    m.classList.add('hidden'); m.classList.remove('flex');
}
function openModal(id) {
    const m = document.getElementById(id);
    m.classList.remove('hidden'); m.classList.add('flex');
}

// ==========================================================
// KONFIRMASI KUSTOM (pengganti native confirm() browser)
// ==========================================================
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

    openModal('modal-confirm');
    return new Promise((resolve) => { _confirmResolver = resolve; });
}

function resolveConfirm(result) {
    closeModal('modal-confirm');
    if (_confirmResolver) { _confirmResolver(result); _confirmResolver = null; }
}

// Escape nilai apa pun yang berasal dari data (nama produk, kategori, toko,
// username, keterangan log, dst) SEBELUM disisipkan ke innerHTML lewat
// template string. Tanpa ini, nama produk seperti "Teh Po'o" atau yang
// sengaja diisi tag HTML akan dieksekusi sebagai markup/JS sungguhan —
// stored XSS. Selalu pakai ini untuk setiap nilai teks bebas dari server.
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// PENTING — kenapa fungsi ini perlu ada (bukan cuma pakai gambar_url
// langsung sebagai <img src>): gambar_url berbentuk "/api/gambar/...".
// Path ini HANYA bisa "diselesaikan" lewat window.fetch() yang di-patch
// fetch-shim.js (diarahkan ke router lokal/IndexedDB, bukan server
// sungguhan — lihat local-app.js). Tapi <img src="..."> TIDAK memanggil
// window.fetch() — itu request resource level-browser asli. Service
// worker (sw.js) SENGAJA membiarkan semua /api/* lewat apa adanya ke
// network asli (baris "if (url.pathname.startsWith('/api/')) return;"),
// karena desain itu ditulis untuk versi CLOUD lama yang /api/ memang
// server sungguhan. Di mode lokal sekarang, tidak ada server sungguhan —
// jadi <img src="/api/gambar/...">  selalu gagal (404) di mana pun app
// ini dibuka (Cloudflare Pages statis, atau dibungkus APK), walau upload-
// nya sendiri sukses. Solusi: ambil gambarnya lewat fetch() yang SUDAH
// benar (lewat fetch-shim), lalu ubah jadi blob URL lokal buat <img src>.
const _gambarBlobCache = new Map(); // apiPath -> blob: URL, biar tidak fetch ulang tiap render
async function resolveGambarSrc(url) {
    if (!url) return url;
    if (!url.startsWith('/api/gambar/')) return url; // data:, http(s) eksternal, dll — biarkan apa adanya
    if (_gambarBlobCache.has(url)) return _gambarBlobCache.get(url);
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        _gambarBlobCache.set(url, blobUrl);
        return blobUrl;
    } catch {
        return null;
    }
}

async function api(path, opts = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
        credentials: 'include',
        headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
        ...opts,
    });
    let data;
    try { data = await res.json(); } catch { data = { success: false, error: 'Respons server tidak valid' }; }
    if (!res.ok || !data.success) throw new Error(data.error || `Gagal (${res.status})`);
    return data;
}

// ==========================================================
// AUTH
// ==========================================================
async function checkAuth() {
    try {
        const data = await api('/api/auth/me');
        currentUser = data.user;
        if (currentUser.role === 'kasir') {
            // Kasir tidak berhak akses panel admin
            window.location.href = 'index.html';
            return false;
        }
        document.getElementById('admin-nama').innerText = currentUser.nama_lengkap;
        document.getElementById('admin-role').innerText = currentUser.role === 'super_admin' ? 'Super Admin' : 'Admin Toko';
        if (currentUser.role === 'super_admin') {
            document.getElementById('tab-btn-toko').classList.remove('hidden');
            document.getElementById('card-kelola-data').classList.remove('hidden');
        }
        return true;
    } catch {
        window.location.href = 'login.html';
        return false;
    }
}

async function doLogout() {
    const ok = await showConfirm('Anda akan keluar dari panel admin.', {
        title: 'Keluar dari Panel Admin?',
        okText: 'Ya, Keluar',
        icon: 'fa-sign-out-alt',
        tone: 'danger',
    });
    if (!ok) return;
    try { await api('/api/auth/logout', { method: 'POST' }); } finally { window.location.href = 'login.html'; }
}

function openChangePasswordModal() {
    document.getElementById('form-password').reset();
    openModal('modal-password');
}

async function submitChangePassword(e) {
    e.preventDefault();
    const password_lama = document.getElementById('password-lama').value;
    const password_baru = document.getElementById('password-baru').value;
    const konfirmasi = document.getElementById('password-konfirmasi').value;

    if (password_baru !== konfirmasi) {
        showToast('Konfirmasi password baru tidak cocok', 'error');
        return;
    }

    try {
        await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ password_lama, password_baru }) });
        closeModal('modal-password');
        showToast('Password berhasil diubah');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ==========================================================
// TAB SWITCHING
// ==========================================================
function switchTab(tab) {
    ['dashboard', 'produk', 'bahan', 'riwayat', 'preorder', 'kasir', 'toko', 'log'].forEach(t => {
        document.getElementById(`tab-${t}`).classList.toggle('hidden', t !== tab);
    });
    document.querySelectorAll('.tab-btn').forEach(b => {
        const active = b.dataset.tab === tab;
        b.classList.toggle('active', active);
        b.classList.toggle('bg-white/10', !active);
    });
    if (tab === 'produk' && produkList.length === 0) loadProduk();
    if (tab === 'bahan') loadBahanBakuTable();
    if (tab === 'riwayat') { if (userList.length === 0) loadUsers(); loadRiwayatTransaksi(); }
    if (tab === 'preorder') loadPreorderTable();
    if (tab === 'kasir' && userList.length === 0) loadUsers();
    if (tab === 'log') loadLogAktivitas();
}

// ==========================================================
// TOKO (super_admin) — daftar & tambah cabang/toko
// ==========================================================
async function loadTokoTable() {
    try {
        const data = await api('/api/toko');
        tokoList = data.data;
        const tbody = document.getElementById('tbl-toko');
        if (tokoList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-slate-400 py-8">Belum ada toko terdaftar</td></tr>';
            return;
        }
        tbody.innerHTML = tokoList.map(t => `
            <tr class="border-t border-slate-50 hover:bg-slate-50/50">
                <td data-label="Nama Toko" class="px-4 py-3 font-bold text-slate-700">${escapeHtml(t.nama)}</td>
                <td data-label="Alamat" class="px-4 py-3 text-slate-500">${escapeHtml(t.alamat) || '-'}</td>
                <td data-label="Terdaftar" class="px-4 py-3 text-slate-400">${new Date((t.created_at || '').replace(' ', 'T') + 'Z').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                <td data-label="Aksi" class="px-4 py-3 text-right">
                    <button onclick="openTokoModal(${t.id})" class="text-blue-600 hover:text-blue-800 font-bold text-xs"><i class="fas fa-pen mr-1"></i>Edit</button>
                </td>
            </tr>`).join('');
    } catch (e) { showToast(e.message, 'error'); }
}

function openTokoModal(id = null) {
    document.getElementById('form-toko').reset();
    if (id) {
        const toko = tokoList.find(t => t.id === id);
        document.getElementById('modal-toko-title').innerText = 'Edit Toko';
        document.getElementById('btn-submit-toko').innerText = 'Simpan Perubahan';
        document.getElementById('toko-id').value = toko.id;
        document.getElementById('toko-nama').value = toko.nama;
        document.getElementById('toko-alamat').value = toko.alamat || '';
    } else {
        document.getElementById('modal-toko-title').innerText = 'Tambah Toko';
        document.getElementById('btn-submit-toko').innerText = 'Simpan Toko';
        document.getElementById('toko-id').value = '';
    }
    openModal('modal-toko');
}

async function submitToko(e) {
    e.preventDefault();
    const id = document.getElementById('toko-id').value;
    const payload = {
        nama: document.getElementById('toko-nama').value.trim(),
        alamat: document.getElementById('toko-alamat').value.trim() || null,
    };
    try {
        if (id) {
            await api(`/api/toko/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
            showToast('Toko berhasil diubah');
        } else {
            await api('/api/toko', { method: 'POST', body: JSON.stringify(payload) });
            showToast('Toko berhasil ditambahkan');
        }
        closeModal('modal-toko');
        tokoList = []; // paksa refresh cache dropdown toko di form produk/user
        await loadTokoTable();
    } catch (e) { showToast(e.message, 'error'); }
}

// ==========================================================
// PENGATURAN APLIKASI (judul aplikasi)
// ==========================================================
async function loadAppTitle() {
    try {
        const res = await fetch(`${API_BASE}/api/settings`, { credentials: 'include' });
        const data = await res.json();
        const s = data.success ? data.data : {};
        const title = s.app_title || 'muidsoft';
        document.title = `Admin - ${title}`;
        const headerEl = document.getElementById('app-title-header');
        if (headerEl) headerEl.innerText = title;
        const inputEl = document.getElementById('app-title-input');
        if (inputEl) inputEl.value = title;

        const lebarEl = document.getElementById('struk-lebar-input');
        const alamatEl = document.getElementById('struk-alamat-input');
        const antrianEl = document.getElementById('struk-antrian-input');
        const footerEl = document.getElementById('struk-footer-input');
        const catatanEl = document.getElementById('struk-catatan-input');
        const ikonEl = document.getElementById('struk-ikon-input');
        const qrEl = document.getElementById('struk-qr-input');
        if (lebarEl) lebarEl.value = s.struk_lebar_kertas || '58';
        if (alamatEl) alamatEl.checked = (s.struk_tampilkan_alamat ?? '1') === '1';
        if (antrianEl) antrianEl.checked = (s.struk_tampilkan_antrian ?? '1') === '1';
        if (footerEl) footerEl.value = s.struk_footer ?? 'Terima kasih atas kunjungan Anda';
        if (catatanEl) catatanEl.value = s.struk_catatan ?? '';
        if (ikonEl) ikonEl.value = s.struk_footer_ikon || 'tidak';
        if (qrEl) qrEl.value = s.struk_qr_data ?? '';
        toggleStrukQrField();
    } catch {
        // Gagal ambil pengaturan — biarkan judul default di HTML.
    }
}

/** Tampilkan input data QR hanya kalau ikon footer yang dipilih adalah "QR Code asli". */
function toggleStrukQrField() {
    const ikonEl = document.getElementById('struk-ikon-input');
    const qrField = document.getElementById('struk-qr-field');
    if (ikonEl && qrField) qrField.style.display = ikonEl.value === 'qr' ? '' : 'none';
}

/** Kumpulkan semua field pengaturan saat ini (dipakai supaya PUT tidak menimpa field lain dengan default). */
function strukPayload(overrides) {
    return {
        app_title: document.getElementById('app-title-input').value.trim(),
        struk_lebar_kertas: document.getElementById('struk-lebar-input').value,
        struk_tampilkan_alamat: document.getElementById('struk-alamat-input').checked ? '1' : '0',
        struk_tampilkan_antrian: document.getElementById('struk-antrian-input').checked ? '1' : '0',
        struk_footer: document.getElementById('struk-footer-input').value.trim(),
        struk_catatan: document.getElementById('struk-catatan-input').value.trim(),
        struk_footer_ikon: document.getElementById('struk-ikon-input').value,
        struk_qr_data: document.getElementById('struk-qr-input').value.trim(),
        ...overrides,
    };
}

async function submitAppTitle(e) {
    e.preventDefault();
    const app_title = document.getElementById('app-title-input').value.trim();
    try {
        await api('/api/settings', { method: 'PUT', body: JSON.stringify(strukPayload({ app_title })) });
        showToast('Judul aplikasi berhasil diubah');
        await loadAppTitle();
    } catch (e) { showToast(e.message, 'error'); }
}

async function submitStrukSettings(e) {
    e.preventDefault();
    try {
        await api('/api/settings', { method: 'PUT', body: JSON.stringify(strukPayload({})) });
        showToast('Kustomisasi struk berhasil disimpan');
        await loadAppTitle();
    } catch (e) { showToast(e.message, 'error'); }
}

async function unduhBackup() {
    const btn = document.getElementById('btn-backup');
    const teksAsli = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1.5"></i>Menyiapkan...';
    try {
        const hasil = await window.LocalBackup.exportBackup();
        if (hasil?.method === 'cancelled') {
            // User batal di menu share — tidak perlu toast apa pun.
        } else if (hasil?.method === 'share') {
            showToast('Pilih tempat menyimpan file cadangannya.');
        } else {
            showToast('Cadangan berhasil diunduh');
        }
    } catch (e) {
        showToast('Gagal membuat cadangan: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = teksAsli;
    }
}

async function pulihkanBackup(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset supaya bisa pilih file yang sama lagi kalau perlu
    if (!file) return;

    const yakin = confirm('Memulihkan cadangan akan MENIMPA seluruh data yang ada di HP ini sekarang (produk, transaksi, gambar, dll). Lanjutkan?');
    if (!yakin) return;

    try {
        await window.LocalBackup.importBackup(file);
        showToast('Cadangan berhasil dipulihkan. Memuat ulang halaman...');
        setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
        showToast('Gagal memulihkan cadangan: ' + err.message, 'error');
    }
}

// ==========================================================
// DASHBOARD
// ==========================================================
async function loadDashboard() {
    await Promise.all([loadLaporanHarian(), loadMargin(), loadProdukTerlaris(), loadTrenPenjualan(), loadJamRamai(), loadKinerjaKasir()]);
}

async function loadLaporanHarian() {
    try {
        const data = await api('/api/laporan/harian');
        animateCountUp(document.getElementById('kpi-total'), data.data.total_penjualan, formatRp);
        animateCountUp(document.getElementById('kpi-jumlah'), data.data.jumlah_transaksi, (n) => String(n));
    } catch (e) { showToast(e.message, 'error'); }
}

function tanggalFilterQuery() {
    const dari = document.getElementById('rep-dari').value;
    const sampai = document.getElementById('rep-sampai').value;
    const q = new URLSearchParams();
    if (dari) q.set('dari', dari);
    if (sampai) q.set('sampai', sampai);
    return q;
}

async function loadMargin() {
    try {
        const data = await api(`/api/laporan/margin?${tanggalFilterQuery()}`);
        animateCountUp(document.getElementById('kpi-margin'), data.data.margin_kotor, formatRp);
        document.getElementById('kpi-margin-persen').innerText = `${data.data.margin_persen}% dari omzet (HPP: ${formatRp(data.data.total_hpp)})`;

        const warnEl = document.getElementById('kpi-margin-warning');
        const warnTextEl = document.getElementById('kpi-margin-warning-text');
        const daftar = data.data.produk_tanpa_resep || [];
        if (daftar.length > 0) {
            warnEl.classList.remove('hidden');
            warnTextEl.innerText = `Margin di atas kemungkinan lebih tinggi dari kenyataan — resep belum diisi untuk: ${daftar.join(', ')}`;
        } else {
            warnEl.classList.add('hidden');
        }
    } catch (e) { showToast(e.message, 'error'); }
}

async function loadProdukTerlaris() {
    try {
        const q = tanggalFilterQuery();
        q.set('limit', '10');
        const data = await api(`/api/laporan/kombinasi-terlaris?${q}`);
        const tbody = document.getElementById('tbl-terlaris');
        if (data.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-slate-400 py-6 font-bold">Belum ada data</td></tr>';
            return;
        }
        tbody.innerHTML = data.data.map(p => `
            <tr class="border-t border-slate-50">
                <td class="px-4 py-2.5 font-bold text-slate-700">${escapeHtml(p.nama_produk)}</td>
                <td class="px-4 py-2.5 text-right font-mono">${p.total_qty}</td>
                <td class="px-4 py-2.5 text-right font-mono text-blue-600 font-bold">${formatRp(p.total_omzet)}</td>
            </tr>`).join('');
    } catch (e) { showToast(e.message, 'error'); }
}

async function loadKinerjaKasir() {
    try {
        const data = await api(`/api/laporan/per-kasir?${tanggalFilterQuery()}`);
        const tbody = document.getElementById('tbl-kinerja-kasir');
        if (data.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-slate-400 py-6 font-bold">Belum ada data</td></tr>';
            return;
        }
        tbody.innerHTML = data.data.map(k => {
            const selisih = k.total_selisih_kas;
            // Selisih 0 dianggap netral (abu-abu), kurang (minus) merah, lebih (plus) hijau —
            // supaya owner bisa langsung lihat kasir mana yang sering "bolong" kasnya.
            const selisihClass = selisih < 0 ? 'text-red-600' : (selisih > 0 ? 'text-emerald-600' : 'text-slate-400');
            const selisihText = k.jumlah_shift > 0 ? `${selisih > 0 ? '+' : ''}${formatRp(selisih)}` : '-';
            return `
            <tr class="border-t border-slate-50">
                <td class="px-4 py-2.5">
                    <p class="font-bold text-slate-700">${escapeHtml(k.nama_lengkap)}${k.is_active ? '' : ' <span class=\'text-[9px] text-slate-400 font-medium\'>(nonaktif)</span>'}</p>
                    <p class="text-[10px] text-slate-400">@${escapeHtml(k.username)}</p>
                </td>
                <td class="px-4 py-2.5 text-right font-mono">${k.jumlah_transaksi}</td>
                <td class="px-4 py-2.5 text-right font-mono text-blue-600 font-bold">${formatRp(k.total_omzet)}</td>
                <td class="px-4 py-2.5 text-right font-mono text-slate-500">${formatRp(k.rata_rata_transaksi)}</td>
                <td class="px-4 py-2.5 text-right font-mono font-bold ${selisihClass}">${selisihText}</td>
            </tr>`;
        }).join('');
    } catch (e) { showToast(e.message, 'error'); }
}

// ==========================================================
// GRAFIK JAM RAMAI (Chart.js)
// ==========================================================
let chartJamRamaiInstance = null;

async function loadJamRamai() {
    try {
        const data = await api(`/api/laporan/jam-ramai?${tanggalFilterQuery()}`);
        const ctx = document.getElementById('chart-jam-ramai').getContext('2d');
        if (chartJamRamaiInstance) chartJamRamaiInstance.destroy();
        chartJamRamaiInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.data.map(r => `${r.jam}:00`),
                datasets: [{
                    label: 'Jumlah Transaksi',
                    data: data.data.map(r => r.jumlah_transaksi),
                    backgroundColor: '#a78bfa',
                    borderRadius: 4,
                    maxBarThickness: 18,
                }],
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            afterLabel: (item) => ` Omzet: ${formatRp(data.data[item.dataIndex].total_omzet)}`,
                        },
                    },
                },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 9 } } },
                    y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 }, precision: 0 } },
                },
            },
        });
    } catch (e) { showToast(e.message, 'error'); }
}

// ==========================================================
// GRAFIK TREN PENJUALAN (Chart.js)
// ==========================================================
let trenHariAktif = 7;
let chartTrenInstance = null;

function setTrenPeriod(hari) {
    trenHariAktif = hari;
    document.querySelectorAll('#tren-period-group .period-btn').forEach(b => {
        const active = Number(b.dataset.hari) === hari;
        b.classList.toggle('active', active);
        b.classList.toggle('text-slate-500', !active);
    });
    loadTrenPenjualan();
}

async function loadTrenPenjualan() {
    const skeleton = document.getElementById('tren-skeleton');
    const canvas = document.getElementById('chart-tren');
    skeleton.classList.remove('hidden');
    canvas.classList.add('hidden');

    try {
        const data = await api(`/api/laporan/tren-penjualan?hari=${trenHariAktif}`);
        renderChartTren(data.data);
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        skeleton.classList.add('hidden');
        canvas.classList.remove('hidden');
    }
}

function renderChartTren(rows) {
    const ctx = document.getElementById('chart-tren').getContext('2d');
    const labels = rows.map(r => {
        const d = new Date(r.tanggal + 'T00:00:00');
        return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
    });
    const omzet = rows.map(r => r.total_penjualan);
    const jumlah = rows.map(r => r.jumlah_transaksi);

    if (chartTrenInstance) chartTrenInstance.destroy();

    const gradient = ctx.createLinearGradient(0, 0, 0, 220);
    gradient.addColorStop(0, 'rgba(37,99,235,0.28)');
    gradient.addColorStop(1, 'rgba(37,99,235,0.01)');

    chartTrenInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Omzet',
                    data: omzet,
                    borderColor: '#2563eb',
                    backgroundColor: gradient,
                    fill: true,
                    tension: 0.35,
                    pointRadius: rows.length > 30 ? 0 : 3,
                    pointBackgroundColor: '#2563eb',
                    borderWidth: 2.5,
                    yAxisID: 'y',
                },
                {
                    label: 'Jumlah Transaksi',
                    data: jumlah,
                    borderColor: '#f97316',
                    backgroundColor: 'transparent',
                    borderDash: [4, 4],
                    tension: 0.35,
                    pointRadius: 0,
                    borderWidth: 1.75,
                    yAxisID: 'y1',
                },
            ],
        },
        options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 10, weight: 'bold' } } },
                tooltip: {
                    callbacks: {
                        label: (item) => item.dataset.yAxisID === 'y'
                            ? ` Omzet: ${formatRp(item.raw)}`
                            : ` Transaksi: ${item.raw}`,
                    },
                },
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                y: { position: 'left', grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 }, callback: (v) => formatRp(v).replace('Rp', 'Rp ') } },
                y1: { position: 'right', grid: { display: false }, ticks: { font: { size: 10 }, precision: 0 } },
            },
        },
    });
}

// ==========================================================
// LOG AKTIVITAS (Audit Trail)
// ==========================================================
async function loadLogAktivitas() {
    const tbody = document.getElementById('tbl-log');
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-slate-400 py-8 font-bold"><i class="fas fa-spinner fa-spin mr-2"></i>Memuat...</td></tr>';
    try {
        const entitas = document.getElementById('log-entitas').value;
        const q = entitas ? `?entitas=${entitas}` : '';
        const data = await api(`/api/log-aktivitas${q}`);
        renderLogTable(data.data);
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-red-400 py-8 font-bold">Gagal memuat log</td></tr>';
        showToast(e.message, 'error');
    }
}

const AKSI_STYLE = {
    tambah: 'bg-emerald-50 text-emerald-600',
    ubah: 'bg-blue-50 text-blue-600',
    nonaktifkan: 'bg-red-50 text-red-500',
    batalkan: 'bg-orange-50 text-orange-600',
};
const ENTITAS_ICON = {
    produk: 'fa-box', user: 'fa-user', toko: 'fa-store', kategori: 'fa-tag', transaksi: 'fa-receipt',
};

function renderLogTable(rows) {
    const tbody = document.getElementById('tbl-log');
    if (!rows || rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-slate-400 py-10 font-bold">Belum ada aktivitas tercatat</td></tr>';
        return;
    }
    tbody.innerHTML = rows.map(r => {
        const waktu = new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        const aksiClass = AKSI_STYLE[r.aksi] || 'bg-slate-100 text-slate-500';
        const icon = ENTITAS_ICON[r.entitas] || 'fa-circle-info';
        return `
        <tr class="border-t border-slate-50 hover:bg-slate-50/50">
            <td data-label="Waktu" class="px-4 py-3 text-slate-400 font-mono whitespace-nowrap">${waktu}</td>
            <td data-label="Pelaku" class="px-4 py-3 font-bold text-slate-700 whitespace-nowrap"><i class="fas fa-user-circle text-slate-300 mr-1"></i>${escapeHtml(r.username)}</td>
            <td data-label="Aksi" class="px-4 py-3 whitespace-nowrap">
                <span class="aksi-tag ${aksiClass}"><i class="fas ${icon} mr-1"></i>${escapeHtml(r.aksi)}</span>
            </td>
            <td data-label="Keterangan" class="px-4 py-3 text-slate-600">${escapeHtml(r.keterangan) || '-'}</td>
        </tr>`;
    }).join('');
}

// ==========================================================
// EXPORT EXCEL (SheetJS) — 2 sheet: Transaksi, Produk Terlaris
// ==========================================================
// Cegah CSV/Excel formula injection: kalau nilai teks bebas (nama produk, dsb)
// diawali karakter pemicu formula (= + - @), Excel/Sheets bisa
// mengeksekusinya sebagai formula saat file dibuka, bukan menampilkannya
// sebagai teks biasa. Prefix dengan apostrof memaksa Excel membacanya sebagai
// teks — teknik standar OWASP untuk kasus ini.
function sanitizeForExcel(value) {
    const s = String(value ?? '');
    return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

async function exportLaporanExcel() {
    try {
        showToast('Menyiapkan file Excel...');
        const dari = document.getElementById('rep-dari').value;
        const sampai = document.getElementById('rep-sampai').value;
        const q = new URLSearchParams();
        if (dari) q.set('dari', dari);
        if (sampai) q.set('sampai', sampai);
        // FIX (laporan): sebelumnya endpoint transaksi selalu dibatasi 500 baris
        // tanpa cara meminta lebih, jadi export toko ramai bisa kepotong diam-diam.
        // Sekarang minta batas lebih besar khusus untuk export (server tetap
        // membatasi maksimal 5000 baris per panggilan).
        const qTrx = new URLSearchParams(q); qTrx.set('limit', '5000');

        const [trxRes, terlarisRes, marginRes, kasirRes] = await Promise.all([
            api(`/api/transaksi?${qTrx}`),
            api(`/api/laporan/kombinasi-terlaris?limit=50&${q}`),
            api(`/api/laporan/margin?${q}`),
            api(`/api/laporan/per-kasir?${q}`),
        ]);

        const wb = XLSX.utils.book_new();

        // Sheet 1: Transaksi
        const trxRows = trxRes.data.map(t => ({
            'Kode Transaksi': sanitizeForExcel(t.kode_transaksi),
            'Tanggal': t.created_at,
            'Total Belanja': t.total_belanja,
            'Diskon': t.diskon,
            'Pajak': t.pajak,
            'Total Bayar': t.total_bayar,
            'Metode Bayar': t.metode_bayar,
            'Uang Diterima': t.uang_diterima,
            'Kembalian': t.kembalian,
            'Status': t.status,
        }));
        const wsTrx = XLSX.utils.json_to_sheet(trxRows.length ? trxRows : [{ Info: 'Tidak ada transaksi pada rentang ini' }]);
        XLSX.utils.book_append_sheet(wb, wsTrx, 'Transaksi');

        // Sheet 2: Produk Terlaris
        const terlarisRows = terlarisRes.data.map(p => ({
            'Produk': sanitizeForExcel(p.nama_produk),
            'Qty Terjual': p.total_qty,
            'Total Omzet': p.total_omzet,
        }));
        const wsTerlaris = XLSX.utils.json_to_sheet(terlarisRows.length ? terlarisRows : [{ Info: 'Tidak ada data' }]);
        XLSX.utils.book_append_sheet(wb, wsTerlaris, 'Produk Terlaris');

        // Sheet 3: Margin
        const wsMargin = XLSX.utils.json_to_sheet([{
            'Total Omzet': marginRes.data.total_omzet,
            'Total HPP': marginRes.data.total_hpp,
            'Margin Kotor': marginRes.data.margin_kotor,
            'Margin %': marginRes.data.margin_persen,
        }]);
        XLSX.utils.book_append_sheet(wb, wsMargin, 'Margin');

        // Sheet 4: Kinerja Kasir
        const kasirRows = kasirRes.data.map(k => ({
            'Kasir': sanitizeForExcel(k.nama_lengkap),
            'Username': sanitizeForExcel(k.username),
            'Jumlah Transaksi': k.jumlah_transaksi,
            'Total Omzet': k.total_omzet,
            'Rata-rata per Transaksi': k.rata_rata_transaksi,
            'Jumlah Shift Ditutup': k.jumlah_shift,
            'Total Selisih Kas': k.total_selisih_kas,
            'Shift Kas Kurang': k.shift_kurang,
        }));
        const wsKasir = XLSX.utils.json_to_sheet(kasirRows.length ? kasirRows : [{ Info: 'Tidak ada data' }]);
        XLSX.utils.book_append_sheet(wb, wsKasir, 'Kinerja Kasir');

        const namaFile = `Laporan-Kasir-${dari || 'semua'}_sd_${sampai || 'sekarang'}.xlsx`;
        const hasil = await window.FileSaver.save(
            XLSX.write(wb, { bookType: 'xlsx', type: 'array' }),
            namaFile,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        if (hasil.method === 'cancelled') {
            // User batal di menu share — tidak perlu toast apa pun.
        } else if (trxRes.truncated) {
            showToast(`Excel disiapkan, tapi data transaksi terpotong di 5000 baris terbaru — persempit rentang tanggal untuk data lengkap.`, 'warning');
        } else {
            showToast(hasil.method === 'share' ? 'Pilih tempat menyimpan file Excel-nya.' : 'Excel berhasil diunduh!');
        }
    } catch (e) {
        showToast(e.message || 'Gagal export Excel', 'error');
    }
}

// ==========================================================
// PRODUK
// ==========================================================
async function loadProduk() {
    try {
        const data = await api('/api/produk');
        produkList = data.data;
        renderProdukTable();
    } catch (e) { showToast(e.message, 'error'); }
}

async function renderProdukTable() {
    const q = document.getElementById('produk-search').value.toLowerCase();
    const filtered = produkList.filter(p => !q || p.nama.toLowerCase().includes(q) || p.kode_produk.toLowerCase().includes(q));
    const tbody = document.getElementById('tbl-produk');

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-slate-400 py-8 font-bold">Tidak ada produk</td></tr>';
        return;
    }

    // Selesaikan semua URL gambar (lihat resolveGambarSrc) SEBELUM bangun
    // HTML tabel — daftar produk admin bukan layar yang butuh render
    // instan seperti kasir, jadi lebih simpel & aman tunggu semua resolve
    // dulu daripada render dulu lalu tempel gambar belakangan.
    const gambarSrcMap = new Map();
    await Promise.all(
        filtered.filter(p => p.gambar_url).map(async (p) => {
            gambarSrcMap.set(p.id, await resolveGambarSrc(p.gambar_url));
        })
    );

    tbody.innerHTML = filtered.map(p => `
        <tr class="border-t border-slate-50 hover:bg-slate-50/50">
            <td data-label="Kode" class="px-4 py-3 font-mono text-slate-500">${escapeHtml(p.kode_produk)}</td>
            <td data-label="Nama" class="px-4 py-3 font-bold text-slate-700">
                <div class="flex items-center gap-2 justify-end sm:justify-start">
                    ${gambarSrcMap.get(p.id)
                        ? `<img src="${escapeHtml(gambarSrcMap.get(p.id))}" class="w-7 h-7 rounded-lg object-cover bg-slate-100 border border-slate-200 shrink-0" onerror="this.style.display='none'">`
                        : `<span class="w-7 h-7 rounded-lg bg-slate-100 border border-slate-200 shrink-0 flex items-center justify-center text-slate-300"><i class="fas fa-image text-[10px]"></i></span>`}
                    <span>${escapeHtml(p.nama)}</span>
                </div>
            </td>
            <td data-label="Kategori" class="px-4 py-3 text-slate-500">${escapeHtml(p.kategori_nama) || '-'}</td>
            <td data-label="Harga" class="px-4 py-3 text-right font-mono font-bold text-blue-600">${formatRp(p.harga_jual)}</td>
            <td data-label="Aksi" class="px-4 py-3">
                <div class="flex items-center justify-center gap-1.5 rtable-actions">
                    <button onclick="toggleResepRow('resep-produk-${p.id}', 'produk', ${p.id})" title="Resep / HPP" class="w-7 h-7 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center active:bg-emerald-500 active:text-white transition"><i class="fas fa-flask text-[11px]"></i></button>
                    <button onclick='openProdukModal(${p.id})' title="Edit" class="w-7 h-7 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center active:bg-blue-500 active:text-white transition"><i class="fas fa-pen text-[11px]"></i></button>
                    <button onclick="hapusProduk(${p.id})" title="Nonaktifkan" class="w-7 h-7 bg-red-50 text-red-500 rounded-lg flex items-center justify-center active:bg-red-500 active:text-white transition"><i class="fas fa-trash-alt text-[11px]"></i></button>
                </div>
            </td>
        </tr>
        <tr class="border-t border-slate-50">
            <td colspan="5" class="p-0">
                <div id="resep-produk-${p.id}" class="hidden bg-slate-50 px-4 py-3"></div>
            </td>
        </tr>`).join('');
}

async function ensureRefData() {
    if (currentUser.role === 'super_admin' && tokoList.length === 0) {
        const data = await api('/api/toko');
        tokoList = data.data;
    }
    if (kategoriList.length === 0) {
        const data = await api('/api/kategori');
        kategoriList = data.data;
    }
}

async function openProdukModal(id = null) {
    await ensureRefData();
    document.getElementById('form-produk').reset();
    document.getElementById('produk-satuan').value = 'pcs';
    document.getElementById('produk-id').value = id || '';

    // Dropdown toko hanya untuk super_admin
    const tokoWrap = document.getElementById('produk-toko-wrap');
    if (currentUser.role === 'super_admin') {
        tokoWrap.classList.remove('hidden');
        document.getElementById('produk-toko').innerHTML = tokoList.map(t => `<option value="${t.id}">${escapeHtml(t.nama)}</option>`).join('');
    } else {
        tokoWrap.classList.add('hidden');
    }

    document.getElementById('produk-kategori').innerHTML =
        '<option value="">- Tanpa kategori -</option>' + kategoriList.map(k => `<option value="${k.id}">${escapeHtml(k.nama)}</option>`).join('');

    if (id) {
        const p = produkList.find(x => x.id === id);
        document.getElementById('produk-modal-title').innerText = 'Edit Produk';
        document.getElementById('produk-kode').value = p.kode_produk;
        document.getElementById('produk-kode').disabled = true; // kode produk tidak boleh diubah setelah dibuat
        document.getElementById('produk-nama').value = p.nama;
        document.getElementById('produk-kategori').value = p.kategori_id || '';
        document.getElementById('produk-harga-beli').value = p.harga_beli;
        document.getElementById('produk-harga-jual').value = p.harga_jual;
        document.getElementById('produk-satuan').value = p.satuan;
        document.getElementById('produk-gambar').value = p.gambar_url || '';
        previewProdukGambar();
        if (currentUser.role === 'super_admin') document.getElementById('produk-toko').value = p.toko_id;
    } else {
        document.getElementById('produk-modal-title').innerText = 'Tambah Produk';
        document.getElementById('produk-kode').disabled = false;
        document.getElementById('produk-gambar-preview').classList.add('hidden');
    }

    openModal('modal-produk');
}

async function previewProdukGambar() {
    const url = document.getElementById('produk-gambar').value.trim();
    const img = document.getElementById('produk-gambar-preview');
    if (url) {
        img.src = await resolveGambarSrc(url) || url;
        img.classList.remove('hidden');
    } else {
        img.classList.add('hidden');
    }
}

// Kompres & resize gambar di browser SEBELUM upload — foto dari kamera HP
// bisa 4-8MB, jauh lebih besar dari yang perlu untuk foto produk kecil.
// Ini juga bikin upload jauh lebih cepat di wifi toko yang pas-pasan.
function resizeGambarProduk(file, maxDim = 1000, quality = 0.82) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            let { width, height } = img;
            if (width > maxDim || height > maxDim) {
                if (width >= height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
                else { width = Math.round(width * (maxDim / height)); height = maxDim; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Gagal memproses gambar')), 'image/jpeg', quality);
        };
        img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('File bukan gambar yang valid')); };
        img.src = objectUrl;
    });
}

async function handleProdukGambarFile(event) {
    const file = event.target.files[0];
    event.target.value = ''; // reset supaya pilih file yang sama lagi tetap trigger onchange
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        showToast('Format tidak didukung. Pakai JPG, PNG, atau WEBP.', 'error');
        return;
    }

    const labelEl = document.getElementById('produk-upload-label');
    const labelAsli = labelEl.innerText;
    labelEl.innerText = 'Memproses...';

    try {
        const blob = await resizeGambarProduk(file);
        labelEl.innerText = 'Mengupload...';

        const formData = new FormData();
        formData.append('file', blob, 'produk.jpg');

        const res = await fetch(`${API_BASE}/api/upload/produk`, {
            method: 'POST',
            credentials: 'include',
            body: formData, // JANGAN set Content-Type manual — browser yang atur boundary multipart-nya
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Gagal upload gambar');

        document.getElementById('produk-gambar').value = data.gambar_url;
        previewProdukGambar();
        showToast('Foto berhasil diupload');
    } catch (err) {
        showToast(err.message || 'Gagal upload gambar', 'error');
    } finally {
        labelEl.innerText = labelAsli;
    }
}

// ==========================================================
// SCAN BARCODE VIA KAMERA HP — untuk isi field "Kode Produk / Barcode"
// otomatis pas tambah/edit produk (dulu cuma bisa ketik manual).
// Prioritas: native BarcodeDetector API (Chrome/Android, tanpa library
// tambahan). Kalau tidak didukung (mis. Safari/iOS, Firefox desktop),
// fallback otomatis ke ZXing (dimuat lazy dari CDN hanya saat dipakai).
// Logika sama persis dengan scan barcode di halaman kasir (index.html).
// ==========================================================
let scanStream = null;
let scanRAF = null;
let zxingReader = null;
let zxingLoadPromise = null;

function loadZXing() {
    if (window.ZXingBrowser) return Promise.resolve();
    if (zxingLoadPromise) return zxingLoadPromise;
    zxingLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        // FIX (supply-chain): pin ke versi spesifik, bukan "@latest" — lihat
        // catatan yang sama di index.html loadZXing().
        script.src = 'https://unpkg.com/@zxing/browser@0.2.1/umd/zxing-browser.min.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Gagal memuat pustaka scanner'));
        document.head.appendChild(script);
    });
    return zxingLoadPromise;
}

function onBarcodeDetected(rawValue) {
    const kode = String(rawValue).trim();
    document.getElementById('produk-kode').value = kode;
    closeScanModal();
    showToast(`Barcode terbaca: ${kode}`);
}

async function openScanModal() {
    const modal = document.getElementById('modal-scan');
    const video = document.getElementById('scan-video');
    const status = document.getElementById('scan-status');
    status.innerText = 'Arahkan kamera ke barcode produk';
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    try {
        scanStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
        });
        video.srcObject = scanStream;
        await video.play();
    } catch (err) {
        showToast('Tidak bisa mengakses kamera — cek izin kamera di browser', 'error');
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

async function submitProduk(e) {
    e.preventDefault();
    const id = document.getElementById('produk-id').value;
    const payload = {
        kode_produk: document.getElementById('produk-kode').value.trim(),
        nama: document.getElementById('produk-nama').value.trim(),
        kategori_id: document.getElementById('produk-kategori').value || null,
        harga_beli: Number(document.getElementById('produk-harga-beli').value) || 0,
        harga_jual: Number(document.getElementById('produk-harga-jual').value),
        satuan: document.getElementById('produk-satuan').value.trim() || 'pcs',
        gambar_url: document.getElementById('produk-gambar').value.trim() || null,
    };
    if (currentUser.role === 'super_admin') {
        payload.toko_id = Number(document.getElementById('produk-toko').value);
    }

    try {
        if (id) {
            await api(`/api/produk/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
            await api('/api/produk', { method: 'POST', body: JSON.stringify(payload) });
        }
        closeModal('modal-produk');
        showToast('Produk berhasil disimpan');
        await loadProduk();
    } catch (e) { showToast(e.message, 'error'); }
}

async function hapusProduk(id) {
    const p = produkList.find((x) => x.id === id);
    if (!p) return;
    const ok = await showConfirm(
        'Produk tidak akan muncul lagi di kasir, tapi riwayat transaksinya tetap tersimpan.',
        { title: `Nonaktifkan "${p.nama}"?`, okText: 'Ya, Nonaktifkan', icon: 'fa-box-archive', tone: 'danger' }
    );
    if (!ok) return;
    try {
        await api(`/api/produk/${id}`, { method: 'DELETE' });
        showToast('Produk dinonaktifkan');
        await loadProduk();
    } catch (e) { showToast(e.message, 'error'); }
}

// ==========================================================
// RESEP / HPP HELPER (dipakai lewat tombol Resep di tabel produk)
// ==========================================================
async function toggleResepRow(containerElId, refType, refId) {
    const el = document.getElementById(containerElId);
    const willOpen = el.classList.contains('hidden');
    el.classList.toggle('hidden');
    // Selalu muat ulang (bukan di-cache) supaya data resep yang ditampilkan tetap terkini.
    if (willOpen) {
        await loadResepUntuk(refType, refId, containerElId);
    }
}
// ==========================================================
// BAHAN BAKU (dipakai untuk resep -> HPP -> margin)
// ==========================================================
let bahanBakuList = [];

async function loadBahanBakuTable() {
    try {
        const data = await api('/api/bahan-baku');
        bahanBakuList = data.data;
        const tbody = document.getElementById('tbl-bahan');
        if (bahanBakuList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-slate-400 py-8 font-bold">Belum ada bahan baku</td></tr>';
            return;
        }
        tbody.innerHTML = bahanBakuList.map(b => `
            <tr class="border-t border-slate-50 hover:bg-slate-50/50">
                <td data-label="Nama" class="px-4 py-3 font-bold text-slate-700">${escapeHtml(b.nama)}</td>
                <td data-label="Satuan" class="px-4 py-3 text-slate-500">${escapeHtml(b.satuan)}</td>
                <td data-label="Harga" class="px-4 py-3 text-right font-mono font-bold text-blue-600">${formatRp(b.harga_per_satuan)}</td>
                <td data-label="Aksi" class="px-4 py-3">
                    <div class="flex items-center justify-center gap-1.5 rtable-actions">
                        <button onclick='openBahanModal(${b.id})' title="Edit" class="w-7 h-7 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center active:bg-blue-500 active:text-white transition"><i class="fas fa-pen text-[11px]"></i></button>
                        <button onclick="hapusBahan(${b.id})" title="Hapus" class="w-7 h-7 bg-red-50 text-red-500 rounded-lg flex items-center justify-center active:bg-red-500 active:text-white transition"><i class="fas fa-trash-alt text-[11px]"></i></button>
                    </div>
                </td>
            </tr>`).join('');
    } catch (e) { showToast(e.message, 'error'); }
}

function openBahanModal(id = null) {
    document.getElementById('form-bahan').reset();
    document.getElementById('bahan-id').value = id || '';
    if (id) {
        const b = bahanBakuList.find(x => x.id === id);
        document.getElementById('bahan-modal-title').innerText = 'Edit Bahan Baku';
        document.getElementById('bahan-nama').value = b.nama;
        document.getElementById('bahan-satuan').value = b.satuan;
        document.getElementById('bahan-harga').value = b.harga_per_satuan;
    } else {
        document.getElementById('bahan-modal-title').innerText = 'Tambah Bahan Baku';
        document.getElementById('bahan-satuan').value = 'gram';
    }
    openModal('modal-bahan');
}

async function submitBahan(e) {
    e.preventDefault();
    const id = document.getElementById('bahan-id').value;
    const payload = {
        nama: document.getElementById('bahan-nama').value.trim(),
        satuan: document.getElementById('bahan-satuan').value.trim(),
        harga_per_satuan: Number(document.getElementById('bahan-harga').value),
    };
    try {
        if (id) await api(`/api/bahan-baku/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        else await api('/api/bahan-baku', { method: 'POST', body: JSON.stringify(payload) });
        closeModal('modal-bahan');
        showToast('Bahan baku disimpan');
        await loadBahanBakuTable();
    } catch (e) { showToast(e.message, 'error'); }
}

async function hapusBahan(id) {
    const ok = await showConfirm('Resep yang memakai bahan ini juga akan berhenti dihitung.', { title: 'Hapus bahan baku ini?', okText: 'Ya, Hapus', icon: 'fa-trash-alt', tone: 'danger' });
    if (!ok) return;
    try {
        await api(`/api/bahan-baku/${id}`, { method: 'DELETE' });
        showToast('Bahan baku dihapus');
        await loadBahanBakuTable();
    } catch (e) { showToast(e.message, 'error'); }
}

// ==========================================================
// KELOLA DATA (super_admin) — bersih-bersih data contoh/testing
// ==========================================================
async function hapusSemuaBahanBaku() {
    const ok = await showConfirm(
        'Semua bahan baku & resep (termasuk contoh starter) akan hilang. Transaksi & menu produk TIDAK ikut terhapus, tapi HPP/margin akan tampil Rp0 sampai kamu isi ulang resepnya.',
        { title: 'Hapus semua bahan baku & resep?', okText: 'Ya, Hapus Semua', icon: 'fa-trash-alt', tone: 'danger' }
    );
    if (!ok) return;
    try {
        const data = await api('/api/bahan-baku');
        for (const b of data.data) {
            await api(`/api/bahan-baku/${b.id}`, { method: 'DELETE' });
        }
        showToast(`${data.data.length} bahan baku dihapus`);
        bahanBakuList = [];
        if (document.getElementById('tab-bahan') && !document.getElementById('tab-bahan').classList.contains('hidden')) {
            await loadBahanBakuTable();
        }
    } catch (e) { showToast(e.message, 'error'); }
}

async function hapusTransaksiMassal() {
    const dari = document.getElementById('hapus-trx-dari').value;
    const sampai = document.getElementById('hapus-trx-sampai').value;
    const rentangText = (dari || sampai)
        ? `transaksi dari ${dari || 'awal'} sampai ${sampai || 'sekarang'}`
        : 'SEMUA transaksi (reset total penjualan)';

    const ok = await showConfirm(
        `Ini akan menghapus ${rentangText} secara PERMANEN, termasuk seluruh rincian itemnya. Tidak bisa dibatalkan lewat aplikasi.`,
        { title: 'Yakin hapus transaksi?', okText: 'Lanjutkan', icon: 'fa-triangle-exclamation', tone: 'danger' }
    );
    if (!ok) return;

    // Konfirmasi kedua (ketik ulang) khusus untuk operasi ini — sengaja lebih
    // ketat dari showConfirm biasa karena transaksi yang terhapus TIDAK BISA
    // dipulihkan lewat aplikasi (beda dengan produk/bahan baku yang cuma
    // dinonaktifkan/soft-delete).
    const ketikan = prompt(`Ketik "HAPUS" (huruf besar semua) untuk mengonfirmasi penghapusan ${rentangText}:`);
    if (ketikan !== 'HAPUS') {
        if (ketikan !== null) showToast('Dibatalkan — teks konfirmasi tidak cocok', 'warning');
        return;
    }

    try {
        const data = await api('/api/transaksi/bulk', {
            method: 'DELETE',
            body: JSON.stringify({ dari: dari || undefined, sampai: sampai || undefined, konfirmasi: 'HAPUS' }),
        });
        showToast(`${data.jumlah_dihapus} transaksi berhasil dihapus`);
        document.getElementById('hapus-trx-dari').value = '';
        document.getElementById('hapus-trx-sampai').value = '';
        await loadDashboard();
    } catch (e) { showToast(e.message, 'error'); }
}

// ==========================================================
// RESEP (dipakai lewat tombol Resep di tabel produk — lihat renderProdukTable)
// ==========================================================
async function loadResepUntuk(refType, refId, containerElId) {
    try {
        if (bahanBakuList.length === 0) await loadBahanBakuTable();
        const data = await api(`/api/resep?ref_type=${refType}&ref_id=${refId}`);
        const wrap = document.getElementById(containerElId);
        const rows = data.data.map(r => `
            <div class="flex items-center justify-between gap-2 bg-white rounded-lg px-2.5 py-1.5 border border-slate-100">
                <span class="text-[11px] text-slate-600">${escapeHtml(r.bahan_nama)} — ${r.jumlah}${escapeHtml(r.satuan)}</span>
                <div class="flex items-center gap-2">
                    <span class="text-[11px] font-bold text-slate-400">${formatRp(r.jumlah * r.harga_per_satuan)}</span>
                    <button onclick="hapusResep(${r.id}, '${refType}', ${refId}, '${containerElId}')" class="w-5 h-5 bg-red-50 text-red-500 rounded flex items-center justify-center active:bg-red-500 active:text-white transition"><i class="fas fa-times text-[9px]"></i></button>
                </div>
            </div>`).join('');
        const bahanOptions = bahanBakuList.map(b => `<option value="${b.id}">${escapeHtml(b.nama)} (${escapeHtml(b.satuan)})</option>`).join('');
        wrap.innerHTML = `
            <div class="space-y-1.5 mb-2">${rows || '<p class="text-[11px] text-slate-400">Belum ada resep.</p>'}</div>
            <div class="flex justify-between items-center mb-2 px-0.5">
                <span class="text-[10px] font-bold text-slate-500 uppercase">Estimasi HPP</span>
                <span class="text-xs font-extrabold text-emerald-600">${formatRp(data.total_hpp)}</span>
            </div>
            <form onsubmit="tambahResep(event, '${refType}', ${refId}, '${containerElId}')" class="flex gap-1.5">
                <select id="resep-bahan-${refType}-${refId}" required class="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-bold">${bahanOptions || '<option value="">- Belum ada bahan baku -</option>'}</select>
                <input type="number" id="resep-jumlah-${refType}-${refId}" required min="0.01" step="any" placeholder="Qty" class="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-bold">
                <button type="submit" class="shrink-0 w-8 h-8 bg-emerald-600 text-white rounded-lg active:scale-95 transition"><i class="fas fa-plus text-[10px]"></i></button>
            </form>`;
    } catch (e) { showToast(e.message, 'error'); }
}

async function tambahResep(e, refType, refId, containerElId) {
    e.preventDefault();
    const bahanSel = document.getElementById(`resep-bahan-${refType}-${refId}`);
    const jumlahInput = document.getElementById(`resep-jumlah-${refType}-${refId}`);
    const bahan_baku_id = Number(bahanSel.value);
    const jumlah = Number(jumlahInput.value);
    if (!bahan_baku_id) { showToast('Tambahkan bahan baku dulu di tab Bahan Baku', 'error'); return; }
    try {
        await api('/api/resep', { method: 'POST', body: JSON.stringify({ ref_type: refType, ref_id: refId, bahan_baku_id, jumlah }) });
        await loadResepUntuk(refType, refId, containerElId);
    } catch (e) { showToast(e.message, 'error'); }
}

async function hapusResep(id, refType, refId, containerElId) {
    try {
        await api(`/api/resep/${id}`, { method: 'DELETE' });
        await loadResepUntuk(refType, refId, containerElId);
    } catch (e) { showToast(e.message, 'error'); }
}

// ==========================================================
// PESANAN MENDATANG (PREORDER)
// ==========================================================
// ==========================================================
// RIWAYAT TRANSAKSI (lihat & batalkan transaksi)
// ==========================================================
let riwayatTrxList = [];

async function loadRiwayatTransaksi() {
    try {
        const q = tanggalFilterQuery();
        q.set('limit', '200');
        const data = await api(`/api/transaksi?${q}`);
        riwayatTrxList = data.data;
        const tbody = document.getElementById('tbl-riwayat');
        if (riwayatTrxList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-slate-400 py-8 font-bold">Tidak ada transaksi pada rentang tanggal ini</td></tr>';
            return;
        }
        const statusBadge = { selesai: 'bg-emerald-50 text-emerald-700', dibatalkan: 'bg-red-50 text-red-500' };
        tbody.innerHTML = riwayatTrxList.map(t => {
            const kasir = userList.find(u => u.id === t.kasir_id);
            return `
            <tr class="border-t border-slate-50 hover:bg-slate-50/50">
                <td data-label="Kode" class="px-4 py-3 font-mono text-slate-500">${escapeHtml(t.kode_transaksi)}</td>
                <td data-label="Waktu" class="px-4 py-3 text-slate-500">${new Date(t.created_at.replace(' ', 'T') + 'Z').toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td data-label="Kasir" class="px-4 py-3 text-slate-600">${escapeHtml(kasir?.nama_lengkap || '-')}</td>
                <td data-label="Total" class="px-4 py-3 text-right font-mono font-bold text-blue-600">${formatRp(t.total_bayar)}</td>
                <td data-label="Metode" class="px-4 py-3 text-slate-500 uppercase text-[10px] font-bold">${escapeHtml(t.metode_bayar)}</td>
                <td data-label="Status" class="px-4 py-3 text-center">
                    <span class="px-2 py-1 rounded-lg text-[10px] font-bold ${statusBadge[t.status] || 'bg-slate-100 text-slate-500'}" title="${t.alasan_batal ? escapeHtml(t.alasan_batal) : ''}">${escapeHtml(t.status)}</span>
                    ${t.status === 'selesai' && t.jumlah_item_batal > 0 ? `<span class="block mt-1 text-[9px] text-amber-600 font-bold">${t.jumlah_item_batal} item batal</span>` : ''}
                </td>
                <td data-label="Aksi" class="px-4 py-3 text-center">
                    ${t.status === 'selesai' ? `<button onclick="openBatalItemModal(${t.id})" class="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-[11px] font-bold active:scale-95 transition"><i class="fas fa-ban mr-1"></i>Batalkan</button>` : (t.alasan_batal ? `<span class="text-[10px] text-slate-400 italic">"${escapeHtml(t.alasan_batal)}"</span>` : '-')}
                </td>
            </tr>`;
        }).join('');
    } catch (e) { showToast(e.message, 'error'); }
}

let batalItemTransaksiId = null;

let batalItemPembayaran = []; // metode pembayaran transaksi yg lagi dibuka di modal batal item

async function openBatalItemModal(transaksiId) {
    try {
        const data = await api(`/api/transaksi/${transaksiId}`);
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

        openModal('modal-batal-item');
    } catch (e) { showToast(e.message, 'error'); }
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

    // Pengingat kembalikan uang tunai — pembayaran tunai sudah diterima fisik
    // saat transaksi dibuat, sistem TIDAK otomatis mengatur ulang kas laci
    // saat item dibatalkan, jadi kasir/admin wajib mengembalikan uang tunai
    // secara fisik ke pembeli sendiri.
    const adaCash = batalItemPembayaran.some(p => p.metode_bayar === 'cash');
    const pesanUang = adaCash
        ? `\n\n⚠️ Ingatkan kasir untuk mengembalikan uang tunai ${formatRp(nominalDibatalkan)} ke pembeli secara fisik — sistem tidak melakukan ini otomatis.`
        : `\n\nNominal ${formatRp(nominalDibatalkan)} ini dibayar non-tunai (${batalItemPembayaran.map(p => (p.metode_bayar || '').toUpperCase()).join('/')}) — proses pengembaliannya di luar aplikasi ini.`;

    const ok = await showConfirm(
        (checked.length === totalItem
            ? 'Seluruh transaksi ini akan ditandai batal dan tidak ikut dihitung ke laporan penjualan.'
            : `${checked.length} item yang dicentang akan ditandai batal. Sisanya tetap dihitung normal.`) + pesanUang,
        { title: 'Batalkan item ini?', okText: 'Ya, Batalkan', icon: 'fa-ban', tone: 'danger' }
    );
    if (!ok) return;

    try {
        const data = await api(`/api/transaksi/${batalItemTransaksiId}/batalkan`, {
            method: 'POST',
            body: JSON.stringify({ item_ids: checked, alasan: alasan || undefined }),
        });
        showToast(`${data.jumlah_item_dibatalkan} item dibatalkan (${formatRp(data.nominal_dikurangi)})`);
        closeModal('modal-batal-item');
        await loadRiwayatTransaksi();
    } catch (e) { showToast(e.message, 'error'); }
}

async function loadPreorderTable() {
    try {
        const status = document.getElementById('preorder-filter-status').value;
        const data = await api(`/api/preorder${status ? `?status=${status}` : ''}`);
        const wrap = document.getElementById('preorder-list');
        if (data.data.length === 0) {
            wrap.innerHTML = '<div class="card p-8 text-center text-slate-400 font-bold text-sm">Tidak ada pesanan</div>';
            return;
        }
        const badge = { menunggu: 'bg-amber-50 text-amber-700', selesai: 'bg-emerald-50 text-emerald-700', dibatalkan: 'bg-red-50 text-red-500' };
        const bayarBadge = { lunas: 'bg-emerald-50 text-emerald-700', dp: 'bg-amber-50 text-amber-700', belum_bayar: 'bg-red-50 text-red-600' };
        const bayarLabel = { lunas: 'Lunas', dp: 'DP', belum_bayar: 'Belum Bayar' };
        const now = Date.now();
        const dpList = data.data.filter(p => (p.sisa_bayar || 0) > 0 && p.status_bayar === 'dp');
        const belumBayarList = data.data.filter(p => (p.sisa_bayar || 0) > 0 && p.status_bayar === 'belum_bayar');
        const totalPiutang = dpList.reduce((s, p) => s + p.sisa_bayar, 0) + belumBayarList.reduce((s, p) => s + p.sisa_bayar, 0);
        const jumlahTerlambat = data.data.filter(p => p.status_preorder === 'menunggu' && new Date(p.waktu_ambil).getTime() < now).length;
        const ringkasan = totalPiutang > 0
            ? `<div class="card p-4 mb-3 bg-red-50 border border-red-100">
                 <div class="flex items-center justify-between mb-1.5">
                   <span class="text-xs font-bold text-red-700"><i class="fas fa-hand-holding-dollar mr-1.5"></i>Total sisa tagihan preorder aktif</span>
                   <span class="text-sm font-extrabold text-red-700">${formatRp(totalPiutang)}</span>
                 </div>
                 <div class="flex gap-3 text-[11px] font-bold text-red-600/80">
                   <span>DP: ${dpList.length} pesanan (${formatRp(dpList.reduce((s, p) => s + p.sisa_bayar, 0))})</span>
                   <span>Belum Bayar: ${belumBayarList.length} pesanan (${formatRp(belumBayarList.reduce((s, p) => s + p.sisa_bayar, 0))})</span>
                 </div>
                 ${jumlahTerlambat > 0 ? `<p class="text-[11px] font-bold text-red-700 mt-1.5"><i class="fas fa-triangle-exclamation mr-1"></i>${jumlahTerlambat} pesanan sudah lewat waktu ambil</p>` : ''}
               </div>`
            : (jumlahTerlambat > 0 ? `<div class="card p-4 mb-3 bg-amber-50 border border-amber-100">
                 <span class="text-xs font-bold text-amber-700"><i class="fas fa-triangle-exclamation mr-1.5"></i>${jumlahTerlambat} pesanan sudah lewat waktu ambil</span>
               </div>` : '');
        wrap.innerHTML = ringkasan + data.data.map(p => {
            const statusBayar = p.status_bayar || 'lunas';
            const sisaBayar = p.sisa_bayar || 0;
            const terlambat = p.status_preorder === 'menunggu' && new Date(p.waktu_ambil).getTime() < now;
            return `
            <div class="card p-4 ${terlambat ? 'border border-red-300 bg-red-50/50' : ''}">
                <div class="flex items-start justify-between gap-3 mb-2">
                    <div>
                        <p class="font-extrabold text-sm text-slate-800">${new Date(p.waktu_ambil).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                        <p class="text-xs text-slate-500 font-medium">${escapeHtml([p.nama_pemesan, p.hp_pemesan].filter(Boolean).join(' — ') || 'Tanpa nama pemesan')} &middot; ${escapeHtml(p.kode_transaksi)}</p>
                        ${terlambat ? `<p class="text-[11px] font-bold text-red-600 mt-0.5"><i class="fas fa-triangle-exclamation mr-1"></i>Sudah lewat waktu ambil${sisaBayar > 0 ? ' & belum lunas' : ''}</p>` : ''}
                    </div>
                    <div class="flex flex-col items-end gap-1 shrink-0">
                        <span class="px-2 py-1 rounded-lg text-[10px] font-bold ${badge[p.status_preorder] || 'bg-slate-100 text-slate-500'}">${escapeHtml(p.status_preorder)}</span>
                        <span class="px-2 py-1 rounded-lg text-[10px] font-bold ${bayarBadge[statusBayar] || 'bg-slate-100 text-slate-500'}">${bayarLabel[statusBayar] || statusBayar}</span>
                    </div>
                </div>
                <div class="text-xs text-slate-600 space-y-0.5 mb-3 pl-0.5">
                    ${(p.items || []).map(it => `<p>• ${it.qty}x ${escapeHtml(it.nama_produk)}${it.ukuran_nama ? ` (${escapeHtml(it.ukuran_nama)})` : ''}</p>`).join('')}
                </div>
                <div class="flex items-center justify-between">
                    <div>
                        <span class="font-bold text-sm text-blue-600 block">${formatRp(p.total_bayar)}</span>
                        ${sisaBayar > 0 ? `<span class="text-[10px] font-bold text-red-500">Sisa ${formatRp(sisaBayar)}</span>` : ''}
                    </div>
                    ${p.status_preorder === 'menunggu' ? `
                        <div class="flex gap-1.5 flex-wrap justify-end">
                            ${sisaBayar > 0 ? `<button onclick="pelunasiPreorder(${p.id}, ${sisaBayar})" class="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[11px] font-bold active:scale-95 transition">Lunasi</button>` : ''}
                            <button onclick="updatePreorderStatus(${p.id}, 'selesai')" class="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-bold active:scale-95 transition">Selesai</button>
                            <button onclick="updatePreorderStatus(${p.id}, 'dibatalkan')" class="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-[11px] font-bold active:scale-95 transition">Batal</button>
                        </div>` : ''}
                </div>
            </div>`;
        }).join('');
    } catch (e) { showToast(e.message, 'error'); }
}

async function updatePreorderStatus(id, status) {
    try {
        await api(`/api/preorder/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
        showToast('Status preorder diperbarui');
        await loadPreorderTable();
    } catch (e) { showToast(e.message, 'error'); }
}

// ==========================================
// MODAL PELUNASAN PREORDER (mendukung split metode bayar)
// ==========================================
let pelunasanRows = [];
let pelunasanRowSeq = 0;
let pelunasanCtx = { preorderId: null, batasAtas: 0 };

function pelunasiPreorder(id, sisaBayar) {
    pelunasanCtx = { preorderId: id, batasAtas: sisaBayar };
    pelunasanRows = [{ id: ++pelunasanRowSeq, metode: 'cash', jumlah: '' }];
    document.getElementById('pelunasan-batas').innerText = formatRp(sisaBayar);
    renderPelunasanRows();
    openModal('modal-pelunasan');
}

function addPelunasanRow() {
    const used = pelunasanRows.map(r => r.metode);
    const next = ['cash', 'qris', 'debit', 'transfer'].find(m => !used.includes(m)) || 'cash';
    pelunasanRows.push({ id: ++pelunasanRowSeq, metode: next, jumlah: '' });
    renderPelunasanRows();
}

function removePelunasanRow(id) {
    if (pelunasanRows.length <= 1) return;
    pelunasanRows = pelunasanRows.filter(r => r.id !== id);
    renderPelunasanRows();
}

function updatePelunasanRowMetode(id, metode) {
    const row = pelunasanRows.find(r => r.id === id);
    if (row) row.metode = metode;
    renderPelunasanSummary();
}

function updatePelunasanRowJumlah(id, value) {
    const row = pelunasanRows.find(r => r.id === id);
    if (row) row.jumlah = value.replace(/[^0-9]/g, '');
    const input = document.getElementById(`pelunasan-jumlah-${id}`);
    if (input && input.value !== row.jumlah) input.value = row.jumlah;
    renderPelunasanSummary();
}

function renderPelunasanRows() {
    const wrap = document.getElementById('pelunasan-rows');
    wrap.innerHTML = pelunasanRows.map((row, idx) => `
        <div class="border border-slate-200 rounded-xl p-3 bg-slate-50/60">
            <div class="flex items-center justify-between mb-2">
                <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Metode ${idx + 1}</span>
                <button onclick="removePelunasanRow(${row.id})" ${pelunasanRows.length <= 1 ? 'disabled' : ''}
                        class="w-7 h-7 rounded-lg bg-red-50 text-red-500 flex items-center justify-center active:bg-red-100 transition shrink-0 disabled:opacity-30">
                    <i class="fas fa-trash-alt text-[11px]"></i>
                </button>
            </div>
            <div class="flex gap-2">
                <select onchange="updatePelunasanRowMetode(${row.id}, this.value)" class="min-w-0 flex-1 border border-slate-200 rounded-xl px-2 py-3 text-xs font-bold text-slate-700 bg-white">
                    ${Object.entries(METODE_LABEL).map(([val, label]) => `<option value="${val}" ${row.metode === val ? 'selected' : ''}>${label}</option>`).join('')}
                </select>
                <input id="pelunasan-jumlah-${row.id}" type="text" inputmode="numeric" placeholder="Rp0" value="${row.jumlah}"
                       oninput="updatePelunasanRowJumlah(${row.id}, this.value)"
                       class="min-w-0 flex-1 border border-slate-200 rounded-xl px-3 py-3 text-sm font-bold text-slate-800 text-right font-mono">
            </div>
        </div>
    `).join('');
    renderPelunasanSummary();
}

function renderPelunasanSummary() {
    const total = pelunasanRows.reduce((s, r) => s + (parseInt(r.jumlah) || 0), 0);
    document.getElementById('pelunasan-total').innerText = formatRp(total);
    const labelEl = document.getElementById('pelunasan-sisa-label');
    const sisaEl = document.getElementById('pelunasan-sisa');
    const btn = document.getElementById('btn-confirm-pelunasan');
    const adaKosong = pelunasanRows.some(r => !r.jumlah || parseInt(r.jumlah) <= 0);

    if (total > pelunasanCtx.batasAtas + 0.5) {
        labelEl.innerText = 'Melebihi sisa tagihan';
        sisaEl.innerText = 'Kurangi nominal';
        sisaEl.className = 'text-red-500 font-bold';
        btn.disabled = true;
        return;
    }
    const sisaSetelah = Math.max(0, pelunasanCtx.batasAtas - total);
    sisaEl.innerText = formatRp(sisaSetelah);
    sisaEl.className = (sisaSetelah > 0 ? 'text-amber-600' : 'text-emerald-600') + ' font-bold';
    btn.disabled = adaKosong || total <= 0;
}

async function confirmPelunasan() {
    const entries = pelunasanRows
        .filter(r => parseInt(r.jumlah) > 0)
        .map(r => ({ metode: r.metode, jumlah: parseInt(r.jumlah) }));
    if (entries.length === 0) return;
    try {
        const data = await api(`/api/preorder/${pelunasanCtx.preorderId}/pelunasan`, { method: 'POST', body: JSON.stringify({ pembayaran: entries }) });
        closeModal('modal-pelunasan');
        showToast(data.status_bayar === 'lunas' ? 'Preorder lunas!' : `Tercatat. Sisa ${formatRp(data.sisa_bayar)}`);
        await loadPreorderTable();
    } catch (e) { showToast(e.message, 'error'); }
}

// ==========================================
// RIWAYAT PELUNASAN (laporan trend piutang tertagih per hari)
// ==========================================
async function loadRiwayatPelunasan() {
    try {
        const dari = document.getElementById('riwayat-pelunasan-dari').value;
        const sampai = document.getElementById('riwayat-pelunasan-sampai').value;
        if (!dari || !sampai) { showToast('Isi rentang tanggal dulu', 'warning'); return; }
        const data = await api(`/api/laporan/piutang?dari=${dari}&sampai=${sampai}`);
        const wrap = document.getElementById('riwayat-pelunasan-list');
        const riwayat = data.riwayat_pelunasan || [];
        if (riwayat.length === 0) {
            wrap.innerHTML = '<p class="text-center text-slate-400 text-xs font-bold py-4">Tidak ada pelunasan di rentang ini</p>';
            document.getElementById('riwayat-pelunasan-total').innerText = formatRp(0);
            return;
        }
        const total = riwayat.reduce((s, r) => s + r.total, 0);
        document.getElementById('riwayat-pelunasan-total').innerText = formatRp(total);
        wrap.innerHTML = riwayat.map(r => `
            <div class="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                <span class="text-xs font-bold text-slate-600">${new Date(r.tanggal).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                <div class="text-right">
                    <span class="text-sm font-extrabold text-emerald-600 block">${formatRp(r.total)}</span>
                    <span class="text-[10px] text-slate-400">${r.jumlah_pelunasan}x pelunasan</span>
                </div>
            </div>
        `).join('');
    } catch (e) { showToast(e.message, 'error'); }
}

function toggleRiwayatPelunasan() {
    const wrap = document.getElementById('riwayat-pelunasan-wrap');
    const willOpen = wrap.classList.contains('hidden');
    wrap.classList.toggle('hidden');
    if (willOpen) {
        const today = new Date();
        const sevenDaysAgo = new Date(today.getTime() - 6 * 86400000);
        document.getElementById('riwayat-pelunasan-sampai').value = today.toISOString().slice(0, 10);
        document.getElementById('riwayat-pelunasan-dari').value = sevenDaysAgo.toISOString().slice(0, 10);
        loadRiwayatPelunasan();
    }
}

async function tambahKategoriBaru() {
    const nama = prompt('Nama kategori baru:');
    if (!nama || !nama.trim()) return;
    try {
        const data = await api('/api/kategori', { method: 'POST', body: JSON.stringify({ nama: nama.trim() }) });
        kategoriList.push({ id: data.id, nama: nama.trim() });
        const sel = document.getElementById('produk-kategori');
        sel.innerHTML += `<option value="${data.id}">${escapeHtml(nama.trim())}</option>`;
        sel.value = data.id;
        showToast('Kategori ditambahkan');
    } catch (e) { showToast(e.message, 'error'); }
}

// ==========================================================
// USERS (KASIR)
// ==========================================================
async function loadUsers() {
    try {
        const data = await api('/api/users');
        userList = data.data;
        renderUserTable();
    } catch (e) { showToast(e.message, 'error'); }
}

function renderUserTable() {
    const tbody = document.getElementById('tbl-users');
    if (userList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-slate-400 py-8 font-bold">Belum ada user</td></tr>';
        return;
    }
    const roleLabel = { super_admin: 'Super Admin', admin_toko: 'Admin Toko', kasir: 'Kasir' };
    tbody.innerHTML = userList.map(u => `
        <tr class="border-t border-slate-50 hover:bg-slate-50/50">
            <td data-label="Username" class="px-4 py-3 font-mono text-slate-500">${escapeHtml(u.username)}</td>
            <td data-label="Nama" class="px-4 py-3 font-bold text-slate-700">${escapeHtml(u.nama_lengkap)}</td>
            <td data-label="Role" class="px-4 py-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-600">${roleLabel[u.role] || u.role}</span></td>
            <td data-label="Status" class="px-4 py-3 text-center">
                ${u.is_active ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600">Aktif</span>' : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-400">Nonaktif</span>'}
            </td>
            <td data-label="Aksi" class="px-4 py-3 text-center">
                <button onclick="openUserModal(${u.id})" title="Edit" class="w-7 h-7 bg-blue-50 text-blue-600 rounded-lg inline-flex items-center justify-center active:bg-blue-500 active:text-white transition"><i class="fas fa-pen text-[11px]"></i></button>
            </td>
        </tr>`).join('');
}

async function openUserModal(id = null) {
    await ensureRefData();
    document.getElementById('form-user').reset();
    document.getElementById('user-id').value = id || '';

    const roleWrap = document.getElementById('user-role-wrap');
    const tokoWrap = document.getElementById('user-toko-wrap');
    const activeWrap = document.getElementById('user-active-wrap');
    const pwLabel = document.getElementById('user-password-label');
    const pwHint = document.getElementById('user-password-hint');
    const usernameInput = document.getElementById('user-username');

    if (currentUser.role === 'super_admin') {
        roleWrap.classList.remove('hidden');
        tokoWrap.classList.remove('hidden');
        document.getElementById('user-toko').innerHTML = tokoList.map(t => `<option value="${t.id}">${escapeHtml(t.nama)}</option>`).join('');
    } else {
        // admin_toko hanya boleh membuat kasir di tokonya sendiri
        roleWrap.classList.add('hidden');
        tokoWrap.classList.add('hidden');
    }

    if (id) {
        const u = userList.find(x => x.id === id);
        document.getElementById('user-modal-title').innerText = 'Edit User';
        usernameInput.value = u.username;
        usernameInput.disabled = true;
        document.getElementById('user-nama').value = u.nama_lengkap;
        document.getElementById('user-role').value = u.role;
        if (currentUser.role === 'super_admin') document.getElementById('user-toko').value = u.toko_id;
        activeWrap.classList.remove('hidden');
        document.getElementById('user-active').checked = !!u.is_active;
        pwLabel.innerText = 'Password Baru (opsional)';
        pwHint.innerText = 'Kosongkan jika tidak ingin mengubah password.';
        document.getElementById('user-password').required = false;
    } else {
        document.getElementById('user-modal-title').innerText = 'Tambah User';
        usernameInput.disabled = false;
        activeWrap.classList.add('hidden');
        pwLabel.innerText = 'Password';
        pwHint.innerText = 'Minimal 6 karakter.';
        document.getElementById('user-password').required = true;
    }

    openModal('modal-user');
}

async function submitUser(e) {
    e.preventDefault();
    const id = document.getElementById('user-id').value;
    const password = document.getElementById('user-password').value;

    if (!id && (!password || password.length < 6)) {
        showToast('Password minimal 6 karakter', 'error'); return;
    }

    const payload = {
        username: document.getElementById('user-username').value.trim(),
        nama_lengkap: document.getElementById('user-nama').value.trim(),
    };
    if (currentUser.role === 'super_admin') {
        payload.role = document.getElementById('user-role').value;
        payload.toko_id = Number(document.getElementById('user-toko').value);
    }
    if (password) payload.password = password;
    if (id) payload.is_active = document.getElementById('user-active').checked ? 1 : 0;

    try {
        if (id) {
            await api(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
            await api('/api/users', { method: 'POST', body: JSON.stringify(payload) });
        }
        closeModal('modal-user');
        showToast('User berhasil disimpan');
        await loadUsers();
    } catch (e) { showToast(e.message, 'error'); }
}

// ==========================================================
// INIT
// ==========================================================
window.onload = async () => {
    loadAppTitle(); // non-blocking
    const ok = await checkAuth();
    if (!ok) return;

    // PENTING: pakai tanggal WIB, bukan UTC — kalau pakai toISOString() polos,
    // antara jam 00:00-06:59 WIB filter "hari ini" akan meleset satu hari
    // mundur (karena di jam-jam itu UTC masih tanggal kemarin), padahal
    // backend menghitung laporan berbasis tanggal WIB (lihat wibDateExpr di
    // src/index.ts). Kalau meleset, dashboard yang dibuka dini hari akan
    // kelihatan kosong/salah walau transaksi hari itu sudah ada.
    const todayWIB = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    document.getElementById('rep-dari').value = todayWIB;
    document.getElementById('rep-sampai').value = todayWIB;

    await loadDashboard();
};
