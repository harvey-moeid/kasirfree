// login-app.js — Logika halaman Login. Dipindah dari inline <script>
// supaya HTML murni markup.

        // Kosongkan karena front-end & Worker API sekarang disajikan dari
        // domain/route yang SAMA (lihat [assets] di wrangler.toml), jadi path
        // relatif /api/... sudah cukup. JANGAN hardcode domain lain di sini —
        // sebelumnya masih menunjuk ke subdomain lama yang berbeda dari Worker
        // yang sebenarnya, menyebabkan browser gagal fetch (CORS/domain tidak
        // ditemukan) saat login.
        const API_BASE = '';

        function togglePassword() {
            const pwdInput = document.getElementById('password');
            const eyeIcon = document.getElementById('eye-icon');
            
            if (navigator.vibrate) navigator.vibrate(20);

            if (pwdInput.type === 'password') {
                pwdInput.type = 'text';
                eyeIcon.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                pwdInput.type = 'password';
                eyeIcon.classList.replace('fa-eye-slash', 'fa-eye');
            }
        }

        function showError(message) {
            const errBox = document.getElementById('error-alert');
            document.getElementById('error-msg').innerText = message;
            errBox.classList.remove('hidden');
            errBox.classList.add('flex');
            
            // Goyangkan form (Shake animation)
            const form = document.getElementById('login-form');
            form.animate([
                { transform: 'translateX(0)' },
                { transform: 'translateX(-5px)' },
                { transform: 'translateX(5px)' },
                { transform: 'translateX(-5px)' },
                { transform: 'translateX(0)' }
            ], { duration: 300, iterations: 1 });
            
            if (navigator.vibrate) navigator.vibrate([50, 50, 50]); // Getar error
        }

        function hideError() {
            document.getElementById('error-alert').classList.add('hidden');
            document.getElementById('error-alert').classList.remove('flex');
        }

        async function handleLogin(e) {
            e.preventDefault();
            hideError();

            const userVal = document.getElementById('username').value.trim();
            const passVal = document.getElementById('password').value;
            
            const btn = document.getElementById('btn-submit');
            const btnText = document.getElementById('btn-text');
            const btnIcon = document.getElementById('btn-icon');
            const btnLoader = document.getElementById('btn-loader');

            // Set state loading
            btn.disabled = true;
            btn.classList.add('bg-blue-700');
            btnText.style.opacity = '0';
            btnIcon.style.opacity = '0';
            btnLoader.classList.remove('hidden');
            btnLoader.style.display = ''; // lepas pengaman inline display:none (lihat login.html)

            try {
                // Panggilan ke /api/auth/login DIBELOKKAN oleh fetch-shim.js ke
                // database lokal (IndexedDB) di HP ini — tidak ada request jaringan.
                const res = await fetch(`${API_BASE}/api/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: userVal, password: passVal })
                });

                let data;
                try {
                    data = await res.json();
                } catch {
                    throw new Error('Terjadi kesalahan. Coba lagi.');
                }

                if (!res.ok || !data.success) {
                    throw new Error(data.error || 'Password salah');
                }

                sessionStorage.setItem('kasir_user', JSON.stringify(data.user));

                if (navigator.vibrate) navigator.vibrate([30, 50, 30]); // Getar sukses

                btn.classList.replace('bg-blue-700', 'bg-green-500');
                btn.classList.replace('shadow-blue-600/30', 'shadow-green-500/30');
                btnLoader.classList.replace('fa-spinner', 'fa-check');
                btnLoader.classList.remove('fa-spin');

                // Selalu ke halaman kasir (index.html). Menu "Dashboard Admin"
                // tersedia dari sana lewat menu Akun.
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 500);

            } catch (err) {
                // Gagal
                showError(err.message || "Gagal masuk");

                // Reset tombol
                btn.disabled = false;
                btn.classList.remove('bg-blue-700');
                btnText.style.opacity = '1';
                btnIcon.style.opacity = '1';
                btnLoader.classList.add('hidden');
            }
        }

        /** Ambil judul aplikasi (bisa diubah lewat panel admin) & terapkan ke tab browser + logo login. */
        async function loadAppTitle() {
            try {
                const res = await fetch(`${API_BASE}/api/settings`);
                const data = await res.json();
                const title = (data.success && data.data?.app_title) ? data.data.app_title : 'muidsoft';
                document.title = `Login - ${title}`;
                const titleEl = document.getElementById('login-title');
                if (titleEl) titleEl.innerText = title;
            } catch {
                // Gagal ambil pengaturan (mis. offline) — biarkan judul default di HTML.
            }
        }
        loadAppTitle();

        // Kalau HP ini belum punya akun sama sekali (instalasi baru),
        // tampilkan wizard "Setup Awal" alih-alih form login biasa.
        window.addEventListener('localapp-ready', (e) => {
            if (e.detail && e.detail.needsSetup) {
                document.getElementById('login-mode-wrap').classList.add('hidden');
                document.getElementById('setup-mode-wrap').classList.remove('hidden');
                document.getElementById('setup-nama-toko').focus();
            }
        });

        function showSetupError(message) {
            const errBox = document.getElementById('setup-error-alert');
            document.getElementById('setup-error-msg').innerText = message;
            errBox.classList.remove('hidden');
            errBox.classList.add('flex');

            const form = document.getElementById('setup-form');
            form.animate([
                { transform: 'translateX(0)' },
                { transform: 'translateX(-5px)' },
                { transform: 'translateX(5px)' },
                { transform: 'translateX(-5px)' },
                { transform: 'translateX(0)' }
            ], { duration: 300, iterations: 1 });

            if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
        }

        function hideSetupError() {
            document.getElementById('setup-error-alert').classList.add('hidden');
            document.getElementById('setup-error-alert').classList.remove('flex');
        }

        async function handleSetup(e) {
            e.preventDefault();
            hideSetupError();

            const namaToko = document.getElementById('setup-nama-toko').value.trim();
            const namaLengkap = document.getElementById('setup-nama-lengkap').value.trim();
            const username = document.getElementById('setup-username').value.trim();
            const password = document.getElementById('setup-password').value;
            const passwordConfirm = document.getElementById('setup-password-confirm').value;

            if (password !== passwordConfirm) {
                showSetupError('Kata sandi dan ulangi kata sandi tidak sama');
                return;
            }
            if (password.length < 6) {
                showSetupError('Kata sandi minimal 6 karakter');
                return;
            }

            const btn = document.getElementById('setup-btn-submit');
            const btnText = document.getElementById('setup-btn-text');
            const btnIcon = document.getElementById('setup-btn-icon');
            const btnLoader = document.getElementById('setup-btn-loader');

            btn.disabled = true;
            btn.classList.add('bg-blue-700');
            btnText.style.opacity = '0';
            btnIcon.style.opacity = '0';
            btnLoader.classList.remove('hidden');
            btnLoader.style.display = ''; // lepas pengaman inline display:none (lihat login.html)

            try {
                // Dibelokkan oleh fetch-shim.js ke database lokal di HP ini,
                // sama seperti /api/auth/login — tidak ada request jaringan.
                const res = await fetch(`${API_BASE}/api/auth/setup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        nama_toko: namaToko,
                        nama_lengkap: namaLengkap,
                        username,
                        password,
                    })
                });

                let data;
                try {
                    data = await res.json();
                } catch {
                    throw new Error('Terjadi kesalahan. Coba lagi.');
                }

                if (!res.ok || !data.success) {
                    throw new Error(data.error || 'Gagal menyimpan setup awal');
                }

                sessionStorage.setItem('kasir_user', JSON.stringify(data.user));

                if (navigator.vibrate) navigator.vibrate([30, 50, 30]);

                btn.classList.replace('bg-blue-700', 'bg-green-500');
                btnLoader.classList.replace('fa-spinner', 'fa-check');
                btnLoader.classList.remove('fa-spin');

                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 500);

            } catch (err) {
                showSetupError(err.message || 'Gagal menyimpan setup awal');
                btn.disabled = false;
                btn.classList.remove('bg-blue-700');
                btnText.style.opacity = '1';
                btnIcon.style.opacity = '1';
                btnLoader.classList.add('hidden');
            }
        }
