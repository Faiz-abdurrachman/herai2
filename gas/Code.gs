/**
 * HerAI Fellowship 2026 - Google Apps Script Backend
 *
 * Cara pakai:
 * 1. Buat Google Spreadsheet kosong.
 * 2. Extensions -> Apps Script.
 * 3. Paste file ini ke Code.gs.
 * 4. Set SPREADSHEET_ID dengan ID spreadsheet.
 * 5. Jalankan setupDatabase() sekali dari editor Apps Script.
 * 6. Deploy -> Web app -> Execute as Me -> Anyone with link.
 */

const SPREADSHEET_ID = '120NQtFqErJiIfITlPfVo8wV6G0_79qFKMTaptxNF-RA';

const SHEETS = {
  participants: 'peserta_tahap_1',
  admins: 'dashboard_admin',
  audit: 'AuditTrail',
  settings: 'Settings',
  stages: 'Stages',
  bootcamp: 'BootcampSessions',
  attendance: 'Attendance',
  competencyQuestions: 'CompetencyQuestions',
  competencySessions: 'CompetencySessions',
  retestAccess: 'ReTestAccess',
  retestSessions: 'ReTestSessions',
  aiResults: 'ai-screening-result',
  projects: 'FinalProjects',
  certificates: 'Certificates',
  assets: 'Assets'
};

const SCHEMA = {
  [SHEETS.participants]: [
    'rowId', 'created_at', 'nama_lengkap', 'nik', 'tempat_lahir', 'tanggal_lahir',
    'whatsapp', 'email', 'alamat', 'jalur', 'status_kerja', 'univ', 'program_studi',
    'instansi', 'posisi', 'pengalaman_kerja', 'kejuaraan', 'organisasi', 'cv_link',
    'essay_1', 'essay_2', 'essay_3', 'essay_4', 'essay_5',
    'status_seleksi', 'participant_stage', 'assigned_reviewer',
    'status_tahap_2', 'competency_status', 'competency_decided_at',
    'status_final', 'final_status',
    'skor_logika', 'skor_motivasi', 'skor_teknis', 'skor_latar', 'skor_akhir',
    'is_scanned', 'ai_summary', 'ai_motivation', 'ai_skills', 'ai_score',
    'bootcamp_status', 'attendance_rate', 'final_project_status', 'certificate_status',
    'participant_password', 'profile_updated_at'
  ],
  [SHEETS.admins]: ['id_admin', 'password', 'peran_admin', 'nama_admin', 'permissions', 'status', 'created_at'],
  [SHEETS.audit]: ['timestamp', 'adminId', 'tindakan', 'perangkat', 'lokasi'],
  [SHEETS.settings]: ['key', 'value', 'updated_at', 'updated_by'],
  [SHEETS.stages]: ['stage_id', 'stage_name', 'status', 'target_date', 'owner', 'notes'],
  [SHEETS.bootcamp]: ['session_id', 'title', 'session_date', 'mentor', 'meeting_url', 'material_url', 'assignment_url', 'status'],
  [SHEETS.attendance]: ['session_id', 'participant_rowId', 'nama_lengkap', 'attendance_status', 'score', 'notes', 'updated_at'],
  [SHEETS.competencyQuestions]: ['id', 'section', 'type', 'difficulty', 'question', 'options', 'answer', 'points', 'status'],
  [SHEETS.competencySessions]: ['session_id', 'nik', 'nama_lengkap', 'status', 'camera_status', 'mic_status', 'answered_count', 'total_questions', 'score', 'weighted_score', 'section_scores', 'answers', 'focus_flags', 'page_visible', 'active_section', 'section_remaining', 'completed_sections', 'camera_snapshot', 'history_events', 'started_at', 'updated_at', 'submitted_at'],
  [SHEETS.retestAccess]: ['access_id', 'nik', 'nama_lengkap', 'access_code', 'status', 'notes', 'created_at', 'updated_at', 'used_at'],
  [SHEETS.retestSessions]: ['session_id', 'nik', 'nama_lengkap', 'status', 'camera_status', 'mic_status', 'answered_count', 'total_questions', 'score', 'weighted_score', 'section_scores', 'answers', 'focus_flags', 'page_visible', 'active_section', 'section_remaining', 'completed_sections', 'camera_snapshot', 'history_events', 'started_at', 'updated_at', 'submitted_at'],
  [SHEETS.aiResults]: ['rowId', 'nik', 'nama_lengkap', 'ai_summary', 'ai_skills', 'ai_motivation', 'analyzed_at', 'ai_score'],
  [SHEETS.projects]: ['project_id', 'team_id', 'team_name', 'title', 'members', 'institution', 'track', 'project_title', 'mentor', 'deck_url', 'repo_url', 'demo_url', 'overview', 'details', 'score', 'status', 'notes', 'submitted_at'],
  [SHEETS.certificates]: ['certificate_no', 'participant_rowId', 'nama_lengkap', 'final_score', 'status', 'issued_at', 'certificate_url'],
  [SHEETS.assets]: ['asset_id', 'title', 'type', 'url', 'visible_to', 'status', 'notes']
};

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    const action = payload.action || 'register';
    const routes = {
      register: () => registerParticipant(payload),
      participantLogin: () => participantLogin(payload),
      setParticipantPassword: () => setParticipantPassword(payload),
      updateParticipantProfile: () => updateParticipantProfile(payload),
      getData: () => getParticipants(),
      updateStatus: () => updateParticipantStatus(payload),
      updateScore: () => updateScore(payload),
      runAiAnalysis: () => runAiAnalysis(payload),
      login: () => login(payload),
      logActivity: () => logActivity(payload),
      getAuditData: () => getAuditData(),
      getAdmins: () => ({ status: 'success', admins: getRows(SHEETS.admins) }),
      addAdmin: () => addRowObject(SHEETS.admins, normalizeAdmin(payload)),
      updateAdmin: () => updateByKey(SHEETS.admins, 'id_admin', payload.id_admin || payload.adminId, normalizeAdmin(payload)),
      deleteAdmin: () => deleteByKey(SHEETS.admins, 'id_admin', payload.id_admin || payload.adminId),
      getSettings: () => ({ status: 'success', settings: getSettingsObject() }),
      saveSettings: () => saveSettingsObject(payload.settings || {}),
      getStages: () => ({ status: 'success', data: getRows(SHEETS.stages) }),
      saveStage: () => upsertByKey(SHEETS.stages, 'stage_id', payload.stage_id, payload),
      getBootcampSessions: () => ({ status: 'success', data: getRows(SHEETS.bootcamp) }),
      saveBootcampSession: () => upsertByKey(SHEETS.bootcamp, 'session_id', payload.session_id, payload),
      getCompetencyQuestions: () => getCompetencyQuestions(),
      startCompetencySession: () => startCompetencySession(payload),
      heartbeatCompetencySession: () => heartbeatCompetencySession(payload),
      saveCompetencyAnswer: () => heartbeatCompetencySession(payload),
      submitCompetencyTest: () => submitCompetencyTest(payload),
      getCompetencySessions: () => ({ status: 'success', sessions: getRows(SHEETS.competencySessions) }),
      updateCompetencyDecision: () => updateCompetencyDecision(payload),
      getReTestAccess: () => getReTestAccess(),
      generateReTestAccess: () => generateReTestAccess(payload),
      deleteReTestAccess: () => deleteByKey(SHEETS.retestAccess, 'access_id', payload.access_id),
      retestLogin: () => retestLogin(payload),
      startReTestSession: () => startCompetencySession(payload, SHEETS.retestSessions),
      heartbeatReTestSession: () => heartbeatCompetencySession(payload, SHEETS.retestSessions),
      saveReTestAnswer: () => heartbeatCompetencySession(payload, SHEETS.retestSessions),
      submitReTest: () => submitCompetencyTest(payload, SHEETS.retestSessions, { updateParticipant: false }),
      getReTestSessions: () => ({ status: 'success', sessions: getRows(SHEETS.retestSessions) }),
      getFinalProjects: () => {
        const projects = getRows(SHEETS.projects);
        return { status: 'success', data: projects, projects };
      },
      submitFinalProject: () => submitFinalProject(payload),
      saveFinalProject: () => upsertByKey(SHEETS.projects, 'team_id', payload.team_id, payload),
      getCertificates: () => ({ status: 'success', data: getRows(SHEETS.certificates) }),
      generateCertificates: () => generateCertificates(),
      getAssets: () => ({ status: 'success', data: getRows(SHEETS.assets) }),
      saveAsset: () => upsertByKey(SHEETS.assets, 'asset_id', payload.asset_id, payload)
    };
    const handler = routes[action];
    if (!handler) throw new Error('Unknown action: ' + action);
    return json(handler());
  } catch (error) {
    return json({ status: 'error', message: error.message });
  }
}

function doGet() {
  return json({ status: 'success', service: 'HerAI GAS Backend', version: '2026.1' });
}

function setupDatabase() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Object.keys(SCHEMA).forEach(name => {
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    ensureSchemaHeaders(sheet, SCHEMA[name]);
    sheet.setFrozenRows(1);
  });
  seedDefaults();
}

function setupReTestDatabase() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  [SHEETS.retestAccess, SHEETS.retestSessions].forEach(name => {
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    ensureSchemaHeaders(sheet, SCHEMA[name]);
    sheet.setFrozenRows(1);
  });
  ensureReTestDemoAccess();
}

function seedDefaults() {
  upsertByKey(SHEETS.admins, 'id_admin', 'super-admin', {
    id_admin: 'super-admin',
    password: 'admin123',
    nama_admin: 'Super Admin',
    peran_admin: 'superadmin',
    permissions: 'all',
    status: 'active',
    created_at: new Date().toISOString()
  });
  ['draft', 'registration_open', 'registration_closed', 'selection_1', 'ai_prescreening', 'review_scoring', 'announcement_stage_1', 'competency_test', 'announcement_stage_2', 'bootcamp_active', 'final_project', 'announcement_final', 'graduation', 'alumni'].forEach(stage => {
    upsertByKey(SHEETS.stages, 'stage_id', stage, { stage_id: stage, stage_name: stage, status: 'planned' });
  });
  seedCompetencyQuestions();
  ensureReTestDemoAccess();
}

function seedCompetencyQuestions() {
  const existing = getRows(SHEETS.competencyQuestions);
  if (existing.length >= 100) return;
  const sheet = getSheet(SHEETS.competencyQuestions);
  ensureSchemaHeaders(sheet, SCHEMA[SHEETS.competencyQuestions]);
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  buildCompetencyQuestionBank().forEach(question => addRowObject(SHEETS.competencyQuestions, {
    id: question.id,
    section: question.section,
    type: question.section,
    difficulty: question.difficulty,
    question: question.question,
    options: question.options.join('|'),
    answer: question.answer,
    points: 1,
    status: 'active'
  }));
}

function buildCompetencyQuestionBank() {
  const math = [
    ['m1', 'math', 'easy', '12 + 18 = ...', ['20', '28', '30', '32'], '30'],
    ['m2', 'math', 'easy', '45 - 17 = ...', ['18', '26', '28', '32'], '28'],
    ['m3', 'math', 'easy', '7 x 8 = ...', ['48', '54', '56', '64'], '56'],
    ['m4', 'math', 'easy', '72 / 9 = ...', ['6', '7', '8', '9'], '8'],
    ['m5', 'math', 'easy', '25% dari 80 adalah...', ['15', '20', '25', '30'], '20'],
    ['m6', 'math', 'medium', 'Jika 3x + 5 = 20, maka x = ...', ['3', '5', '7', '9'], '5'],
    ['m7', 'math', 'medium', 'Rata-rata dari 6, 8, 10, 12 adalah...', ['8', '9', '10', '11'], '9'],
    ['m8', 'math', 'medium', 'Sebuah barang Rp200.000 diskon 15%. Harga akhirnya...', ['Rp160.000', 'Rp170.000', 'Rp175.000', 'Rp185.000'], 'Rp170.000'],
    ['m9', 'math', 'medium', 'Perbandingan 2:3 total 50. Bagian pertama adalah...', ['15', '20', '25', '30'], '20'],
    ['m10', 'math', 'medium', 'Jika 5 pekerja selesai 12 hari, 10 pekerja selesai dalam...', ['4 hari', '5 hari', '6 hari', '8 hari'], '6 hari'],
    ['m11', 'math', 'advanced', 'Jika f(x)=e^(2x) sin(x), nilai f\'(0) adalah...', ['0', '1', '2', '3'], '1'],
    ['m12', 'math', 'advanced', 'Untuk g(x)=ln(x^2+1), nilai g\'(1) adalah...', ['1/2', '1', '2', '4'], '1'],
    ['m13', 'math', 'advanced', 'Nilai integral dari 0 sampai 1 untuk 6x(1-x) dx adalah...', ['1/2', '1', '3/2', '2'], '1'],
    ['m14', 'math', 'advanced', 'Limit sin(3x)/x saat x mendekati 0 adalah...', ['0', '1', '3', 'Tidak ada'], '3'],
    ['m15', 'math', 'advanced', 'Jika A=[[3,1],[0,2]], hasil kali eigenvalue A adalah...', ['2', '3', '5', '6'], '6']
  ];
  const logic = Array.from({ length: 50 }, (_, index) => {
    const id = 'l' + (index + 1);
    const variants = [
      ['Semua proposal yang lolos review memiliki data valid. Sebagian proposal HerAI lolos review. Kesimpulan paling kuat adalah...', ['Semua proposal HerAI valid', 'Sebagian proposal HerAI memiliki data valid', 'Tidak ada proposal HerAI valid', 'Semua data valid lolos review'], 'Sebagian proposal HerAI memiliki data valid'],
      ['Kecukupan data: x dan y bilangan bulat positif. Apakah x > y? (1) x+y=11 (2) x-y=3', ['Pernyataan 1 saja cukup', 'Pernyataan 2 saja cukup', 'Keduanya bersama cukup', 'Keduanya tidak cukup'], 'Pernyataan 2 saja cukup'],
      ['Pola analitis: 4, 9, 19, 39, 79, ... berikutnya adalah...', ['119', '139', '159', '179'], '159'],
      ['Program A meningkatkan skor rata-rata 20% pada kelompok kecil yang sukarela ikut. Kesimpulan "semua peserta wajib ikut A" paling lemah karena...', ['Mengasumsikan efek sama untuk semua peserta', 'Menggunakan angka persentase', 'Membahas program', 'Tidak menyebut lokasi'], 'Mengasumsikan efek sama untuk semua peserta'],
      ['Jika hanya kandidat dengan skor AI tinggi atau reviewer tinggi yang lolos. Rina lolos tetapi skor AI rendah. Maka...', ['Reviewer Rina tinggi', 'AI Rina tinggi', 'Rina tidak lolos', 'Tidak ada kesimpulan'], 'Reviewer Rina tinggi']
    ];
    const selected = variants[index % variants.length];
    return [id, 'logic', 'standard', selected[0], selected[1], selected[2]];
  });
  const psychology = Array.from({ length: 50 }, (_, index) => {
    const id = 'p' + (index + 1);
    const variants = [
      ['Saat tim berbeda pendapat, respons terbaik adalah...', ['Memaksakan pendapat sendiri', 'Mendengar alasan tiap pihak lalu mencari titik temu', 'Diam agar konflik selesai', 'Menyalahkan anggota paling pasif'], 'Mendengar alasan tiap pihak lalu mencari titik temu'],
      ['Ketika mendapat feedback keras, sikap paling adaptif adalah...', ['Menolak feedback', 'Mencatat poin valid dan membuat rencana perbaikan', 'Menghindari pemberi feedback', 'Membalas dengan kritik'], 'Mencatat poin valid dan membuat rencana perbaikan'],
      ['Jika deadline mendekat dan tugas belum selesai, prioritas utama adalah...', ['Panik', 'Memecah tugas, komunikasikan risiko, dan selesaikan bagian kritis', 'Menunggu instruksi', 'Mengabaikan kualitas sepenuhnya'], 'Memecah tugas, komunikasikan risiko, dan selesaikan bagian kritis'],
      ['Dalam belajar teknologi baru, perilaku paling sehat adalah...', ['Menyerah saat error pertama', 'Mencoba, mencari referensi, dan meminta bantuan saat buntu', 'Menyalin tanpa memahami', 'Menyalahkan tools'], 'Mencoba, mencari referensi, dan meminta bantuan saat buntu']
    ];
    const selected = variants[index % variants.length];
    return [id, 'psychology', 'situational', selected[0], selected[1], selected[2]];
  });
  return math.concat(logic, psychology).map(item => ({
    id: item[0],
    section: item[1],
    difficulty: item[2],
    question: item[3],
    options: item[4],
    answer: item[5]
  }));
}

function registerParticipant(payload) {
  const rowId = Date.now();
  addRowObject(SHEETS.participants, {
    rowId,
    created_at: new Date().toISOString(),
    nama_lengkap: payload.nama_lengkap,
    nik: payload.nik,
    tempat_lahir: payload.tempat_lahir,
    tanggal_lahir: payload.tanggal_lahir,
    whatsapp: payload.whatsapp,
    email: payload.email,
    alamat: payload.alamat,
    jalur: payload.jalur_pendaftaran,
    status_kerja: payload.status,
    univ: payload.universitas,
    program_studi: payload.program_studi,
    instansi: payload.nama_instansi,
    posisi: payload.posisi,
    pengalaman_kerja: payload.pengalaman_kerja,
    kejuaraan: payload.kejuaraan,
    organisasi: payload.pengalaman_organisasi,
    cv_link: payload.link_cv,
    essay_1: payload.essay_1,
    essay_2: payload.essay_2,
    essay_3: payload.essay_3,
    essay_4: payload.essay_4,
    essay_5: payload.essay_5,
    status_seleksi: 'pending',
    participant_stage: 'registered',
    status_tahap_2: 'pending',
    competency_status: 'pending',
    status_final: 'pending',
    final_status: 'pending',
    is_scanned: false,
    certificate_status: 'pending'
  });
  return { status: 'success', rowId };
}

function getParticipants() {
  return { status: 'success', data: mergeAiScreeningResults(getRows(SHEETS.participants)) };
}

function participantLogin(payload) {
  const participant = findParticipantByNik(payload.nik);
  if (!participant) return { status: 'error', message: 'NIK belum terdaftar.' };
  if (!participant.participant_password) return { status: 'needs_password', message: 'Password belum dibuat.' };
  if (String(participant.participant_password) !== String(payload.password)) {
    return { status: 'error', message: 'Password salah.' };
  }
  return { status: 'success', profile: stripSensitiveParticipant(participant) };
}

function setParticipantPassword(payload) {
  if (!payload.nik || !payload.password) return { status: 'error', message: 'NIK dan password wajib diisi.' };
  if (String(payload.password).length < 6) return { status: 'error', message: 'Password minimal 6 karakter.' };
  const participant = findParticipantByNik(payload.nik);
  if (!participant) return { status: 'error', message: 'NIK belum terdaftar.' };
  if (participant.participant_password) return { status: 'error', message: 'Password sudah dibuat. Silakan login.' };
  updateByKey(SHEETS.participants, 'nik', participant.nik, {
    participant_password: payload.password,
    participant_stage: normalizeParticipantStage(participant.participant_stage),
    profile_updated_at: new Date().toISOString()
  });
  const updated = findParticipantByNik(payload.nik);
  return { status: 'success', profile: stripSensitiveParticipant(updated) };
}

function updateParticipantProfile(payload) {
  if (!payload.nik) return { status: 'error', message: 'NIK wajib diisi.' };
  const participant = findParticipantByNik(payload.nik);
  if (!participant) return { status: 'error', message: 'NIK belum terdaftar.' };
  if (!participant.participant_password) return { status: 'needs_password', message: 'Password belum dibuat.' };
  if (String(participant.participant_password) !== String(payload.password)) {
    return { status: 'error', message: 'Session tidak valid. Silakan login ulang.' };
  }
  const allowed = {
    nama_lengkap: payload.nama_lengkap,
    email: payload.email,
    whatsapp: payload.whatsapp,
    alamat: payload.alamat,
    cv_link: payload.cv_link,
    profile_updated_at: new Date().toISOString()
  };
  updateByKey(SHEETS.participants, 'nik', participant.nik, allowed);
  const updated = findParticipantByNik(payload.nik);
  return { status: 'success', profile: stripSensitiveParticipant(updated) };
}

function stripSensitiveParticipant(participant) {
  const clone = { ...participant };
  delete clone.participant_password;
  return clone;
}

function findParticipantByNik(nik) {
  const cleanNik = String(nik || '').replace(/\D/g, '');
  return getRows(SHEETS.participants).find(p => String(p.nik || '').replace(/\D/g, '') === cleanNik);
}

function normalizeParticipantStage(stage) {
  if (!stage || stage === 'profile_created') return 'registered';
  return stage;
}

function updateParticipantStatus(payload) {
  const status = payload.status || payload.newStatus;
  return updateByKey(SHEETS.participants, 'rowId', payload.rowId, {
    status_seleksi: status,
    participant_stage: status === 'lolos' ? 'accepted_stage_1' : 'rejected_stage_1'
  });
}

function updateScore(payload) {
  return updateByKey(SHEETS.participants, 'rowId', payload.rowId, {
    skor_logika: payload.skor_logika,
    skor_motivasi: payload.skor_motivasi,
    skor_teknis: payload.skor_teknis,
    skor_latar: payload.skor_latar,
    skor_akhir: payload.skor_akhir,
    participant_stage: 'reviewed'
  });
}

function getCompetencyQuestions() {
  let questions = getRows(SHEETS.competencyQuestions).filter(q => String(q.status || 'active') === 'active');
  if (questions.length === 0) {
    seedCompetencyQuestions();
    questions = getRows(SHEETS.competencyQuestions).filter(q => String(q.status || 'active') === 'active');
  }
  return {
    status: 'success',
    questions: questions.map(q => ({
      id: q.id,
      section: q.section || q.type,
      type: q.type || q.section,
      difficulty: q.difficulty || 'standard',
      question: q.question,
      options: String(q.options || '').split('|').filter(Boolean),
      points: Number(q.points || 1)
    }))
  };
}

function getReTestAccess() {
  ensureReTestDemoAccess();
  return { status: 'success', access: getRows(SHEETS.retestAccess) };
}

function ensureReTestDemoAccess() {
  const accessId = 'rt_demo_3276010101010001';
  const existing = getRows(SHEETS.retestAccess).find(row => String(row.access_id) === accessId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const demo = {
    access_id: accessId,
    nik: '3276010101010001',
    nama_lengkap: 'Alya Putri Demo',
    access_code: 'RT-DEMO-2026',
    status: 'active',
    notes: 'Akun testing Re-Test',
    created_at: now,
    updated_at: now,
    used_at: ''
  };
  addRowObject(SHEETS.retestAccess, demo);
  return demo;
}

function generateReTestAccess(payload) {
  const nik = String(payload.nik || '').replace(/\D/g, '');
  if (nik.length !== 16) return { status: 'error', message: 'NIK harus 16 digit.' };
  const participant = findParticipantByNik(nik);
  const now = new Date().toISOString();
  const previous = getRows(SHEETS.retestAccess).find(row => String(row.nik) === nik);
  const access = {
    access_id: previous && previous.access_id ? previous.access_id : 'rt_' + nik,
    nik,
    nama_lengkap: payload.nama_lengkap || (participant && participant.nama_lengkap) || 'Peserta Re-Test',
    access_code: generateReTestCode(),
    status: 'active',
    notes: payload.notes || '',
    created_at: previous && previous.created_at ? previous.created_at : now,
    updated_at: now,
    used_at: previous && previous.used_at ? previous.used_at : ''
  };
  upsertByKey(SHEETS.retestAccess, 'access_id', access.access_id, access);
  return { status: 'success', access };
}

function generateReTestCode() {
  return 'RT-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}

function retestLogin(payload) {
  ensureReTestDemoAccess();
  const nik = String(payload.nik || '').replace(/\D/g, '');
  const accessCode = String(payload.access_code || payload.code || '').trim().toUpperCase();
  if (nik.length !== 16) return { status: 'error', message: 'NIK harus 16 digit.' };
  if (!accessCode) return { status: 'error', message: 'Kode unik wajib diisi.' };
  const access = getRows(SHEETS.retestAccess).find(row =>
    String(row.nik || '').replace(/\D/g, '') === nik &&
    String(row.access_code || '').trim().toUpperCase() === accessCode &&
    String(row.status || 'active').toLowerCase() === 'active'
  );
  if (!access) return { status: 'error', message: 'NIK atau kode unik Re-Test tidak valid.' };
  updateByKey(SHEETS.retestAccess, 'access_id', access.access_id, { used_at: new Date().toISOString() });
  return {
    status: 'success',
    profile: {
      nik,
      nama_lengkap: access.nama_lengkap || 'Peserta Re-Test',
      retest_access_id: access.access_id
    }
  };
}

function startCompetencySession(payload, sessionSheet) {
  sessionSheet = sessionSheet || SHEETS.competencySessions;
  const prefix = sessionSheet === SHEETS.retestSessions ? 'rt' : 'ct';
  const sessionId = payload.session_id || [prefix, payload.nik, Date.now()].join('_');
  const now = new Date().toISOString();
  const session = {
    session_id: sessionId,
    nik: payload.nik,
    nama_lengkap: payload.nama_lengkap,
    status: payload.status || 'started',
    camera_status: payload.camera_status || 'unknown',
    mic_status: payload.mic_status || 'unknown',
    answered_count: Number(payload.answered_count || 0),
    total_questions: Number(payload.total_questions || 0),
    score: '',
    weighted_score: '',
    section_scores: '{}',
    answers: '{}',
    focus_flags: Number(payload.focus_flags || 0),
    page_visible: true,
    active_section: payload.active_section || '',
    section_remaining: JSON.stringify(payload.section_remaining || {}),
    completed_sections: JSON.stringify(payload.completed_sections || []),
    camera_snapshot: payload.camera_snapshot || '',
    history_events: JSON.stringify([{ at: now, event: payload.status || 'started', section: payload.active_section || '', answered_count: Number(payload.answered_count || 0), focus_flags: Number(payload.focus_flags || 0) }]),
    started_at: now,
    updated_at: now,
    submitted_at: ''
  };
  upsertByKey(sessionSheet, 'session_id', sessionId, session);
  return { status: 'success', session };
}

function heartbeatCompetencySession(payload, sessionSheet) {
  sessionSheet = sessionSheet || SHEETS.competencySessions;
  if (!payload.session_id) return { status: 'error', message: 'session_id wajib diisi.' };
  const updates = {
    status: payload.status || 'started',
    camera_status: payload.camera_status || 'unknown',
    mic_status: payload.mic_status || 'unknown',
    answered_count: Number(payload.answered_count || 0),
    total_questions: Number(payload.total_questions || 0),
    answers: JSON.stringify(payload.answers || {}),
    focus_flags: Number(payload.focus_flags || 0),
    page_visible: payload.page_visible === false ? false : true,
    active_section: payload.active_section || '',
    section_remaining: JSON.stringify(payload.section_remaining || {}),
    completed_sections: JSON.stringify(payload.completed_sections || []),
    camera_snapshot: payload.camera_snapshot || '',
    history_events: JSON.stringify(appendSessionHistory(payload.session_id, {
      at: new Date().toISOString(),
      event: payload.status || 'started',
      section: payload.active_section || '',
      answered_count: Number(payload.answered_count || 0),
      focus_flags: Number(payload.focus_flags || 0)
    }, sessionSheet)),
    updated_at: new Date().toISOString()
  };
  upsertByKey(sessionSheet, 'session_id', payload.session_id, { session_id: payload.session_id, nik: payload.nik, ...updates });
  return { status: 'success', session: { session_id: payload.session_id, ...updates } };
}

function submitCompetencyTest(payload, sessionSheet, options) {
  sessionSheet = sessionSheet || SHEETS.competencySessions;
  options = options || {};
  if (!payload.session_id) return { status: 'error', message: 'session_id wajib diisi.' };
  const now = new Date().toISOString();
  const scoreResult = calculateCompetencyScores(payload);
  const updates = {
    status: 'submitted',
    answered_count: Number(payload.total_questions || 0),
    total_questions: Number(payload.total_questions || 0),
    score: scoreResult.rawScore,
    weighted_score: scoreResult.weightedScore,
    section_scores: JSON.stringify(scoreResult.sectionScores || {}),
    answers: JSON.stringify(payload.answers || {}),
    focus_flags: Number(payload.focus_flags || 0),
    active_section: payload.active_section || '',
    section_remaining: JSON.stringify(payload.section_remaining || {}),
    completed_sections: JSON.stringify(payload.completed_sections || []),
    camera_snapshot: payload.camera_snapshot || '',
    history_events: JSON.stringify(appendSessionHistory(payload.session_id, {
      at: now,
      event: 'submitted',
      section: payload.active_section || '',
      answered_count: Number(payload.total_questions || 0),
      focus_flags: Number(payload.focus_flags || 0)
    }, sessionSheet)),
    updated_at: now,
    submitted_at: now
  };
  upsertByKey(sessionSheet, 'session_id', payload.session_id, { session_id: payload.session_id, nik: payload.nik, ...updates });
  const participant = options.updateParticipant === false ? null : findParticipantByNik(payload.nik);
  if (participant) {
    updateByKey(SHEETS.participants, 'nik', participant.nik, {
      participant_stage: 'competency_submitted'
    });
  }
  return { status: 'success', session: { session_id: payload.session_id, ...updates } };
}

function calculateCompetencyScores(payload) {
  const answers = payload.answers || {};
  const variant = getCompetencyVariant(payload.nik || '');
  const questions = getRows(SHEETS.competencyQuestions).filter(q => String(q.status || 'active') === 'active');
  const byId = {};
  questions.forEach(q => {
    byId[String(q.id)] = q;
    byId[String(q.id) + '_v' + variant] = q;
  });

  const sectionScores = {};
  let rawScore = 0;
  let weightedScore = 0;

  Object.keys(answers).forEach(answerId => {
    const q = byId[String(answerId)];
    if (!q) return;
    const section = q.section || q.type || 'logic';
    const expected = applyCompetencyVariantText(q.answer, variant);
    const submitted = String(answers[answerId] || '');
    const correct = submitted !== '' && submitted === expected;
    const base = submitted === '' ? 0 : correct ? 1 : -0.3;
    const weight = getCompetencyQuestionWeight(q);
    rawScore += base;
    weightedScore += base * weight;
    sectionScores[section] = (sectionScores[section] || 0) + base * weight;
  });

  Object.keys(sectionScores).forEach(section => {
    sectionScores[section] = Number(sectionScores[section].toFixed(2));
  });

  return {
    rawScore: Number(rawScore.toFixed(2)),
    weightedScore: Number(weightedScore.toFixed(2)),
    sectionScores
  };
}

function getCompetencyQuestionWeight(q) {
  const section = String(q.section || q.type || '');
  const difficulty = String(q.difficulty || 'standard');
  if (section === 'math' && difficulty === 'advanced') return 1.35;
  if (section === 'math' && difficulty === 'medium') return 1.1;
  if (section === 'psychology') return 0.9;
  return 1;
}

function getCompetencyVariant(nik) {
  const digits = String(nik || '').replace(/\D/g, '').split('');
  const sum = digits.reduce(function(total, value) { return total + Number(value || 0); }, 0);
  return (sum % 3) + 1;
}

function applyCompetencyVariantText(value, variant) {
  if (variant === 1) return String(value || '');
  const swaps = variant === 2
    ? [['HerAI', 'program fellowship'], ['Rina', 'Nadia'], ['Program A', 'Program B'], ['proposal', 'proyek']]
    : [['HerAI', 'kohort AI'], ['Rina', 'Salsabila'], ['Program A', 'Program C'], ['proposal', 'portofolio']];
  return swaps.reduce(function(text, pair) {
    return text.split(pair[0]).join(pair[1]);
  }, String(value || ''));
}

function appendSessionHistory(sessionId, event, sessionSheet) {
  sessionSheet = sessionSheet || SHEETS.competencySessions;
  const session = getRows(sessionSheet).find(row => String(row.session_id) === String(sessionId));
  let history = [];
  try {
    history = JSON.parse(session && session.history_events ? session.history_events : '[]');
  } catch (error) {
    history = [];
  }
  history.push(event);
  return history.slice(-80);
}

function updateCompetencyDecision(payload) {
  const nik = String(payload.nik || '').replace(/\D/g, '');
  const decision = String(payload.decision || payload.status || '').toLowerCase();
  if (!nik) return { status: 'error', message: 'NIK wajib diisi.' };
  if (['lolos', 'gugur', 'pending'].indexOf(decision) === -1) return { status: 'error', message: 'Decision tidak valid.' };
  const participant = findParticipantByNik(nik);
  if (!participant) return { status: 'error', message: 'Peserta tidak ditemukan.' };
  const stage = decision === 'lolos' ? 'accepted_stage_2' : decision === 'gugur' ? 'rejected_stage_2' : 'competency_submitted';
  updateByKey(SHEETS.participants, 'nik', participant.nik, {
    status_tahap_2: decision,
    competency_status: decision,
    participant_stage: stage,
    competency_decided_at: new Date().toISOString()
  });
  return { status: 'success', participant: stripSensitiveParticipant(findParticipantByNik(nik)) };
}

function submitFinalProject(payload) {
  const projectId = payload.project_id || `fp_${Date.now()}`;
  const project = {
    project_id: projectId,
    team_id: payload.team_id || projectId,
    team_name: payload.teamName || payload.team_name || '',
    title: payload.title || payload.project_title || '',
    members: payload.members || '',
    institution: payload.institution || '',
    track: payload.track || '',
    project_title: payload.title || payload.project_title || '',
    mentor: payload.mentor || '',
    deck_url: payload.deckUrl || payload.deck_url || '',
    repo_url: payload.repoUrl || payload.repo_url || '',
    demo_url: payload.demoUrl || payload.demo_url || '',
    overview: payload.overview || '',
    details: payload.details || '',
    score: payload.score || '',
    status: payload.status || 'submitted',
    notes: payload.notes || '',
    submitted_at: payload.submittedAt || new Date().toISOString()
  };
  upsertByKey(SHEETS.projects, 'project_id', projectId, project);
  return { status: 'success', project, projects: getRows(SHEETS.projects) };
}

function runAiAnalysis(payload) {
  const p = payload.participant || {};
  if (!p || !p.rowId) throw new Error('Data peserta tidak ditemukan');
  const analysis = callGroqAiAnalysis(p);
  saveAiScreeningResult(p, analysis);
  updateByKey(SHEETS.participants, 'rowId', p.rowId, {
    is_scanned: true,
    ai_summary: JSON.stringify(analysis.essay_analysis),
    ai_motivation: analysis.motivation,
    ai_skills: analysis.skills.join(', '),
    ai_score: analysis.score
  });
  return { status: 'success', data: analysis };
}

function callGroqAiAnalysis(p) {
  const apiKey = getGroqApiKey();
  if (!apiKey) return buildFallbackAiAnalysis(p);

  const promptText = [
    'Anda adalah AI Recruiter ahli. Analisis 5 esai dari pendaftar tech fellowship berikut:',
    '',
    'Nama: ' + (p.nama_lengkap || '-'),
    'Latar Belakang: ' + (p.univ || p.instansi || p.status_kerja || '-'),
    '',
    'Esai 1: ' + (p.essay_1 || p.essay1 || '-'),
    'Esai 2: ' + (p.essay_2 || p.essay2 || '-'),
    'Esai 3: ' + (p.essay_3 || p.essay3 || '-'),
    'Esai 4: ' + (p.essay_4 || p.essay4 || '-'),
    'Esai 5: ' + (p.essay_5 || p.essay5 || '-'),
    '',
    'Berikan analisis dalam format JSON ketat dengan struktur:',
    '{"essay_analysis":{"q1_about":"","q2_reason":"","q3_impact":"","q4_expectations":"","q5_outstanding":""},"motivation":"","skills":[""],"score":0}',
    'PENTING: score angka bulat 0-100, objektif, ketat, dan jangan selalu menjawab 85.'
  ].join('\n');

  const groqPayload = {
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: 'Hanya respon dengan format JSON murni.' },
      { role: 'user', content: promptText }
    ],
    temperature: 0.4,
    response_format: { type: 'json_object' }
  };

  const response = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    payload: JSON.stringify(groqPayload),
    muteHttpExceptions: true
  });
  const jsonResponse = JSON.parse(response.getContentText());
  if (jsonResponse.error) throw new Error('Groq API Error: ' + jsonResponse.error.message);
  const insight = JSON.parse(jsonResponse.choices[0].message.content);
  return normalizeAiInsight(insight, p);
}

function buildFallbackAiAnalysis(p) {
  return {
    essay_analysis: {
      q1_about: summarize(p.essay_1 || p.essay1),
      q2_reason: summarize(p.essay_2 || p.essay2),
      q3_impact: summarize(p.essay_3 || p.essay3),
      q4_expectations: summarize(p.essay_4 || p.essay4),
      q5_outstanding: summarize(p.essay_5 || p.essay5)
    },
    motivation: summarize([p.essay_2 || p.essay2, p.essay_3 || p.essay3, p.essay_4 || p.essay4].join(' ')),
    skills: extractSkills([p.essay_1 || p.essay1, p.essay_2 || p.essay2, p.essay_3 || p.essay3, p.essay_4 || p.essay4, p.essay_5 || p.essay5].join(' ')),
    score: Math.min(95, Math.max(55, Math.round(((p.essay_1 || p.essay1 || '').length + (p.essay_2 || p.essay2 || '').length) / 45)))
  };
}

function normalizeAiInsight(insight, participant) {
  const fallback = buildFallbackAiAnalysis(participant);
  const score = Number(insight.score);
  return {
    essay_analysis: insight.essay_analysis || fallback.essay_analysis,
    motivation: insight.motivation || fallback.motivation,
    skills: Array.isArray(insight.skills) ? insight.skills : fallback.skills,
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : fallback.score
  };
}

function getGroqApiKey() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('data');
  if (!sheet) return '';
  return String(sheet.getRange('B1').getValue() || '').trim();
}

function saveAiScreeningResult(p, analysis) {
  const result = {
    rowId: p.rowId,
    nik: p.nik || '',
    nama_lengkap: p.nama_lengkap || '',
    ai_summary: JSON.stringify(analysis.essay_analysis || {}),
    ai_skills: Array.isArray(analysis.skills) ? analysis.skills.join(', ') : String(analysis.skills || ''),
    ai_motivation: analysis.motivation || '',
    analyzed_at: new Date().toISOString(),
    ai_score: analysis.score || 0
  };
  upsertByKey(SHEETS.aiResults, 'rowId', p.rowId, result);
}

function login(payload) {
  const admins = getRows(SHEETS.admins);
  const loginId = String(payload.id_admin || payload.adminId || '');
  const admin = admins.find(a => {
    const rowId = String(a.id_admin || a.adminId || '');
    const status = String(a.status || 'active').toLowerCase();
    return rowId === loginId && String(a.password) === String(payload.password) && status !== 'inactive' && status !== 'disabled';
  });
  if (!admin) return { status: 'error', message: 'ID admin atau password salah.' };
  logActivity({
    adminId: loginId,
    tindakan: 'Melakukan Login Ke Dashboard',
    perangkat: payload.perangkat || payload.device || 'Unknown Device',
    lokasi: payload.lokasi || 'Unknown Location'
  });
  return { status: 'success', admin: normalizeAdminForClient(admin) };
}

function logActivity(payload) {
  addRowObject(SHEETS.audit, {
    timestamp: new Date().toISOString(),
    adminId: payload.adminId,
    tindakan: payload.tindakan,
    perangkat: payload.perangkat,
    lokasi: payload.lokasi
  });
  return { status: 'success' };
}

function getAuditData() {
  const logs = getRows(SHEETS.audit);
  const seen = {};
  const sessions = [];
  for (let i = logs.length - 1; i >= 0; i--) {
    const log = logs[i];
    const adminId = log.adminId || log.id_admin || 'unknown-admin';
    if (seen[adminId]) continue;
    seen[adminId] = true;
    sessions.push({
      nama_admin: String(adminId).split('-')[0] || 'Admin',
      id_admin: adminId,
      adminId: adminId,
      tindakan: log.tindakan || '-',
      time_stamp: log.timestamp || log.time_stamp || '',
      perangkat: log.perangkat || 'Unknown Device',
      lokasi_ip: log.lokasi || log.lokasi_ip || 'Unknown Location'
    });
    if (sessions.length >= 6) break;
  }
  return { status: 'success', data: logs, logs, sessions };
}

// Compatibility wrapper untuk Apps Script project lama.
// Jika dropdown Run masih menunjuk ke recordAuditTrail, function ini tetap aman dijalankan.
function recordAuditTrail(idAdmin, tindakan, perangkat, lokasi) {
  return logActivity({
    adminId: idAdmin || 'system',
    tindakan: tindakan || 'Manual audit check',
    perangkat: perangkat || 'Apps Script',
    lokasi: lokasi || 'Apps Script Editor'
  });
}

function generateCertificates() {
  const participants = getRows(SHEETS.participants).filter(p => String(p.participant_stage) === 'graduated' || Number(p.skor_akhir) >= 75);
  participants.forEach((p, i) => {
    upsertByKey(SHEETS.certificates, 'participant_rowId', p.rowId, {
      certificate_no: `HERAI-2026-${String(i + 1).padStart(4, '0')}`,
      participant_rowId: p.rowId,
      nama_lengkap: p.nama_lengkap,
      final_score: p.skor_akhir,
      status: 'eligible',
      issued_at: ''
    });
  });
  return { status: 'success', generated: participants.length };
}

function getSettingsObject() {
  const rows = getRows(SHEETS.settings);
  return rows.reduce((acc, row) => {
    try {
      acc[row.key] = JSON.parse(row.value);
    } catch {
      acc[row.key] = row.value;
    }
    return acc;
  }, {});
}

function saveSettingsObject(settings) {
  Object.keys(settings).forEach(key => {
    upsertByKey(SHEETS.settings, 'key', key, {
      key,
      value: JSON.stringify(settings[key]),
      updated_at: new Date().toISOString(),
      updated_by: 'dashboard'
    });
  });
  return { status: 'success', settings };
}

function getRows(sheetName) {
  const sheet = getSheet(sheetName);
  ensureSchemaHeaders(sheet, SCHEMA[sheetName] || []);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0];
  return values.slice(1).filter(row => row.some(cell => cell !== '')).map((row, index) => {
    const obj = {};
    headers.forEach((header, index) => obj[header] = row[index]);
    return sheetName === SHEETS.participants ? normalizeParticipantRow(obj, index + 2) : obj;
  });
}

function addRowObject(sheetName, obj) {
  const sheet = getSheet(sheetName);
  ensureSchemaHeaders(sheet, SCHEMA[sheetName] || Object.keys(obj));
  const headers = getHeaders(sheet);
  sheet.appendRow(headers.map(header => getObjectValueForHeader(sheetName, header, obj)));
  return { status: 'success' };
}

function updateByKey(sheetName, key, value, updates) {
  const sheet = getSheet(sheetName);
  ensureSchemaHeaders(sheet, SCHEMA[sheetName] || Object.keys(updates));
  const headers = getHeaders(sheet);
  const keyIndex = headers.indexOf(key);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    const cellValue = keyIndex >= 0 ? values[i][keyIndex] : '';
    const rowNumberFallback = sheetName === SHEETS.participants && key === 'rowId' && String(i + 1) === String(value);
    if (String(cellValue) === String(value) || rowNumberFallback) {
      Object.keys(updates).forEach(updateKey => {
        const col = headers.indexOf(updateKey);
        if (col >= 0) sheet.getRange(i + 1, col + 1).setValue(getObjectValueForHeader(sheetName, updateKey, updates));
      });
      return { status: 'success' };
    }
  }
  return { status: 'error', message: `${key} tidak ditemukan` };
}

function upsertByKey(sheetName, key, value, obj) {
  const updated = updateByKey(sheetName, key, value, obj);
  if (updated.status === 'success') return updated;
  return addRowObject(sheetName, obj);
}

function deleteByKey(sheetName, key, value) {
  const sheet = getSheet(sheetName);
  const headers = getHeaders(sheet);
  const keyIndex = headers.indexOf(key);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][keyIndex]) === String(value)) {
      sheet.deleteRow(i + 1);
      return { status: 'success' };
    }
  }
  return { status: 'error', message: `${key} tidak ditemukan` };
}

function normalizeAdmin(payload) {
  return {
    id_admin: payload.id_admin || payload.adminId,
    password: payload.password || '',
    peran_admin: payload.peran_admin || payload.role || 'reviewer',
    nama_admin: payload.nama_admin || payload.name || payload.nama || '',
    permissions: Array.isArray(payload.permissions) ? payload.permissions.join(',') : (payload.permissions || ''),
    status: payload.status || 'active',
    created_at: payload.created_at || new Date().toISOString()
  };
}

function normalizeAdminForClient(admin) {
  return {
    id_admin: admin.id_admin || admin.adminId || '',
    adminId: admin.id_admin || admin.adminId || '',
    nama_admin: admin.nama_admin || admin.name || '',
    name: admin.nama_admin || admin.name || '',
    peran_admin: admin.peran_admin || admin.role || 'reviewer',
    role: admin.peran_admin || admin.role || 'reviewer',
    permissions: admin.permissions || '',
    status: admin.status || 'active',
    created_at: admin.created_at || ''
  };
}

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function getHeaders(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function ensureSchemaHeaders(sheet, schemaHeaders) {
  if (!schemaHeaders || schemaHeaders.length === 0) return;
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, schemaHeaders.length).setValues([schemaHeaders]);
    return;
  }
  const headers = getHeaders(sheet).filter(Boolean);
  if (headers.length === 0) {
    sheet.getRange(1, 1, 1, schemaHeaders.length).setValues([schemaHeaders]);
    return;
  }
  const missing = schemaHeaders.filter(header => headers.indexOf(header) < 0);
  if (missing.length > 0) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
  }
}

function normalizeParticipantRow(obj, rowNumber) {
  const normalized = Object.assign({}, obj);
  normalized.rowId = normalized.rowId || rowNumber;
  normalized.jalur = normalized.jalur || normalized.jalur_pendaftaran || '';
  normalized.status_kerja = normalized.status_kerja || normalized.status || '';
  normalized.univ = normalized.univ || normalized.universitas || '';
  normalized.instansi = normalized.instansi || normalized.nama_instansi || '';
  normalized.organisasi = normalized.organisasi || normalized.pengalaman_organisasi || '';
  normalized.cv_link = normalized.cv_link || normalized.link_cv || '';
  normalized.status_seleksi = normalized.status_seleksi || 'pending';
  normalized.status_tahap_2 = normalized.status_tahap_2 || 'pending';
  normalized.competency_status = normalized.competency_status || normalized.status_tahap_2 || 'pending';
  normalized.final_status = normalized.final_status || normalized.status_final || 'pending';
  normalized.participant_stage = normalized.participant_stage || (
    String(normalized.status_seleksi).toLowerCase() === 'lolos' ? 'accepted_stage_1' :
    String(normalized.status_seleksi).toLowerCase() === 'gugur' ? 'rejected_stage_1' :
    'registered'
  );
  normalized.is_scanned = isTruthy(normalized.is_scanned) || !!(normalized.ai_score || normalized.ai_summary || normalized.ai_motivation || normalized.ai_skills);
  return normalized;
}

function mergeAiScreeningResults(participants) {
  const aiRows = getRows(SHEETS.aiResults);
  if (!aiRows.length) return participants;
  const byRowId = {};
  const byNik = {};
  aiRows.forEach(row => {
    if (row.rowId) byRowId[String(row.rowId)] = row;
    if (row.nik) byNik[String(row.nik).replace(/\D/g, '')] = row;
  });
  return participants.map(participant => {
    const ai = byRowId[String(participant.rowId)] || byNik[String(participant.nik || '').replace(/\D/g, '')];
    if (!ai) return participant;
    return Object.assign({}, participant, {
      is_scanned: true,
      ai_summary: participant.ai_summary || ai.ai_summary || '',
      ai_skills: participant.ai_skills || ai.ai_skills || '',
      ai_motivation: participant.ai_motivation || ai.ai_motivation || '',
      ai_score: participant.ai_score || ai.ai_score || 0,
      ai_data: {
        ai_summary: participant.ai_summary || ai.ai_summary || '',
        ai_skills: participant.ai_skills || ai.ai_skills || '',
        ai_motivation: participant.ai_motivation || ai.ai_motivation || '',
        ai_score: participant.ai_score || ai.ai_score || 0
      }
    });
  });
}

function getObjectValueForHeader(sheetName, header, obj) {
  if (obj[header] !== undefined) return obj[header];
  if (sheetName !== SHEETS.participants) return '';
  const aliases = {
    jalur_pendaftaran: 'jalur',
    status: 'status_kerja',
    universitas: 'univ',
    nama_instansi: 'instansi',
    pengalaman_organisasi: 'organisasi',
    link_cv: 'cv_link'
  };
  const canonical = aliases[header];
  return canonical && obj[canonical] !== undefined ? obj[canonical] : '';
}

function isTruthy(value) {
  const raw = String(value || '').toLowerCase();
  return value === true || ['true', 'yes', '1', 'scanned', 'done'].indexOf(raw) >= 0;
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function summarize(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 180) + (clean.length > 180 ? '...' : '') : 'Tidak ada jawaban.';
}

function extractSkills(text) {
  const source = String(text || '').toLowerCase();
  const candidates = ['python', 'data analysis', 'machine learning', 'ai', 'excel', 'sql', 'public speaking', 'leadership', 'design', 'research'];
  const found = candidates.filter(skill => source.includes(skill));
  return found.length ? found : ['AI Enthusiasm', 'Learning Agility'];
}
