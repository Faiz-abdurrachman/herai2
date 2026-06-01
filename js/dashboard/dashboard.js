/* ==========================================================================
   js/dashboard.js
   Logic untuk Data Sorcerers Admin Panel (Elegant Clean Theme)
   Terintegrasi dengan Google Apps Script, SPA Routing & Dynamic Quota
   ========================================================================== */

   const SCRIPT_URL = '/__gas';
   let participantsData = [];
   let filteredParticipantsData = [];
   let currentPage = 1;
   let pageSize = 25;
   
   // ==========================================
   // FUNGSI INISIALISASI (Dipanggil oleh router.js)
   // ==========================================
   // Wajib pakai async karena nunggu sidebar di-load
   window.initDashboardLogic = async function() {
       console.log('🔵 Elegant Dashboard Logic Initialized');
   
       // 1. Load Sidebar Component First (Jika loadSidebar tersedia di main.js)
       if (typeof window.loadSidebar === 'function') {
           await window.loadSidebar('nav-overview');
       }

       if (!['#/dashboard', '#/dashboard/seleksi'].includes(window.location.hash)) return;
       
       // 2. DOM Elements Utama Dashboard
       const searchInput = document.getElementById('searchInput');
       const tableBody = document.getElementById('tableBody');
       const filterJalur = document.getElementById('filterJalur');
       const filterStatus = document.getElementById('filterStatus');
       const filterBackground = document.getElementById('filterBackground');
       const pageSizeSelect = document.getElementById('pageSizeSelect');
       const btnSync = document.getElementById('btnSync');
       
       // --- FITUR BARU: LOGIKA NAVIGASI SIDEBAR (SPA SAFE) ---
       // Karena sidebar mungkin baru di-inject, kita ambil elemennya *setelah* loadSidebar
       const navLinks = document.querySelectorAll('.nav-link');
       const sections = document.querySelectorAll('.dashboard-section');
       const pageTitle = document.getElementById('dynamicPageTitle');
       const pageSubtitle = document.getElementById('dynamicPageSubtitle');
   
       navLinks.forEach(link => {
           // Hapus listener lama jika ada, lalu pasang yang baru
           link.replaceWith(link.cloneNode(true));
       });
       
       // Ambil ulang navLinks setelah di-clone
       const freshNavLinks = document.querySelectorAll('.nav-link');
       const initialDashboardMode = window.location.hash === '#/dashboard/seleksi' ? 'seleksi' : 'overview';
   
       freshNavLinks.forEach(link => {
           link.addEventListener('click', function(e) {
               const targetId = this.id;
   
               // PENGECUALIAN SPA: Biarkan browser pindah halaman kalau klik menu ini.
               // Menu-menu ini mengarah ke rute hash yang berbeda (bukan internal dashboard).
               if (
                   this.classList.contains('logout-btn') || 
                   targetId === 'nav-skoring' ||
                   targetId === 'nav-ai' ||
                   targetId === 'nav-fraud' ||
                   targetId === 'nav-comm' ||
                   targetId === 'nav-asset' ||
                   targetId === 'nav-video-conference' ||
                   targetId === 'nav-stage' ||
                   targetId === 'nav-competency' ||
                   targetId === 'nav-retest' ||
                   targetId === 'nav-bootcamp' ||
                   targetId === 'nav-final-project' ||
                   targetId === 'nav-certificates' ||
                   targetId === 'nav-settings' ||
                   targetId === 'nav-audit' ||
                   targetId === 'nav-rbac'
               ) {
                   return; // Jangan ditahan, biarkan router SPA bekerja
               }
   
               // Jika klik pada Overview atau Seleksi Tahap 1 (internal dashboard)
               e.preventDefault();
   
               // Ubah class active di sidebar
               freshNavLinks.forEach(l => l.classList.remove('active'));
               this.classList.add('active');
   
               // Sembunyikan semua section internal (Reset)
               sections.forEach(sec => sec.style.display = 'none');
   
               // Tampilkan section yang sesuai dan ubah Header
               if (targetId === 'nav-overview') {
                   window.location.hash = '#/dashboard';
                   const secOverview = document.getElementById('section-overview');
                   if(secOverview) secOverview.style.display = 'block';
                   if(pageTitle) pageTitle.innerText = 'System Overview';
                   if(pageSubtitle) pageSubtitle.innerText = 'Pusat kendali operasional HerAI Fellowship 2026';
               } else if (targetId === 'nav-seleksi') {
                   window.location.hash = '#/dashboard/seleksi';
                   const secSeleksi = document.getElementById('section-seleksi');
                   if(secSeleksi) secSeleksi.style.display = 'block';
                   if(pageTitle) pageTitle.innerText = 'Seleksi Peserta Tahap 1';
                   if(pageSubtitle) pageSubtitle.innerText = 'Monitoring dan kurasi pendaftar Woman in Tech 2026';
               }
           });
       });
       if (initialDashboardMode === 'seleksi') {
           const overviewLink = document.getElementById('nav-overview');
           const seleksiLink = document.getElementById('nav-seleksi');
           freshNavLinks.forEach(l => l.classList.remove('active'));
           if (seleksiLink) seleksiLink.classList.add('active');
           const secOverview = document.getElementById('section-overview');
           const secSeleksi = document.getElementById('section-seleksi');
           if (secOverview) secOverview.style.display = 'none';
           if (secSeleksi) secSeleksi.style.display = 'block';
           if (pageTitle) pageTitle.innerText = 'Seleksi Peserta Tahap 1';
           if (pageSubtitle) pageSubtitle.innerText = 'Monitoring dan kurasi pendaftar Woman in Tech 2026';
           if (overviewLink) overviewLink.classList.remove('active');
       }
       // -------------------------------------------
   
       if (!searchInput || !tableBody || !filterJalur || !filterStatus || !filterBackground || !pageSizeSelect || !btnSync) {
           console.error('❌ Elemen Data Tabel tidak ditemukan!');
           return; 
       }
   
       // Clone elemen untuk reset event listeners (mencegah memory leak SPA saat bolak-balik halaman)
       const newSearchInput = searchInput.cloneNode(true);
       searchInput.parentNode.replaceChild(newSearchInput, searchInput);
       
       const newFilterJalur = filterJalur.cloneNode(true);
       filterJalur.parentNode.replaceChild(newFilterJalur, filterJalur);
       
       const newFilterStatus = filterStatus.cloneNode(true);
       filterStatus.parentNode.replaceChild(newFilterStatus, filterStatus);

       const newFilterBackground = filterBackground.cloneNode(true);
       filterBackground.parentNode.replaceChild(newFilterBackground, filterBackground);

       const newPageSizeSelect = pageSizeSelect.cloneNode(true);
       pageSizeSelect.parentNode.replaceChild(newPageSizeSelect, pageSizeSelect);
       
       const newBtnSync = btnSync.cloneNode(true);
       btnSync.parentNode.replaceChild(newBtnSync, btnSync);
   
       // Attach Event Listeners Pencarian & Filter
       newSearchInput.addEventListener('input', () => {
           currentPage = 1;
           filterData();
       });
       newFilterJalur.addEventListener('change', () => {
           currentPage = 1;
           filterData();
       });
       newFilterStatus.addEventListener('change', () => {
           currentPage = 1;
           filterData();
       });
       newFilterBackground.addEventListener('change', () => {
           currentPage = 1;
           filterData();
       });
       newPageSizeSelect.addEventListener('change', () => {
           pageSize = Number(newPageSizeSelect.value) || 25;
           currentPage = 1;
           renderTable(filteredParticipantsData);
       });
       newBtnSync.addEventListener('click', fetchData);

       const btnPrevPage = document.getElementById('btnPrevPage');
       const btnNextPage = document.getElementById('btnNextPage');
       if (btnPrevPage) {
           btnPrevPage.onclick = () => {
               if (currentPage > 1) {
                   currentPage -= 1;
                   renderTable(filteredParticipantsData);
               }
           };
       }
       if (btnNextPage) {
           btnNextPage.onclick = () => {
               const totalPages = Math.max(1, Math.ceil(filteredParticipantsData.length / pageSize));
               if (currentPage < totalPages) {
                   currentPage += 1;
                   renderTable(filteredParticipantsData);
               }
           };
       }
   
       // Event Delegation untuk Tombol Detail di dalam Tabel
       const newTableBody = document.getElementById('tableBody');
       // Hapus listener lama jika ada
       newTableBody.replaceWith(newTableBody.cloneNode(true));
       const freshTableBody = document.getElementById('tableBody');
       
       freshTableBody.addEventListener('click', function(e) {
           const btnView = e.target.closest('.btn-detail'); 
           if (btnView) {
               const rowId = parseInt(btnView.getAttribute('data-id'));
               viewDetail(rowId);
           }
       });
   
       // Event Listener Tutup Modal Detail
       const btnCloseModal = document.getElementById('btnCloseModal');
       if (btnCloseModal) {
           const newBtnCloseModal = btnCloseModal.cloneNode(true);
           btnCloseModal.parentNode.replaceChild(newBtnCloseModal, btnCloseModal);
           newBtnCloseModal.addEventListener('click', () => {
               document.getElementById('detailModal').classList.remove('active');
               document.body.style.overflow = 'auto';
           });
       }

       const detailModal = document.getElementById('detailModal');
       if (detailModal) {
           const freshDetailModal = detailModal.cloneNode(true);
           detailModal.parentNode.replaceChild(freshDetailModal, detailModal);
           const closeBtn = freshDetailModal.querySelector('#btnCloseModal');
           closeBtn?.addEventListener('click', () => {
               freshDetailModal.classList.remove('active');
               document.body.style.overflow = 'auto';
           });
           freshDetailModal.addEventListener('click', (event) => {
               if (event.target === freshDetailModal) {
                   freshDetailModal.classList.remove('active');
                   document.body.style.overflow = 'auto';
               }
           });
       }
   
       // Cek status sesi login admin
       checkLoginStatus();
   };
   
   // ==========================================
   // 1. SISTEM AUTENTIKASI (LOGIN OVERLAY)
   // ==========================================
   function checkLoginStatus() {
       if (!sessionStorage.getItem('isAdminLoggedIn')) {
           createLoginOverlay();
       } else {
           fetchData();
       }
   }
   
   function createLoginOverlay() {
       const existingOverlay = document.getElementById('loginOverlay');
       if (existingOverlay) existingOverlay.remove();
   
       const overlay = document.createElement('div');
       overlay.id = 'loginOverlay';
       overlay.style.cssText = `
           position: fixed; top: 0; left: 0; width: 100%; height: 100%;
           background: rgba(248, 249, 255, 0.8); z-index: 9999;
           display: flex; align-items: center; justify-content: center;
           backdrop-filter: blur(10px);
       `;
   
       overlay.innerHTML = `
           <div class="glass-panel" style="padding: 40px; width: 90%; max-width: 400px; text-align: center; background: #fff; border-radius: 24px; box-shadow: 0 20px 50px rgba(0,0,0,0.1);">
               <div style="margin-bottom: 30px;">
                   <h2 style="color: var(--dark-purple); font-size: 2.5rem; font-family: 'Space Grotesk', sans-serif; margin: 0; font-weight: 800;">W<span style="color: var(--primary-pink);">IT</span></h2>
                   <p style="color: var(--text-muted); font-size: 0.95rem; margin-top: 5px; font-weight: 600;">Data Sorcerers Security</p>
               </div>
               <form id="loginForm" style="display: flex; flex-direction: column; gap: 20px;">
                   <div style="position: relative;">
                       <i class="fas fa-user-shield" style="position: absolute; left: 15px; top: 16px; color: var(--text-muted);"></i>
                       <input type="text" id="adminId" placeholder="ID Admin" required 
                              style="width: 100%; padding: 15px 15px 15px 45px; border: 1px solid var(--gray-border); border-radius: 12px; outline: none; background: #fafbfe; color: var(--text-dark); box-sizing: border-box; font-family: 'Inter', sans-serif;">
                   </div>
                   <div style="position: relative;">
                       <i class="fas fa-key" style="position: absolute; left: 15px; top: 16px; color: var(--text-muted);"></i>
                       <input type="password" id="adminPass" placeholder="Password" required 
                              style="width: 100%; padding: 15px 15px 15px 45px; border: 1px solid var(--gray-border); border-radius: 12px; outline: none; background: #fafbfe; color: var(--text-dark); box-sizing: border-box; font-family: 'Inter', sans-serif;">
                   </div>
                   <button type="submit" id="btnLogin" class="btn-cyber" style="width: 100%; justify-content: center; padding: 15px; margin-top: 10px; font-size: 1rem;">
                       <i class="fas fa-lock"></i> Authenticate
                   </button>
               </form>
               <p id="loginError" style="color: var(--danger); font-size: 0.85rem; margin-top: 15px; display: none; font-weight: 600;"></p>
           </div>
       `;
       
       document.body.appendChild(overlay);
   
       document.getElementById('loginForm').addEventListener('submit', async (e) => {
           e.preventDefault();
           const btn = document.getElementById('btnLogin');
           const err = document.getElementById('loginError');
           
           btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Verifying...';
           btn.disabled = true;
           err.style.display = 'none';
   
           const adminContext = typeof window.getAdminSystemContext === 'function'
               ? await window.getAdminSystemContext()
               : { device: navigator.userAgent, lokasi: 'Unknown Location' };

           const payload = {
               action: 'login',
               id_admin: document.getElementById('adminId').value,
               password: document.getElementById('adminPass').value,
               perangkat: adminContext.device,
               device: adminContext.device,
               lokasi: adminContext.lokasi
           };
   
           try {
               const response = await fetch(SCRIPT_URL, {
                   method: 'POST',
                   headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                   body: JSON.stringify(payload)
               });
               const result = await response.json();
   
               if (result.status === 'success') {
                   sessionStorage.setItem('isAdminLoggedIn', 'true');
                   localStorage.setItem('adminId', payload.id_admin);
                   overlay.remove();
                   fetchData();
               } else {
                   throw new Error(result.message);
               }
           } catch (error) {
               err.textContent = error.message || "Gagal menghubungi server database.";
               err.style.display = 'block';
           } finally {
               btn.innerHTML = '<i class="fas fa-lock"></i> Authenticate';
               btn.disabled = false;
           }
       });
   }
   
   // ==========================================
   // 2. FETCH DATA DARI SPREADSHEET
   // ==========================================
   async function fetchData() {
       const tableBody = document.getElementById('tableBody');
       const btnSync = document.getElementById('btnSync');
       
       if (!tableBody || !btnSync) return;
       
       btnSync.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Syncing...';
       tableBody.innerHTML = `
           <tr class="loading-row">
               <td colspan="6" style="text-align: center; padding: 40px;">
                   <i class="fas fa-circle-notch fa-spin" style="font-size: 2rem; color: var(--primary-pink);"></i>
                   <p style="margin-top: 15px; color: var(--text-muted);">Mengambil data dari secure database...</p>
               </td>
           </tr>
       `;
   
       try {
           const payload = { action: 'getData' };
           const response = await fetch(SCRIPT_URL, {
               method: 'POST',
               headers: { 'Content-Type': 'text/plain;charset=utf-8' },
               body: JSON.stringify(payload)
           });
           
           const result = await response.json();
           
           if (result.status === 'success') {
               participantsData = result.data.reverse(); 
               filterData(); 
           } else {
               throw new Error(result.message);
           }
       } catch (error) {
           console.error(error);
           tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--danger); font-weight:600; padding:30px;">Gagal menarik data. Coba klik tombol Sync Data lagi.</td></tr>`;
       } finally {
           btnSync.innerHTML = '<i class="fas fa-sync-alt"></i> Sync Data';
       }
   }
   
   // ==========================================
   // 3. RENDER TABEL & STATISTIK
   // ==========================================
   function filterData() {
       const searchInput = document.getElementById('searchInput');
       const filterJalur = document.getElementById('filterJalur');
       const filterStatus = document.getElementById('filterStatus');
       const filterBackground = document.getElementById('filterBackground');
       const pageSizeSelect = document.getElementById('pageSizeSelect');
       
       if (!searchInput || !filterJalur || !filterStatus || !filterBackground) return;
       
       const searchTerm = searchInput.value.toLowerCase();
       const filterJalurValue = filterJalur.value;
       const filterStatusValue = filterStatus.value;
       const filterBackgroundValue = filterBackground.value;
       pageSize = pageSizeSelect ? Number(pageSizeSelect.value) || 25 : pageSize;
   
       filteredParticipantsData = participantsData.filter(p => {
           const nama = String(p.nama_lengkap || "").toLowerCase();
           const nik = String(p.nik || "");
           const jalur = String(p.jalur || "");
           const statusSeleksi = String(p.status_seleksi || "");
           const background = String(p.status_kerja || p.status || "").toLowerCase();
   
           const matchSearch = nama.includes(searchTerm) || nik.includes(searchTerm);
           const matchJalur = filterJalurValue === 'all' || jalur === filterJalurValue;
           const matchStatus = filterStatusValue === 'all' || statusSeleksi === filterStatusValue;
           const matchBackground = filterBackgroundValue === 'all' || background === filterBackgroundValue;
           return matchSearch && matchJalur && matchStatus && matchBackground;
       });
   
       const totalPages = Math.max(1, Math.ceil(filteredParticipantsData.length / pageSize));
       if (currentPage > totalPages) currentPage = totalPages;

       renderTable(filteredParticipantsData);
       updateStats(participantsData); 
   }
   
   function renderTable(dataToRender) {
       const tableBody = document.getElementById('tableBody');
       if (!tableBody) return;
       
       tableBody.innerHTML = '';
       const totalItems = dataToRender.length;
       const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
       if (currentPage > totalPages) currentPage = totalPages;
       const startIndex = (currentPage - 1) * pageSize;
       const visibleRows = dataToRender.slice(startIndex, startIndex + pageSize);
       
       if (totalItems === 0) {
           tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-muted);">Tidak ada data ditemukan.</td></tr>';
           updatePagination(0, 0, 0, 1, 1);
           return;
       }
   
       visibleRows.forEach(p => {
           const jalurSafe = String(p.jalur || "");
           const jalurStyle = jalurSafe === 'afirmasi' 
               ? 'background: var(--light-pink); color: var(--primary-pink);' 
               : 'background: rgba(138, 43, 226, 0.1); color: var(--icon-purple);';
           const jalurBadge = `<span style="padding: 4px 10px; border-radius: 6px; font-size:0.8rem; font-weight: 700; ${jalurStyle}">${jalurSafe === 'afirmasi' ? 'Afirmasi 3T' : 'Reguler'}</span>`;
           
           const statusKerjaSafe = String(p.status_kerja || "");
           const statusBgMap = { 'mahasiswa': 'Mahasiswa', 'fresh_graduate': 'Fresh Grad', 'profesional': 'Profesional', 'lainnya': 'Lainnya' };
           const statusKerjaText = statusBgMap[statusKerjaSafe] || statusKerjaSafe || "-";
           
           const statusSeleksiSafe = String(p.status_seleksi || "");
           let statusSeleksiBadge = '';
           if(statusSeleksiSafe === 'lolos') statusSeleksiBadge = '<span class="badge lolos"><i class="fas fa-check-circle"></i> Lolos</span>';
           else if(statusSeleksiSafe === 'gugur') statusSeleksiBadge = '<span class="badge gugur"><i class="fas fa-times-circle"></i> Gugur</span>';
           else statusSeleksiBadge = '<span class="badge pending"><i class="fas fa-clock"></i> Menunggu</span>';
   
           const daerahFull = p.alamat ? String(p.alamat) : "-";
           const daerahShort = daerahFull.split(',')[0].trim() || daerahFull;
   
           const tr = document.createElement('tr');
           tr.innerHTML = `
               <td data-label="NAMA & NIK">
                   <div class="candidate-identity">
                       <strong>${p.nama_lengkap || "-"}</strong>
                       <span>${maskNIK(String(p.nik || ""))}</span>
                   </div>
               </td>
               <td data-label="JALUR">${jalurBadge}</td>
               <td data-label="LATAR BELAKANG"><span style="font-weight: 600; font-size: 0.85rem; color: var(--text-dark);">${statusKerjaText}</span></td>
               <td data-label="ASAL DAERAH"><span class="area-cell" title="${escapeAttr(daerahFull)}">${daerahShort}</span></td>
               <td data-label="STATUS SELEKSI">${statusSeleksiBadge}</td>
               <td data-label="TINDAKAN">
                   <button class="btn-action btn-detail" data-id="${p.rowId}">
                       <i class="fas fa-eye"></i> Detail
                   </button>
               </td>
           `;
           tableBody.appendChild(tr);
       });

       updatePagination(startIndex + 1, startIndex + visibleRows.length, totalItems, currentPage, totalPages);
   }

   function updatePagination(start, end, total, page, totalPages) {
       const pageInfo = document.getElementById('tablePageInfo');
       const pageIndicator = document.getElementById('pageIndicator');
       const btnPrevPage = document.getElementById('btnPrevPage');
       const btnNextPage = document.getElementById('btnNextPage');

       if (pageInfo) {
           pageInfo.textContent = total === 0
               ? 'Menampilkan 0 data'
               : `Menampilkan ${start}-${end} dari ${total} data`;
       }
       if (pageIndicator) pageIndicator.textContent = `${page} / ${totalPages}`;
       if (btnPrevPage) btnPrevPage.disabled = page <= 1 || total === 0;
       if (btnNextPage) btnNextPage.disabled = page >= totalPages || total === 0;
   }
   
   function updateStats(data) {
       // Perhitungan Lolos
       const lolosCount = data.filter(p => String(p.status_seleksi) === 'lolos').length;
   
       // Update Mini Cards di Seleksi
       const statTotal = document.getElementById('statTotal');
       const stat3T = document.getElementById('stat3T'); 
       const statMahasiswa = document.getElementById('statMahasiswa');
       const statLolos = document.getElementById('statLolos');
       
       if (statTotal) statTotal.innerText = data.length;
       if (stat3T) stat3T.innerText = data.filter(p => String(p.jalur) === 'afirmasi').length;
       if (statMahasiswa) statMahasiswa.innerText = data.filter(p => String(p.status_kerja) === 'mahasiswa' || String(p.status_kerja) === 'fresh_graduate').length;
       if (statLolos) statLolos.innerText = lolosCount;
   
       // --- FITUR BARU: UPDATE QUOTA VISUALIZER ---
       const maxQuota = 100;
       const currentQuotaElem = document.querySelector('.current-quota');
       const progressBar = document.querySelector('.progress-bar-glow');
       const quotaStatus = document.querySelector('.quota-status');
   
       if (currentQuotaElem && progressBar && quotaStatus) {
           currentQuotaElem.innerText = lolosCount;
           
           // Kalkulasi Persentase
           let percentage = (lolosCount / maxQuota) * 100;
           if (percentage > 100) percentage = 100; // Cegah bar jebol
           
           progressBar.style.width = percentage + '%';
   
           const sisaSlot = maxQuota - lolosCount;
           if (sisaSlot > 0) {
               quotaStatus.innerHTML = `${sisaSlot} slot tersisa. Proses seleksi Tahap 1 sedang berlangsung.`;
               quotaStatus.style.color = 'var(--success)';
           } else {
               quotaStatus.innerHTML = `Kuota terpenuhi! 100 peserta hebat telah terpilih.`;
               quotaStatus.style.color = 'var(--primary-pink)';
           }
       }
   }
   
   // ==========================================
   // 4. FUNGSI ENKRIPSI (MASKING) NIK
   // ==========================================
   function maskNIK(nik) {
       if (!nik || nik.length < 16) return String(nik || "-");
       return nik.substring(0, 6) + '******' + nik.substring(12);
   }

   function escapeAttr(value) {
       return String(value || "")
           .replace(/&/g, "&amp;")
           .replace(/"/g, "&quot;")
           .replace(/</g, "&lt;")
           .replace(/>/g, "&gt;");
   }

   function getNikOrigin(nik) {
       const provinceCode = String(nik || "").replace(/\D/g, "").slice(0, 2);
       const provinces = {
           11: 'Aceh', 12: 'Sumatera Utara', 13: 'Sumatera Barat', 14: 'Riau',
           15: 'Jambi', 16: 'Sumatera Selatan', 17: 'Bengkulu', 18: 'Lampung',
           19: 'Bangka Belitung', 21: 'Kepulauan Riau', 31: 'DKI Jakarta',
           32: 'Jawa Barat', 33: 'Jawa Tengah', 34: 'DI Yogyakarta',
           35: 'Jawa Timur', 36: 'Banten', 51: 'Bali',
           52: 'Nusa Tenggara Barat', 53: 'Nusa Tenggara Timur',
           61: 'Kalimantan Barat', 62: 'Kalimantan Tengah',
           63: 'Kalimantan Selatan', 64: 'Kalimantan Timur',
           65: 'Kalimantan Utara', 71: 'Sulawesi Utara',
           72: 'Sulawesi Tengah', 73: 'Sulawesi Selatan',
           74: 'Sulawesi Tenggara', 75: 'Gorontalo', 76: 'Sulawesi Barat',
           81: 'Maluku', 82: 'Maluku Utara', 91: 'Papua Barat',
           92: 'Papua Barat Daya', 93: 'Papua Selatan', 94: 'Papua',
           95: 'Papua Tengah', 96: 'Papua Pegunungan'
       };
       return provinces[provinceCode] || 'Belum terdeteksi';
   }
   
   // ==========================================
   // 5. MODAL DETAIL & KURASI PESERTA
   // ==========================================
   function getParticipantField(participant, ...keys) {
       for (const key of keys) {
           const value = participant?.[key];
           if (value !== undefined && value !== null && String(value).trim() !== '') return value;
       }
       return '';
   }

   function renderDetailField(label, value, options = {}) {
       const content = value !== undefined && value !== null && String(value).trim() !== '' ? value : '-';
       const whiteSpace = options.preWrap ? 'white-space: pre-wrap;' : '';
       return `
           <div style="margin-bottom: 15px;">
               <label style="color:var(--text-muted); font-size:0.8rem; text-transform:uppercase;">${label}</label>
               <p style="margin: 5px 0 0 0; color:var(--text-dark); font-size: 0.9rem; line-height: 1.55; ${whiteSpace}">${content}</p>
           </div>
       `;
   }

   function viewDetail(rowId) {
       const participant = participantsData.find(p => p.rowId === rowId);
       if(!participant) return;
   
       const modal = document.getElementById('detailModal');
       const modalBody = document.getElementById('modalBodyContent');
       const modalFooter = document.getElementById('modalFooterControls');
   
       const jalur = getParticipantField(participant, 'jalur', 'jalur_pendaftaran');
       const statusKerja = getParticipantField(participant, 'status_kerja', 'status');
       const univ = getParticipantField(participant, 'univ', 'universitas');
       const programStudi = getParticipantField(participant, 'program_studi', 'jurusan');
       const instansi = getParticipantField(participant, 'instansi', 'nama_instansi');
       const pengalamanKerja = getParticipantField(participant, 'pengalaman_kerja', 'peng_kerja');
       const organisasi = getParticipantField(participant, 'organisasi', 'pengalaman_organisasi');
       const cvLink = getParticipantField(participant, 'cv_link', 'link_cv');
       const safeJalur = String(jalur || "");
       const safeStatusKerja = String(statusKerja || "");
       const safeWA = String(participant.whatsapp || "");
       const cleanWA = safeWA.replace(/[^0-9]/g, '');
   
       let tglLahirDisplay = "-";
       if (participant.tanggal_lahir) {
           try {
               tglLahirDisplay = new Date(participant.tanggal_lahir).toLocaleDateString('id-ID');
               if (tglLahirDisplay === "Invalid Date") tglLahirDisplay = participant.tanggal_lahir;
           } catch (e) {
               tglLahirDisplay = participant.tanggal_lahir;
           }
       }
   
       const backgroundHTML = [
           renderDetailField('Status', statusKerja),
           renderDetailField('Asal Universitas / Kampus', univ),
           renderDetailField('Program Studi / Jurusan', programStudi),
           renderDetailField('Instansi / Perusahaan', instansi),
           renderDetailField('Posisi / Jabatan', participant.posisi),
           renderDetailField('Deskripsi Pekerjaan', pengalamanKerja, { preWrap: true })
       ].join('');
   
       modalBody.innerHTML = `
           <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 25px;">
               <div>
                   <h3 style="color:var(--dark-purple); font-family:'Space Grotesk', sans-serif; font-size: 1.6rem; margin: 0 0 5px 0; font-weight: 800;">${participant.nama_lengkap || "-"}</h3>
                   <div style="color:var(--text-muted); font-family:monospace; font-weight: 600;">${maskNIK(String(participant.nik))}</div>
                   <div style="color:var(--text-muted); font-size:0.85rem; margin-top:6px;"><i class="fas fa-map-marker-alt"></i> Asal NIK: ${getNikOrigin(participant.nik)}</div>
               </div>
               <span style="background: ${safeJalur === 'afirmasi' ? 'var(--light-pink)' : 'rgba(138, 43, 226, 0.1)'}; color: ${safeJalur === 'afirmasi' ? 'var(--primary-pink)' : 'var(--icon-purple)'}; padding: 6px 12px; border-radius: 8px; font-size:0.85rem; font-weight:bold;">${safeJalur === 'afirmasi' ? 'JALUR AFIRMASI 3T' : 'JALUR REGULER'}</span>
           </div>
   
           <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; background: #fafbfe; padding: 20px; border-radius: 12px; border: 1px solid var(--gray-border);">
               <div>
                   <label style="color:var(--text-muted); font-size:0.8rem; text-transform:uppercase;">Tempat, Tanggal Lahir</label>
                   <p style="margin: 5px 0 0 0; color:var(--dark-purple); font-weight:600;">${participant.tempat_lahir || "-"}, ${tglLahirDisplay}</p>
               </div>
               <div>
                   <label style="color:var(--text-muted); font-size:0.8rem; text-transform:uppercase;">Alamat Domisili</label>
                   <p style="margin: 5px 0 0 0; color:var(--dark-purple); font-weight:600; font-size: 0.9rem;">${participant.alamat || "-"}</p>
               </div>
               <div>
                   <label style="color:var(--text-muted); font-size:0.8rem; text-transform:uppercase;">WhatsApp</label>
                   <p style="margin: 5px 0 0 0;"><a href="https://wa.me/${cleanWA}" target="_blank" style="color:var(--success); text-decoration:none; font-weight:600;"><i class="fab fa-whatsapp"></i> ${safeWA || "-"}</a></p>
               </div>
               <div>
                   <label style="color:var(--text-muted); font-size:0.8rem; text-transform:uppercase;">Email</label>
                   <p style="margin: 5px 0 0 0; color:var(--dark-purple); font-weight:600; font-size: 0.9rem;">${participant.email || "-"}</p>
               </div>
           </div>
   
           <h4 style="color:var(--dark-purple); border-bottom: 2px solid var(--gray-border); padding-bottom: 8px; margin-bottom: 20px;">Latar Belakang (${safeStatusKerja ? safeStatusKerja.replace('_', ' ').toUpperCase() : 'PESERTA'})</h4>
           <div style="margin-bottom: 30px;">
               ${backgroundHTML}
           </div>
   
           <h4 style="color:var(--dark-purple); border-bottom: 2px solid var(--gray-border); padding-bottom: 8px; margin-bottom: 20px;">Organisasi & Prestasi</h4>
           <div style="margin-bottom: 30px;">
               <div style="margin-bottom: 15px;">
                   <label style="color:var(--text-muted); font-size:0.8rem; text-transform:uppercase;">Kejuaraan</label>
                   <p style="margin: 5px 0 0 0; color:var(--text-dark); font-size: 0.9rem; white-space: pre-wrap;">${participant.kejuaraan || "-"}</p>
               </div>
               <div style="margin-bottom: 15px;">
                   <label style="color:var(--text-muted); font-size:0.8rem; text-transform:uppercase;">Organisasi</label>
                   <p style="margin: 5px 0 0 0; color:var(--text-dark); font-size: 0.9rem; white-space: pre-wrap;">${organisasi || "-"}</p>
               </div>
               ${cvLink ? `<a href="${cvLink}" target="_blank" style="display:inline-block; margin-top:10px; color:var(--icon-blue); font-weight:600; text-decoration:none;"><i class="fas fa-external-link-alt"></i> Buka Link Portofolio</a>` : ''}
           </div>
   
           <h4 style="color:var(--dark-purple); border-bottom: 2px solid var(--gray-border); padding-bottom: 8px; margin-bottom: 20px;">Review Essay</h4>
           <div style="background: #fff; border: 1px solid var(--gray-border); border-radius: 12px; padding: 20px;">
               <p style="color:var(--dark-purple); font-weight:600; font-size:0.9rem; margin:0 0 5px 0;">1. Tell us about yourself!</p>
               <p style="color:var(--text-dark); font-size:0.9rem; margin-bottom: 20px; line-height: 1.6;">${participant.essay_1 || participant.essay1 || "-"}</p>
               
               <p style="color:var(--dark-purple); font-weight:600; font-size:0.9rem; margin:0 0 5px 0;">2. Why you choose this program?</p>
               <p style="color:var(--text-dark); font-size:0.9rem; margin-bottom: 20px; line-height: 1.6;">${participant.essay_2 || participant.essay2 || "-"}</p>
  
               <p style="color:var(--dark-purple); font-weight:600; font-size:0.9rem; margin:0 0 5px 0;">3. How this program can help your future career?</p>
               <p style="color:var(--text-dark); font-size:0.9rem; margin-bottom: 20px; line-height: 1.6;">${participant.essay_3 || participant.essay3 || "-"}</p>
  
               <p style="color:var(--dark-purple); font-weight:600; font-size:0.9rem; margin:0 0 5px 0;">4. What you expect to join this program?</p>
               <p style="color:var(--text-dark); font-size:0.9rem; margin-bottom: 20px; line-height: 1.6;">${participant.essay_4 || participant.essay4 || "-"}</p>
  
               <p style="color:var(--dark-purple); font-weight:600; font-size:0.9rem; margin:0 0 5px 0;">5. What makes you outstanding?</p>
               <p style="color:var(--text-dark); font-size:0.9rem; margin-bottom: 0; line-height: 1.6;">${participant.essay_5 || participant.essay5 || "-"}</p>
           </div>
       `;
   
       modalFooter.innerHTML = `
           <span style="margin-right: auto; font-size: 0.9rem; color: var(--text-muted); display:flex; align-items:center;">
               Status Seleksi:&nbsp; <strong style="text-transform: uppercase; color: var(--dark-purple);">${participant.status_seleksi || "PENDING"}</strong>
           </span>
           <button class="btn-reject" onclick="updateStatus(${participant.rowId}, 'gugur')">
               <i class="fas fa-times"></i> Tandai Gugur
           </button>
           <button class="btn-accept" onclick="updateStatus(${participant.rowId}, 'lolos')">
               <i class="fas fa-check"></i> Loloskan
           </button>
       `;
   
       modal.classList.add('active');
       document.body.style.overflow = 'hidden';
   }
   
   // ==========================================
   // 6. CUSTOM CONFIRMATION MODAL LOGIC
   // ==========================================
   function showConfirmDialog(newStatus) {
       return new Promise((resolve) => {
           const modal = document.getElementById('confirmModal');
           const btnCancel = document.getElementById('btnCancelConfirm');
           const btnProceed = document.getElementById('btnProceedConfirm');
           const confirmMessage = document.getElementById('confirmMessage');
           const confirmIcon = document.getElementById('confirmIcon');
   
           if (newStatus === 'lolos') {
               confirmMessage.innerHTML = `Apakah Anda yakin ingin menetapkan kandidat ini sebagai peserta <strong style="color: var(--success);">LOLOS</strong> tahap administrasi?`;
               confirmIcon.innerHTML = '<i class="fas fa-check-circle" style="color: var(--success);"></i>';
               confirmIcon.style.background = 'rgba(5, 205, 153, 0.1)';
               btnProceed.style.background = 'var(--success)';
               btnProceed.style.borderColor = 'var(--success)';
               btnProceed.style.color = '#fff';
           } else {
               confirmMessage.innerHTML = `Apakah Anda yakin ingin menandai kandidat ini <strong style="color: var(--danger);">GUGUR</strong> dari proses seleksi?`;
               confirmIcon.innerHTML = '<i class="fas fa-times-circle" style="color: var(--danger);"></i>';
               confirmIcon.style.background = 'rgba(230, 57, 70, 0.1)';
               btnProceed.style.background = 'var(--danger)';
               btnProceed.style.borderColor = 'var(--danger)';
               btnProceed.style.color = '#fff';
           }
   
           modal.classList.add('active');
   
           const onProceed = () => { cleanup(); resolve(true); };
           const onCancel = () => { cleanup(); resolve(false); };
   
           btnProceed.addEventListener('click', onProceed);
           btnCancel.addEventListener('click', onCancel);
   
           function cleanup() {
               modal.classList.remove('active');
               btnProceed.removeEventListener('click', onProceed);
               btnCancel.removeEventListener('click', onCancel);
           }
       });
   }
   
   // ==========================================
   // 7. UPDATE STATUS (LOLOS/GUGUR KE GOOGLE SCRIPT)
   // ==========================================
   window.updateStatus = async function(rowId, newStatus) {
       const isConfirm = await showConfirmDialog(newStatus);
       if(!isConfirm) return;
   
       document.getElementById('detailModal').classList.remove('active');
       document.body.style.overflow = 'auto';
       
       const btnSync = document.getElementById('btnSync');
       if (!btnSync) return;
       
       const originalText = btnSync.innerHTML;
       btnSync.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Updating DB...';
       btnSync.disabled = true;
       
       // Update data lokal sementara (Optimistic UI)
       const index = participantsData.findIndex(p => p.rowId === rowId);
       if(index !== -1) {
           participantsData[index].status_seleksi = newStatus;
           filterData();
       }
   
       try {
           const payload = {
               action: 'updateStatus',
               rowId: rowId,
               newStatus: newStatus
           };
   
           const response = await fetch(SCRIPT_URL, {
               method: 'POST',
               headers: { 'Content-Type': 'text/plain;charset=utf-8' },
               body: JSON.stringify(payload)
           });
           
           const result = await response.json();
           if (result.status !== 'success') throw new Error("Gagal mengupdate ke database");
           
       } catch (error) {
           alert('Gagal mengupdate status ke server Google Sheets. Memuat ulang data...');
           console.error(error);
           fetchData(); // Rollback kalau gagal
       } finally {
           btnSync.innerHTML = originalText;
           btnSync.disabled = false;
       }
   };
