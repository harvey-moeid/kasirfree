// ==========================================================
// file-saver.js — Helper bersama buat "simpan/ekspor file" (dipakai
// export Excel laporan & export backup data).
//
// KENAPA INI PERLU ADA (bukan langsung bikin <a download> + klik seperti
// sebelumnya): trik <a download> classic ANDALKAN download manager
// browser (Chrome/Safari/dll punya ini bawaan). Tapi kalau app ini
// dibungkus jadi APK (Capacitor WebView), WebView-nya TIDAK otomatis
// punya download manager terhubung — klik <a download> di sana sering
// diam-diam tidak melakukan apa-apa (tidak ada file tersimpan, tidak ada
// error/pesan apa pun juga, jadi user tidak tahu apa yang salah).
//
// Solusi: kalau terdeteksi jalan di dalam APK (window.Capacitor ada —
// ini variabel yang SELALU disuntik Capacitor ke tiap app-nya, bisa
// diandalkan), pakai Web Share API (navigator.share dengan file) supaya
// muncul menu "Bagikan/Simpan ke..." bawaan Android — jauh lebih reliable
// di WebView dibanding trik <a download>. Di browser biasa (desktop/HP
// tanpa dibungkus APK), trik <a download> klasik TETAP dipakai karena di
// sana justru itu yang paling familiar buat user (langsung masuk folder
// Downloads, bukan minta pilih "bagikan ke mana").
// ==========================================================

window.FileSaver = {
  /**
   * @param {BlobPart} data - isi file (ArrayBuffer, string, dst)
   * @param {string} filename
   * @param {string} mimeType
   * @returns {Promise<{method: 'share'|'download'|'cancelled'}>}
   */
  async save(data, filename, mimeType) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
    const runningInApk = !!window.Capacitor;

    if (runningInApk && navigator.share && navigator.canShare) {
      try {
        const file = new File([blob], filename, { type: mimeType });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file] });
          return { method: 'share' };
        }
      } catch (err) {
        if (err.name === 'AbortError') return { method: 'cancelled' }; // user batal di menu share, bukan error
        // Web Share gagal karena alasan lain — tetap coba fallback di bawah
        // daripada langsung menyerah.
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { method: 'download' };
  },
};
