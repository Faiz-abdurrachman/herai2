/**
 * js/router.js
 * METODE FINAL: HASH ROUTING (ANTI BLANK & ANTI 404)
 * Otak Utama Sistem Single Page Application (SPA) HerAI Fellowship
 */

const router = {
    // ==========================================
    // 1. Peta Rute (URL Hash -> Lokasi File HTML)
    // Wajib pakai '/' di depan path folder agar terbaca absolut dari root
    // ==========================================
    routes: {
        "/": "/pages/frontend/home.html",
        "/home": "/pages/frontend/home.html",
        "/projects": "/pages/frontend/projects.html",
        "/announcement": "/pages/frontend/announcement.html",
        "/announcement-stage-1": "/pages/frontend/announcement.html",
        "/announcement-stage-2": "/pages/frontend/announcement.html",
        "/announcement-final": "/pages/frontend/announcement.html",
        "/wall-of-fame": "/pages/frontend/wall-of-fame.html",
        "/leaderboard": "/pages/frontend/leaderboard.html",
        "/graduation": "/pages/frontend/graduation.html",
        "/register": "/pages/frontend/register.html",
        "/profile": "/pages/frontend/profile.html",
        "/meeting": "/pages/frontend/meeting.html",
        "/competency-test": "/pages/frontend/competency-test.html",
        "/retest": "/pages/frontend/retest.html",
        "/dashboard": "/pages/dashboard/dashboard.html",
        "/dashboard/seleksi": "/pages/dashboard/dashboard.html",
        "/twibbon": "/pages/frontend/twibbon.html",
        "/about-us": "/pages/frontend/about-us.html",
        "/curriculum": "/pages/frontend/curriculum.html",
        "/faq": "/pages/frontend/faq.html",
        "/industry-applications": "/pages/frontend/industry-applications.html",
        "/skoring": "/pages/dashboard/skoring.html",
        "/ai-prescreening": "/pages/dashboard/ai-prescreening.html",
        "/anti-fraud": "/pages/dashboard/anti-fraud.html",
        "/comm-engine": "/pages/dashboard/comm-engine.html",
        "/competency-monitor": "/pages/dashboard/competency-monitor.html",
        "/retest-monitor": "/pages/dashboard/retest-monitor.html",
        "/video-conference": "/pages/dashboard/video-conference.html",
        "/stage-control": "/pages/dashboard/stage-control.html",
        "/bootcamp": "/pages/dashboard/bootcamp.html",
        "/final-project": "/pages/dashboard/final-project.html",
        "/certificates": "/pages/dashboard/certificates.html",
        "/audit-trail": "/pages/dashboard/audit-trail.html",
        "/global-settings": "/pages/dashboard/global-settings.html", 
        "/rbac": "/pages/dashboard/rbac.html",
        "/assets": "/pages/dashboard/assets.html" 
    },

    routeAliases: {
        "/x/h4a9d2": "/home",
        "/x/p8c3q1": "/projects",
        "/x/a7n5s2": "/announcement",
        "/x/a7n5s2/s1": "/announcement-stage-1",
        "/x/a7n5s2/s2": "/announcement-stage-2",
        "/x/a7n5s2/sf": "/announcement-final",
        "/x/w2f8m4": "/wall-of-fame",
        "/x/l6b9r3": "/leaderboard",
        "/x/g5d1u7": "/graduation",
        "/x/r9k2e4": "/register",
        "/x/u3p7v5": "/profile",
        "/x/m7k9p2": "/meeting",
        "/x/t4c8n6": "/competency-test",
        "/x/rt4s8": "/retest",
        "/x/d8s2h5": "/dashboard",
        "/x/d8s2h5/s1": "/dashboard/seleksi",
        "/x/tw5b1": "/twibbon",
        "/x/ab2u8": "/about-us",
        "/x/cu7r2": "/curriculum",
        "/x/fq3a6": "/faq",
        "/x/in9d4": "/industry-applications",
        "/x/sk4r8": "/skoring",
        "/x/ai2p6": "/ai-prescreening",
        "/x/fr7c1": "/anti-fraud",
        "/x/cm8e3": "/comm-engine",
        "/x/ct6m2": "/competency-monitor",
        "/x/rtm6q": "/retest-monitor",
        "/x/vc4o9": "/video-conference",
        "/x/sc1t5": "/stage-control",
        "/x/bc9p3": "/bootcamp",
        "/x/fp5j7": "/final-project",
        "/x/cr2t8": "/certificates",
        "/x/at6l4": "/audit-trail",
        "/x/gs3n9": "/global-settings",
        "/x/rb8a2": "/rbac",
        "/x/as4e6": "/assets"
    },

    currentPath: null,
    sidebarHtml: "",

    // ==========================================
    // 2. Fungsi Memuat Komponen Statis (Navbar & Footer)
    // ==========================================
    async loadComponents() {
        try {
            const [navResponse, footerResponse, sidebarResponse] = await Promise.all([
                fetch("/components/navbar.html"),
                fetch("/components/footer.html"),
                fetch("/components/sidebar.html")
            ]);

            if (navResponse.ok) {
                document.getElementById("navbar-container").innerHTML = await navResponse.text();
            }
            if (footerResponse.ok) {
                document.getElementById("footer-container").innerHTML = await footerResponse.text();
            }
            if (sidebarResponse.ok) {
                this.sidebarHtml = await sidebarResponse.text();
                window.__HERAI_SIDEBAR_HTML__ = this.sidebarHtml;
            }

            // Eksekusi logika Navbar jika ada (dari js/main.js)
            if (typeof window.initNavbar === "function") {
                window.initNavbar();
            }
        } catch (error) {
            console.error("Gagal memuat komponen dasar:", error);
        }
    },

    hydrateAdminSidebar() {
        const sidebarContainer = document.getElementById("sidebar-container");
        if (!sidebarContainer) return;

        const html = window.__HERAI_SIDEBAR_HTML__ || this.sidebarHtml;
        if (html && sidebarContainer.innerHTML.trim() === "") {
            sidebarContainer.innerHTML = html;
        }

        if (typeof window.updateSidebarActiveState === "function") {
            window.updateSidebarActiveState();
        } else {
            const currentHash = window.location.hash || "#/dashboard";
            sidebarContainer.querySelectorAll("a").forEach(link => link.classList.remove("active"));
            const activeLink = sidebarContainer.querySelector(`a[href="${currentHash}"]`);
            if (activeLink) activeLink.classList.add("active");
        }
    },

    // ==========================================
    // 3. Fungsi Scroll ke Anchor (Untuk link seperti #about)
    // ==========================================
    scrollToHash(hashId) {
        setTimeout(() => {
            const target = document.querySelector(hashId);
            if (target) {
                const headerOffset = 90;
                const offsetPosition = target.getBoundingClientRect().top + window.pageYOffset - headerOffset;
                window.scrollTo({ top: offsetPosition, behavior: "smooth" });
            }
        }, 200);
    },

    // ==========================================
    // 4. Fungsi Utama Routing (Memuat Halaman)
    // ==========================================
    async handleRouting() {
        // Ambil path dari hash (Contoh: dari URL "http://web.com/#/dashboard" diambil "#/dashboard")
        let hash = window.location.hash;
        
        // Kalau web baru dibuka (tanpa hash) atau murni root, paksa arahkan ke #/home
        if (!hash || hash === "#" || hash === "#/") {
            window.location.hash = "#/home";
            return; 
        }

        // Hilangkan tanda '#' agar sesuai dengan peta rute di atas (menjadi "/dashboard")
        let path = hash.replace('#', '');
        const queryIndex = path.indexOf('?');
        if (queryIndex >= 0) {
            path = path.slice(0, queryIndex);
        }
        
        // Bersihkan ekstensi .html jika user mengetik manual
        if (path.includes('.html')) {
            path = path.replace('.html', '');
        }

        path = this.routeAliases[path] || path;

        const routeUrl = this.routes[path];
        const appContent = document.getElementById("app-content");
        const navContainer = document.getElementById("navbar-container");
        const footerContainer = document.getElementById("footer-container");
        const adminPages = [
            "/dashboard", 
            "/dashboard/seleksi", 
            "/skoring", 
            "/ai-prescreening", 
            "/anti-fraud", 
            "/comm-engine", 
            "/competency-monitor",
            "/retest-monitor",
            "/video-conference",
            "/stage-control",
            "/bootcamp",
            "/final-project",
            "/certificates",
            "/audit-trail", 
            "/global-settings", 
            "/rbac", 
            "/assets"
        ];

        try {
            // Jika rute tidak terdaftar di routes object
            if (!routeUrl) throw new Error("404");

            const globalSettings = typeof window.getGlobalSettingsAsync === "function"
                ? await window.getGlobalSettingsAsync()
                : (typeof window.getGlobalSettings === "function" ? window.getGlobalSettings() : {});
            if (typeof window.applyPublicVisibilitySettings === "function") {
                window.applyPublicVisibilitySettings(globalSettings);
            }
            if (globalSettings.maintenanceMode && !adminPages.includes(path)) {
                appContent.innerHTML = window.renderPublicNotice({
                    icon: "fa-screwdriver-wrench",
                    title: "Website Sedang Maintenance",
                    message: "HerAI Fellowship sedang melakukan pembaruan sistem. Silakan kembali lagi beberapa saat lagi.",
                    actionHref: "#/home",
                    actionLabel: "Cek Lagi Nanti"
                });
                if (navContainer) navContainer.style.display = "none";
                if (footerContainer) footerContainer.style.display = "none";
                this.currentPath = path;
                return;
            }

            if (path === "/profile" && globalSettings.participantPortalOpen !== true) {
                appContent.innerHTML = window.renderPublicNotice({
                    icon: "fa-user-lock",
                    title: "Portal Peserta Belum Dibuka",
                    message: "Login peserta akan tersedia setelah admin mengaktifkan Portal Profil Peserta.",
                    actionHref: "#/home",
                    actionLabel: "Kembali ke Beranda"
                });
                if (navContainer) navContainer.style.display = "block";
                if (footerContainer) footerContainer.style.display = "block";
                this.currentPath = path;
                return;
            }

            if (path === "/competency-test" && globalSettings.competencyTestOpen !== true) {
                appContent.innerHTML = window.renderPublicNotice({
                    icon: "fa-laptop-code",
                    title: "Tes Kompetensi Belum Dibuka",
                    message: "Seleksi Tahap 2 akan tersedia setelah panitia mengaktifkan fase Tes Kompetensi dari Stage Control.",
                    actionHref: "#/profile",
                    actionLabel: "Kembali ke Profil"
                });
                if (navContainer) navContainer.style.display = "block";
                if (footerContainer) footerContainer.style.display = "block";
                this.currentPath = path;
                return;
            }

            // Cek apakah perlu reload konten (hanya jika path berubah)
            if (this.currentPath !== path) {
                // Fetch file HTML-nya
                const response = await fetch(routeUrl);
                if (!response.ok) throw new Error("Gagal fetch file HTML");
                
                appContent.innerHTML = await response.text();
                this.currentPath = path;

                // ==========================================
                // LAYOUT MANAGEMENT: Atur Tampilan Navbar & Footer
                // ==========================================
                // Daftar SEMUA halaman Admin Panel yang NGGAK boleh ada Navbar/Footer Publik
                if (adminPages.includes(path)) {
                    if (navContainer) navContainer.style.display = "none";
                    if (footerContainer) footerContainer.style.display = "none";
                    this.hydrateAdminSidebar();
                } else {
                    if (navContainer) navContainer.style.display = "block";
                    if (footerContainer) footerContainer.style.display = "block";
                }

                // ==========================================
                // EKSEKUSI JAVASCRIPT KHUSUS HALAMAN
                // ==========================================
                
                // 1. Logika Register & Twibbon
                if (path === "/register" && typeof window.initRegisterLogic === "function") {
                    window.initRegisterLogic();
                } else if (path === "/profile" && typeof window.initParticipantProfile === "function") {
                    window.initParticipantProfile();
                } else if (path === "/competency-test" && typeof window.initCompetencyTest === "function") {
                    window.initCompetencyTest();
                } else if (path === "/retest" && typeof window.initCompetencyTest === "function") {
                    window.initCompetencyTest({ mode: "retest" });
                } else if (path === "/meeting" && typeof window.initMeetingRoom === "function") {
                    window.initMeetingRoom();
                } else if (path === "/projects" && typeof window.initProjectsPage === "function") {
                    window.initProjectsPage();
                } else if (path === "/twibbon" && typeof window.initTwibbon === "function") {
                    setTimeout(() => window.initTwibbon(), 100);
                }
                
                // 2. Logika Dashboard Utama & Skoring
                else if ((path === "/dashboard" || path === "/dashboard/seleksi") && typeof window.initDashboardLogic === "function") {
                    window.initDashboardLogic();
                } else if (path === "/skoring" && typeof window.initSkoringLogic === "function") {
                    window.initSkoringLogic();
                }
                
                // 3. Logika Sorcerers Intelligence
                else if (path === "/ai-prescreening" && typeof window.initAiPreScreening === "function") {
                    window.initAiPreScreening();
                } else if (path === "/anti-fraud" && typeof window.initAntiFraud === "function") {
                    window.initAntiFraud();
                }
                
                // 4. Logika Manajemen
                else if (path === "/comm-engine" && typeof window.initCommEngine === "function") {
                    window.initCommEngine();
                } else if (path === "/competency-monitor" && typeof window.initCompetencyMonitor === "function") {
                    window.initCompetencyMonitor();
                } else if (path === "/retest-monitor" && typeof window.initReTestMonitor === "function") {
                    window.initReTestMonitor();
                } else if (path === "/video-conference" && typeof window.initVideoConference === "function") {
                    window.initVideoConference();
                } else if (path === "/assets" && typeof window.initAssets === "function") {
                    window.initAssets();
                } else if (path === "/stage-control" && typeof window.initStageControl === "function") {
                    window.initStageControl();
                } else if (path === "/bootcamp" && typeof window.initBootcamp === "function") {
                    window.initBootcamp();
                } else if (path === "/final-project" && typeof window.initFinalProject === "function") {
                    window.initFinalProject();
                } else if (path === "/certificates" && typeof window.initCertificates === "function") {
                    window.initCertificates();
                }
                
                // 5. Logika System Admin
                else if (path === "/global-settings" && typeof window.initGlobalSettings === "function") {
                    window.initGlobalSettings();
                } else if (path === "/audit-trail" && typeof window.initAuditTrail === "function") {
                    window.initAuditTrail();
                } else if (path === "/rbac" && typeof window.initRbac === "function") {
                    window.initRbac();
                }
                
                // 6. Logika Pengumuman
                else if (path.startsWith("/announcement") && typeof window.initAnnouncement === "function") {
                    setTimeout(() => window.initAnnouncement(), 100);
                }

                // 7. Logika Interaksi Umum pada halaman publik (Selain Admin & Halaman Khusus)
                else if (!adminPages.includes(path) && typeof window.initPageInteractions === "function") {
                    window.initPageInteractions();
                }

            }

            // Halaman publik tetap mulai dari atas; halaman admin menjaga konteks panel samping.
            if (!adminPages.includes(path)) {
                window.scrollTo({ top: 0, behavior: 'instant' });
            }

        } catch (error) {
            console.error("Router Error:", error);
            // Tampilan Halaman 404 Fallback
            appContent.innerHTML = `
                <section style="min-height: 70vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; background-color: #fcfcfd;">
                    <h1 style="font-size: 6rem; color: #FF1493; margin-bottom: 0; font-family: 'Space Grotesk', sans-serif;">404</h1>
                    <h2 style="color: #1a0b2e; font-family: 'Space Grotesk', sans-serif;">Halaman Tidak Ditemukan</h2>
                    <p style="color: #6b7a90; max-width: 400px; margin-bottom: 20px;">Maaf, sepertinya Anda tersesat atau halaman yang dituju belum tersedia.</p>
                    <a href="#/home" style="background: #FF1493; color: white; padding: 12px 25px; border-radius: 50px; text-decoration: none; font-weight: bold;">Kembali ke Beranda</a>
                </section>
            `;
            this.currentPath = null;
        }
    }
};

// ==========================================
// 5. Inisialisasi & Event Listeners Global
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
    
    // 1. Load navbar & footer pertama kali
    await router.loadComponents();
    
    // 2. Jalankan routing saat web pertama kali dibuka
    router.handleRouting();

    // 3. TANGKAP SEMUA KLIK PADA LINK <a> (Event Delegation)
    document.body.addEventListener("click", e => {
        const link = e.target.closest("a");
        if (!link || !link.hasAttribute("href")) return;

        const href = link.getAttribute("href");

        // Abaikan link eksternal atau link kosong atau javascript:void(0)
        if (!href || href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return;

        // Jika link mengarah ke id anchor di halaman yang sama (contoh: #about)
        if (href.startsWith("#") && !href.startsWith("#/")) {
            e.preventDefault();
            router.scrollToHash(href);
            return;
        }

        // Jika link berupa navigasi path biasa (contoh: href="/dashboard")
        if (href.startsWith("/") && !href.startsWith("//")) {
            e.preventDefault();
            window.location.hash = "#" + href;
        }
    });

    // 4. Deteksi saat URL Hash berubah
    window.addEventListener("hashchange", () => {
        router.handleRouting();
    });
});
