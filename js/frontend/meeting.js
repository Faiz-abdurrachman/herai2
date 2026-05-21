/* ==========================================================================
   HerAI Meeting Room - WebRTC client with Gorilla WebSocket signaling
   ========================================================================== */

window.initMeetingRoom = function() {
    const USE_SFU_TRANSPORT = false;
    const DEFAULT_SIGNAL_URL = 'wss://herai-signaling.onrender.com/ws';
    const DEFAULT_ICE_SERVERS = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' }
    ];

    const joinPanel = document.getElementById('meetingJoinPanel');
    const meetingPage = document.getElementById('meetingPage');
    const roomPanel = document.getElementById('meetingRoomPanel');
    const nameInput = document.getElementById('meetingDisplayName');
    const roomInput = document.getElementById('meetingRoomCode');
    const previewPanel = document.getElementById('meetingPreviewPanel');
    const previewVideo = document.getElementById('meetingPreviewVideo');
    const previewName = document.getElementById('meetingPreviewName');
    const statusText = document.getElementById('meetingStatusText');
    const roomTitle = document.getElementById('meetingRoomTitle');
    const localVideo = document.getElementById('meetingLocalVideo');
    const remoteGrid = document.getElementById('meetingRemoteGrid');
    const localLabel = document.getElementById('meetingLocalLabel');
    const roomCodeBadge = document.getElementById('meetingRoomCodeBadge');
    const roomClock = document.getElementById('meetingRoomClock');
    const participantCount = document.getElementById('meetingParticipantCount');
    const navContainer = document.getElementById('navbar-container');
    const footerContainer = document.getElementById('footer-container');
    const chatPanel = document.getElementById('meetingChatPanel');
    const chatMessages = document.getElementById('meetingChatMessages');
    const chatInput = document.getElementById('meetingChatInput');
    const peoplePanel = document.getElementById('meetingPeoplePanel');
    const peopleList = document.getElementById('meetingPeopleList');
    const peopleSummary = document.getElementById('meetingPeopleSummary');
    const emojiFloat = document.getElementById('meetingEmojiFloat');
    const pageControls = document.getElementById('meetingPageControls');
    const pageInfo = document.getElementById('meetingPageInfo');
    const tileViewSelect = document.getElementById('meetingTileView');
    const backgroundSelect = document.getElementById('meetingBackgroundSelect');
    const shareButton = document.getElementById('btnShareMeetingScreen');
    const exitConfirm = document.getElementById('meetingExitConfirm');
    const exitTitle = document.getElementById('meetingExitTitle');
    const exitMessage = document.getElementById('meetingExitMessage');

    let localStream = null;
    let cameraStream = null;
    let screenStream = null;
    let screenTrack = null;
    let socket = null;
    let currentPage = 1;
    let pendingExitAction = null;
    let activeScreenOwner = null;
    let clockTimer = null;
    let meshAuditTimer = null;
    let meetingTransport = USE_SFU_TRANSPORT ? 'sfu' : 'p2p';
    let liveKitConfig = null;
    let liveKitRoom = null;
    let liveKitClientLoader = null;
    const liveKitRemoteStreams = new Map();
    let iceServers = [...DEFAULT_ICE_SERVERS];
    let audioContext = null;
    let localAudioMonitor = null;
    let sfuPc = null;
    const peers = new Map();
    const remoteScreenShares = new Map();
    const peerNames = new Map();
    const peerPresence = new Map();
    const pendingIceCandidates = new Map();
    const pendingJoinAnnouncements = new Set();
    const negotiationState = new Map();
    const peerRetryCounts = new Map();
    const peerAudioMonitors = new Map();
    const peerMediaWatchdogs = new Map();
    const pendingSfuIceCandidates = [];
    const sfuTrackMeta = new Map();
    const sfuStreamMeta = new Map();
    const clientId = getMeetingClientId();
    const localPresence = {
        id: clientId,
        name: '',
        mic: true,
        camera: true,
        hand: false,
        screen: false
    };
    let desiredMicEnabled = true;
    let desiredCameraEnabled = true;
    let sfuNegotiationInFlight = false;
    let sfuNegotiationQueued = false;
    let sfuRestartTimer = null;

    const params = new URLSearchParams((location.hash.split('?')[1] || ''));
    const roomFromLink = params.get('room');
    const titleFromLink = params.get('title') || '';
    const signalFromLink = params.get('signal') || localStorage.getItem('herai_meeting_signal_url') || DEFAULT_SIGNAL_URL;
    if (params.get('signal')) localStorage.setItem('herai_meeting_signal_url', signalFromLink);
    if (roomFromLink && roomInput) roomInput.value = sanitizeMeetingRoom(roomFromLink);
    if (nameInput && !nameInput.value) nameInput.value = localStorage.getItem('herai_meeting_name') || '';
    roomInput?.addEventListener('input', () => {
        roomInput.value = formatMeetingRoomCode(roomInput.value);
    });

    let statusResetTimer = null;
    const setStatus = (value, options = {}) => {
        if (statusText) statusText.textContent = value;
        if (options.resetToOngoing) {
            clearTimeout(statusResetTimer);
            statusResetTimer = setTimeout(() => {
                if (statusText) statusText.textContent = 'Pertemuan sedang berlangsung';
            }, options.delay || 1800);
        }
    };
    const peerDisplayName = (peerId) => peerPresence.get(peerId)?.name || peerNames.get(peerId) || 'Peserta';
    const announcePeerJoined = (peerId, fallbackName = '') => {
        const name = fallbackName || peerDisplayName(peerId);
        setStatus(`${name} telah bergabung`, { resetToOngoing: true });
        pendingJoinAnnouncements.delete(peerId);
    };
    const roomId = () => sanitizeMeetingRoom(roomInput?.value || '');
    const displayName = () => String(nameInput?.value || 'Peserta HerAI').trim() || 'Peserta HerAI';
    const signalUrl = () => {
        const url = new URL(signalFromLink);
        url.searchParams.set('room', roomId());
        url.searchParams.set('clientId', clientId);
        return url.toString();
    };
    const meetingApiBase = () => {
        const url = new URL(signalFromLink);
        url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
        url.pathname = '';
        url.search = '';
        url.hash = '';
        return url.toString().replace(/\/$/, '');
    };
    const sendSignal = (type, to, payload) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ type, room: roomId(), to, payload }));
    };
    const sendSFU = (type, payload) => sendSignal(type, '', payload);
    const buildLocalPresence = () => {
        localPresence.name = displayName();
        localPresence.mic = desiredMicEnabled && localStream?.getAudioTracks()[0]?.enabled !== false;
        localPresence.camera = desiredCameraEnabled && localStream?.getVideoTracks()[0]?.enabled !== false;
        localPresence.screen = Boolean(screenStream);
        return { ...localPresence };
    };
    const publishPresence = (to = '') => {
        const presence = buildLocalPresence();
        updateMeetingTilePresence(clientId, presence);
        renderPeopleList();
        if (meetingTransport === 'livekit') {
            updateLiveKitMetadata();
            return;
        }
        sendSignal('presence', to, presence);
    };
    const ensureMedia = async () => {
        if (localStream) return localStream;
        assertMediaSupport();
        const audioConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        const videoConstraints = {
            width: { ideal: 640, max: 960 },
            height: { ideal: 360, max: 540 },
            frameRate: { ideal: 15, max: 20 },
            facingMode: 'user'
        };
        const tracks = [];
        try {
            const fullStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: audioConstraints });
            localStream = fullStream;
        } catch (error) {
            try {
                const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
                tracks.push(...audioOnly.getAudioTracks());
            } catch (audioError) {
                console.warn('Mic tidak tersedia, lanjut tanpa audio lokal.', audioError);
            }
            try {
                const videoOnly = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
                tracks.push(...videoOnly.getVideoTracks());
            } catch (videoError) {
                console.warn('Kamera tidak tersedia, lanjut tanpa video lokal.', videoError);
            }
            if (tracks.length === 0) {
                throw error;
            }
            localStream = new MediaStream(tracks);
        }
        cameraStream = localStream;
        if (localVideo) localVideo.srcObject = localStream;
        if (previewVideo) previewVideo.srcObject = localStream;
        applyDesiredDeviceState();
        startLocalAudioMonitor();
        return localStream;
    };
    const closePeer = (peerId) => {
        const pc = peers.get(peerId);
        if (pc) pc.close();
        peers.delete(peerId);
        stopAudioMonitor(peerAudioMonitors.get(peerId));
        peerAudioMonitors.delete(peerId);
        clearTimeout(peerMediaWatchdogs.get(peerId));
        peerMediaWatchdogs.delete(peerId);
        pendingIceCandidates.delete(peerId);
        negotiationState.delete(peerId);
        peerRetryCounts.delete(peerId);
        [...sfuTrackMeta.entries()].forEach(([key, meta]) => {
            if (meta?.clientId === peerId) sfuTrackMeta.delete(key);
        });
        [...sfuStreamMeta.entries()].forEach(([key, meta]) => {
            if (meta?.clientId === peerId) sfuStreamMeta.delete(key);
        });
        remoteScreenShares.delete(peerId);
        peerPresence.delete(peerId);
        if (activeScreenOwner === peerId) activeScreenOwner = null;
        removeMeetingRemote(peerId);
        removeMeetingRemote(`${peerId}-screen`);
        renderPeopleList();
        renderEmptyRemoteIfNeeded();
    };
    const shouldOfferToPeer = (peerId) => clientId > peerId;
    const createPeer = (peerId) => {
        if (USE_SFU_TRANSPORT) return null;
        if (peers.has(peerId)) return peers.get(peerId);
        negotiationState.set(peerId, { makingOffer: false, ignoreOffer: false });
        const pc = new RTCPeerConnection({
            iceServers,
            bundlePolicy: 'max-bundle',
            iceCandidatePoolSize: 4
        });
        if (localStream) localStream.getTracks().forEach(track => configureSender(pc.addTrack(track, localStream), track));
        if (!localStream?.getAudioTracks().length) pc.addTransceiver('audio', { direction: 'recvonly' });
        if (!localStream?.getVideoTracks().length) pc.addTransceiver('video', { direction: 'recvonly' });
        if (screenStream) screenStream.getTracks().forEach(track => configureSender(pc.addTrack(track, screenStream), track));
        pc.ontrack = event => {
            const stream = event.streams[0];
            const shareMeta = remoteScreenShares.get(peerId);
            const isScreen = shareMeta?.streamId && shareMeta.streamId === stream?.id;
            renderMeetingRemote(peerId, stream, isScreen ? 'screen' : 'camera', shareMeta?.name);
            if (!isScreen) {
                clearTimeout(peerMediaWatchdogs.get(peerId));
                peerMediaWatchdogs.delete(peerId);
            }
            if (!isScreen) startRemoteAudioMonitor(peerId, stream);
        };
        pc.onicecandidate = event => {
            if (event.candidate) sendSignal('ice', peerId, event.candidate);
        };
        pc.onconnectionstatechange = () => {
            const name = peerDisplayName(peerId);
            const stateLabels = {
                connected: 'terhubung',
                connecting: 'sedang menghubungkan',
                disconnected: 'koneksi terputus',
                failed: 'gagal terhubung',
                closed: 'keluar dari room'
            };
            setStatus(`${name} ${stateLabels[pc.connectionState] || pc.connectionState}`);
            if (pc.connectionState === 'connected') peerRetryCounts.set(peerId, 0);
            if (pc.connectionState === 'failed') {
                retryPeerConnection(peerId);
                return;
            }
            if (pc.connectionState === 'closed') closePeer(peerId);
        };
        pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === 'failed') retryPeerConnection(peerId);
        };
        peers.set(peerId, pc);
        scheduleMediaWatchdog(peerId);
        updateTileLayout();
        return pc;
    };
    const configureSender = (sender, track) => {
        if (!sender?.getParameters || !sender?.setParameters || track?.kind !== 'video') return;
        try {
            const params = sender.getParameters();
            params.encodings = params.encodings?.length ? params.encodings : [{}];
            params.encodings[0].maxBitrate = 320000;
            params.encodings[0].maxFramerate = 15;
            sender.setParameters(params).catch(() => {});
        } catch (error) {
            console.warn('Tidak bisa mengatur bitrate video.', error);
        }
    };
    const scheduleMediaWatchdog = (peerId) => {
        clearTimeout(peerMediaWatchdogs.get(peerId));
        const timeoutId = setTimeout(() => {
            const safeId = String(peerId || '').replace(/[^a-zA-Z0-9_-]/g, '');
            const tile = document.getElementById(`meeting-remote-${safeId}`);
            const pc = peers.get(peerId);
            const hasMedia = tile && !tile.classList.contains('is-connecting') && tile.querySelector('video')?.srcObject;
            if (!pc || pc.connectionState === 'closed' || hasMedia) return;
            setStatus(`${peerDisplayName(peerId)} sedang disambungkan ulang`);
            sendSignal('media-reconnect', peerId, { name: displayName() });
            retryPeerConnection(peerId);
        }, 8500);
        peerMediaWatchdogs.set(peerId, timeoutId);
    };
    const createOffer = async (peerId, options = {}) => {
        const pc = createPeer(peerId);
        const state = negotiationState.get(peerId) || { makingOffer: false, ignoreOffer: false };
        try {
            state.makingOffer = true;
            negotiationState.set(peerId, state);
            const offer = await pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
                iceRestart: options.iceRestart === true
            });
            await pc.setLocalDescription(offer);
            sendSignal('offer', peerId, pc.localDescription);
        } finally {
            state.makingOffer = false;
        }
    };
    const addRemoteIceCandidate = async (peerId, candidatePayload) => {
        if (!candidatePayload) return;
        if (negotiationState.get(peerId)?.ignoreOffer) return;
        const pc = createPeer(peerId);
        const candidate = new RTCIceCandidate(candidatePayload);
        if (!pc.remoteDescription) {
            const queue = pendingIceCandidates.get(peerId) || [];
            queue.push(candidate);
            pendingIceCandidates.set(peerId, queue);
            return;
        }
        try {
            await pc.addIceCandidate(candidate);
        } catch (error) {
            console.warn('Gagal menambahkan ICE candidate', peerDisplayName(peerId), error);
        }
    };
    const flushRemoteIceCandidates = async (peerId) => {
        const pc = peers.get(peerId);
        const queue = pendingIceCandidates.get(peerId) || [];
        if (!pc?.remoteDescription || queue.length === 0) return;
        pendingIceCandidates.delete(peerId);
        for (const candidate of queue) {
            try {
                await pc.addIceCandidate(candidate);
            } catch (error) {
                console.warn('Gagal memproses pending ICE candidate', peerDisplayName(peerId), error);
            }
        }
    };
    const retryPeerConnection = async (peerId) => {
        const retryCount = peerRetryCounts.get(peerId) || 0;
        if (retryCount >= 2) {
            closePeer(peerId);
            return;
        }
        peerRetryCounts.set(peerId, retryCount + 1);
        try {
            peers.get(peerId)?.restartIce?.();
            await createOffer(peerId, { iceRestart: true });
        } catch (error) {
            console.warn('Gagal restart koneksi meeting', peerDisplayName(peerId), error);
        }
    };
    const ensurePeerReady = async (peerId, options = {}) => {
        if (!peerId || peerId === clientId) return;
        const knownName = peerDisplayName(peerId);
        ensureParticipantTile(peerId, knownName, peerPresence.get(peerId) || { id: peerId, name: knownName, mic: true, camera: true });
        if (meetingTransport === 'livekit' || USE_SFU_TRANSPORT) return;
        const pc = createPeer(peerId);
        if (!options.quiet) {
            sendSignal('peer-info', peerId, { name: displayName() });
            publishPresence(peerId);
        }
        const needsOffer = options.forceOffer || (!pc.currentLocalDescription && !pc.currentRemoteDescription && shouldOfferToPeer(peerId));
        if (needsOffer && pc.signalingState === 'stable') {
            const delay = options.delay ?? Math.floor(Math.random() * 700);
            setTimeout(() => {
                if (peers.get(peerId)?.signalingState === 'stable') createOffer(peerId).catch(error => {
                    console.warn('Gagal membuat offer audit mesh', peerDisplayName(peerId), error);
                });
            }, delay);
        }
    };
    const auditMesh = async (peerIds = []) => {
        const ids = peerIds.length ? peerIds : [...peerPresence.keys()];
        for (const peerId of ids) {
            await ensurePeerReady(peerId);
        }
    };
    const startMeshAudit = () => {
        stopMeshAudit();
        if (meetingTransport === 'livekit' || USE_SFU_TRANSPORT) return;
        meshAuditTimer = setInterval(() => {
            sendSignal('peer-list-request', '', { name: displayName() });
            publishPresence('');
            auditMesh().catch(error => console.warn('Audit mesh meeting gagal', error));
        }, 5000);
    };
    const stopMeshAudit = () => {
        if (meshAuditTimer) clearInterval(meshAuditTimer);
        meshAuditTimer = null;
    };
    const loadMeetingConfig = async () => {
        try {
            const response = await fetch(`${meetingApiBase()}/meeting-config`, { cache: 'no-store' });
            if (!response.ok) return;
            const config = await response.json();
            if (Array.isArray(config.iceServers) && config.iceServers.length > 0) {
                iceServers = config.iceServers;
            }
            if (config?.transport === 'livekit' && config?.livekit?.enabled && config?.livekit?.url) {
                meetingTransport = 'livekit';
                liveKitConfig = config.livekit;
            } else {
                meetingTransport = USE_SFU_TRANSPORT ? 'sfu' : 'p2p';
                liveKitConfig = null;
            }
        } catch (error) {
            console.warn('Memakai ICE server default.', error);
        }
    };
    const createSFUPeer = () => {
        if (sfuPc) return sfuPc;
        sfuPc = new RTCPeerConnection({
            iceServers,
            bundlePolicy: 'max-bundle',
            iceCandidatePoolSize: 4
        });
        if (localStream) localStream.getTracks().forEach(track => configureSender(sfuPc.addTrack(track, localStream), track));
        if (screenStream) screenStream.getTracks().forEach(track => configureSender(sfuPc.addTrack(track, screenStream), track));
        if (!localStream?.getAudioTracks().length) sfuPc.addTransceiver('audio', { direction: 'recvonly' });
        if (!localStream?.getVideoTracks().length) sfuPc.addTransceiver('video', { direction: 'recvonly' });
        sfuPc.onicecandidate = event => {
            if (event.candidate) sendSFU('sfu-ice', event.candidate.toJSON());
        };
        sfuPc.onnegotiationneeded = () => {
            negotiateSFU().catch(error => console.warn('Gagal menjalankan negosiasi SFU', error));
        };
        sfuPc.ontrack = event => {
            const stream = event.streams[0] || new MediaStream([event.track]);
            const meta = sfuTrackMeta.get(event.track.id) || sfuStreamMeta.get(stream.id) || null;
            const isScreen = meta?.source === 'screen' || stream.id?.endsWith(':screen');
            const ownerId = meta?.clientId || (isScreen ? stream.id.replace(/:screen$/, '') : (stream.id && stream.id !== '-' ? stream.id : `sfu-${event.track.id}`));
            if (ownerId === clientId) return;
            ensureParticipantTile(ownerId, peerDisplayName(ownerId), peerPresence.get(ownerId) || { id: ownerId, name: peerDisplayName(ownerId), mic: true, camera: true });
            const shareMeta = remoteScreenShares.get(ownerId);
            renderMeetingRemote(ownerId, stream, isScreen ? 'screen' : 'camera', shareMeta?.name);
            if (!isScreen) {
                clearTimeout(peerMediaWatchdogs.get(ownerId));
                peerMediaWatchdogs.delete(ownerId);
                startRemoteAudioMonitor(ownerId, stream);
            }
        };
        sfuPc.onconnectionstatechange = () => {
            if (sfuPc.connectionState === 'connected') setStatus('SFU terhubung');
            if (sfuPc.connectionState === 'failed') {
                setStatus('Koneksi SFU gagal, mencoba ulang');
                restartSFU({ recreate: true }).catch(error => console.warn('Gagal restart SFU', error));
            }
            if (sfuPc.connectionState === 'disconnected') {
                setStatus('Koneksi SFU sedang dipulihkan');
                clearTimeout(sfuRestartTimer);
                sfuRestartTimer = setTimeout(() => {
                    restartSFU().catch(error => console.warn('Gagal restart SFU', error));
                }, 2200);
            }
        };
        return sfuPc;
    };
    const negotiateSFU = async (options = {}) => {
        const pc = createSFUPeer();
        if (sfuNegotiationInFlight) {
            sfuNegotiationQueued = true;
            return;
        }
        if (pc.signalingState !== 'stable') {
            sfuNegotiationQueued = true;
            setTimeout(() => negotiateSFU().catch(error => console.warn('Retry negosiasi SFU gagal', error)), 260);
            return;
        }
        sfuNegotiationInFlight = true;
        try {
            const offer = await pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
                iceRestart: options.iceRestart === true
            });
            await pc.setLocalDescription(offer);
            sendSFU('sfu-offer', pc.localDescription);
        } finally {
            sfuNegotiationInFlight = false;
        }
    };
    const loadLiveKitClient = () => {
        if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
        if (liveKitClientLoader) return liveKitClientLoader;
        liveKitClientLoader = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js';
            script.async = true;
            script.onload = () => window.LivekitClient ? resolve(window.LivekitClient) : reject(new Error('LiveKit client tidak tersedia'));
            script.onerror = () => reject(new Error('Gagal memuat LiveKit client'));
            document.head.appendChild(script);
        });
        return liveKitClientLoader;
    };
    const updateLiveKitMetadata = () => {
        if (!liveKitRoom?.localParticipant?.setMetadata) return;
        liveKitRoom.localParticipant.setMetadata(JSON.stringify(buildLocalPresence())).catch(() => {});
    };
    const parseLiveKitPresence = (participant) => {
        try {
            const parsed = participant?.metadata ? JSON.parse(participant.metadata) : {};
            return {
                id: participant.identity,
                name: parsed.name || participant.name || participant.identity,
                mic: parsed.mic !== false,
                camera: parsed.camera !== false,
                hand: parsed.hand === true,
                screen: parsed.screen === true
            };
        } catch {
            return {
                id: participant.identity,
                name: participant.name || participant.identity,
                mic: true,
                camera: true,
                hand: false,
                screen: false
            };
        }
    };
    const applyLiveKitPresence = (participant) => {
        if (!participant?.identity || participant.identity === clientId) return;
        const presence = parseLiveKitPresence(participant);
        peerNames.set(participant.identity, presence.name);
        peerPresence.set(participant.identity, presence);
        if (presence.screen) activeScreenOwner = participant.identity;
        if (!presence.screen && activeScreenOwner === participant.identity) activeScreenOwner = null;
        ensureParticipantTile(participant.identity, presence.name, presence);
        updateMeetingTilePresence(participant.identity, presence);
        renderPeopleList();
    };
    const isLiveKitScreenPublication = (publication) => {
        const source = String(publication?.source || publication?.track?.source || '').toLowerCase();
        const name = String(publication?.trackName || publication?.name || '').toLowerCase();
        return source.includes('screen') || name.includes('screen') || name.includes('display');
    };
    const renderLiveKitTrack = (track, publication, participant) => {
        if (!track?.mediaStreamTrack || !participant?.identity || participant.identity === clientId) return;
        const isScreen = isLiveKitScreenPublication(publication);
        const streamKey = `${participant.identity}:${isScreen ? 'screen' : 'camera'}`;
        let stream = liveKitRemoteStreams.get(streamKey);
        if (!stream) {
            stream = new MediaStream();
            liveKitRemoteStreams.set(streamKey, stream);
        }
        const mediaTrack = track.mediaStreamTrack;
        if (!stream.getTracks().some(item => item.id === mediaTrack.id)) stream.addTrack(mediaTrack);
        const presence = peerPresence.get(participant.identity) || parseLiveKitPresence(participant);
        if (isScreen) activeScreenOwner = participant.identity;
        ensureParticipantTile(participant.identity, presence.name, presence);
        renderMeetingRemote(participant.identity, stream, isScreen ? 'screen' : 'camera', presence.name);
        if (!isScreen && mediaTrack.kind === 'audio') startRemoteAudioMonitor(participant.identity, stream);
    };
    const removeLiveKitTrack = (track, publication, participant) => {
        if (!participant?.identity) return;
        const isScreen = isLiveKitScreenPublication(publication);
        const streamKey = `${participant.identity}:${isScreen ? 'screen' : 'camera'}`;
        const stream = liveKitRemoteStreams.get(streamKey);
        if (stream && track?.mediaStreamTrack) stream.removeTrack(track.mediaStreamTrack);
        if (isScreen) {
            liveKitRemoteStreams.delete(streamKey);
            removeMeetingRemote(`${participant.identity}-screen`);
            if (activeScreenOwner === participant.identity) activeScreenOwner = null;
        }
    };
    const connectLiveKit = async () => {
        const LK = await loadLiveKitClient();
        const tokenResponse = await fetch(`${meetingApiBase()}/livekit-token?room=${encodeURIComponent(roomId())}&identity=${encodeURIComponent(clientId)}&name=${encodeURIComponent(displayName())}`, { cache: 'no-store' });
        const tokenData = await tokenResponse.json();
        if (!tokenResponse.ok || !tokenData?.token || !tokenData?.url) {
            throw new Error(tokenData?.message || 'Token LiveKit tidak tersedia');
        }
        liveKitRoom = new LK.Room({
            adaptiveStream: false,
            dynacast: true,
            publishDefaults: {
                videoEncoding: { maxBitrate: 900_000, maxFramerate: 24 },
                screenShareEncoding: { maxBitrate: 3_500_000, maxFramerate: 30 }
            }
        });
        const RoomEvent = LK.RoomEvent;
        liveKitRoom
            .on(RoomEvent.ParticipantConnected, participant => {
                applyLiveKitPresence(participant);
                setStatus(`${participant.name || participant.identity} telah bergabung`, { resetToOngoing: true });
            })
            .on(RoomEvent.ParticipantDisconnected, participant => {
                setStatus(`${peerDisplayName(participant.identity)} telah keluar`, { resetToOngoing: true });
                closePeer(participant.identity);
            })
            .on(RoomEvent.ParticipantMetadataChanged, (_metadata, participant) => applyLiveKitPresence(participant))
            .on(RoomEvent.TrackSubscribed, (track, publication, participant) => renderLiveKitTrack(track, publication, participant))
            .on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => removeLiveKitTrack(track, publication, participant))
            .on(RoomEvent.DataReceived, (payload, participant) => {
                try {
                    const message = JSON.parse(new TextDecoder().decode(payload));
                    if (message.type === 'chat') appendChatMessage(message.name || participant?.name || 'Peserta', message.text || '', message.at, false);
                    if (message.type === 'emoji') showFloatingEmoji(message.emoji || '👍');
                    if (message.type === 'screen-start' && participant?.identity !== clientId) {
                        activeScreenOwner = participant.identity;
                    }
                    if (message.type === 'screen-stop' && participant?.identity !== clientId && activeScreenOwner === participant.identity) {
                        activeScreenOwner = null;
                    }
                } catch (error) {
                    console.warn('Data meeting tidak bisa dibaca', error);
                }
            })
            .on(RoomEvent.Disconnected, () => setStatus('Koneksi meeting terputus'));
        await liveKitRoom.connect(tokenData.url, tokenData.token, { autoSubscribe: true });
        await liveKitRoom.localParticipant.setName(displayName()).catch(() => {});
        updateLiveKitMetadata();
        for (const track of localStream?.getTracks?.() || []) {
            track.enabled = track.kind === 'audio' ? desiredMicEnabled : desiredCameraEnabled;
            const source = track.kind === 'video' ? LK.Track.Source.Camera : LK.Track.Source.Microphone;
            const publication = await liveKitRoom.localParticipant.publishTrack(track, { source }).catch(error => {
                console.warn('Gagal publish track LiveKit', error);
                return null;
            });
            if (publication?.track) {
                const shouldEnable = track.kind === 'audio' ? desiredMicEnabled : desiredCameraEnabled;
                if (shouldEnable) publication.track.unmute?.();
                else publication.track.mute?.();
            }
        }
        syncPublishedDeviceState('audio', desiredMicEnabled);
        syncPublishedDeviceState('video', desiredCameraEnabled);
        liveKitRoom.remoteParticipants?.forEach(participant => {
            applyLiveKitPresence(participant);
            participant.trackPublications?.forEach(publication => {
                if (publication.track) renderLiveKitTrack(publication.track, publication, participant);
            });
        });
        setStatus('Pertemuan sedang berlangsung');
    };
    const disconnectLiveKit = () => {
        liveKitRemoteStreams.clear();
        if (liveKitRoom) {
            try { liveKitRoom.disconnect(); } catch {}
        }
        liveKitRoom = null;
    };
    const restartSFU = async (options = {}) => {
        clearTimeout(sfuRestartTimer);
        if (options.recreate && sfuPc) {
            try { sfuPc.close(); } catch {}
            sfuPc = null;
            pendingSfuIceCandidates.length = 0;
            sfuNegotiationInFlight = false;
            sfuNegotiationQueued = false;
        }
        if (!sfuPc) createSFUPeer();
        if (sfuPc.signalingState !== 'stable') {
            sfuNegotiationQueued = true;
            return;
        }
        sfuPc.restartIce?.();
        await negotiateSFU({ iceRestart: true });
    };
    const flushSFUIceCandidates = async () => {
        if (!sfuPc?.remoteDescription) return;
        while (pendingSfuIceCandidates.length) {
            const candidate = pendingSfuIceCandidates.shift();
            try {
                await sfuPc.addIceCandidate(candidate);
            } catch (error) {
                console.warn('Gagal menambahkan SFU ICE candidate', error);
            }
        }
    };
    const handleSignal = async (message) => {
        const { type, from, payload } = message;
        if (!from || from === clientId) return;
        if (type === 'peer-joined') {
            pendingJoinAnnouncements.add(from);
            setStatus('Peserta baru sedang bergabung...');
            await ensurePeerReady(from, { forceOffer: shouldOfferToPeer(from), quiet: true });
            sendSignal('peer-info', from, { name: displayName() });
            publishPresence(from);
            return;
        }
        if (type === 'peer-left') {
            setStatus(`${peerDisplayName(from)} telah keluar`, { resetToOngoing: true });
            closePeer(from);
            return;
        }
        if (type === 'screen-start') {
            activeScreenOwner = from;
            remoteScreenShares.set(from, {
                name: payload?.name || from.slice(0, 8),
                streamId: payload?.streamId || ''
            });
            renderMeetingRemoteShareLabel(from, payload?.name);
            return;
        }
        if (type === 'screen-stop') {
            remoteScreenShares.delete(from);
            if (activeScreenOwner === from) activeScreenOwner = null;
            removeMeetingRemote(`${from}-screen`);
            return;
        }
        if (type === 'peer-info') {
            const name = payload?.name || peerNames.get(from) || 'Peserta';
            peerNames.set(from, name);
            updateMeetingRemoteLabel(from);
            if (!peerPresence.has(from)) {
                peerPresence.set(from, {
                    id: from,
                    name,
                    mic: true,
                    camera: true,
                    hand: false,
                    screen: false
                });
            }
            ensureParticipantTile(from, name, peerPresence.get(from));
            await ensurePeerReady(from, { quiet: true });
            if (pendingJoinAnnouncements.has(from)) announcePeerJoined(from, name);
            renderPeopleList();
            return;
        }
        if (type === 'presence') {
            const nextPresence = {
                id: from,
                name: payload?.name || peerNames.get(from) || from.slice(0, 8),
                mic: payload?.mic !== false,
                camera: payload?.camera !== false,
                hand: payload?.hand === true,
                screen: payload?.screen === true
            };
            peerNames.set(from, nextPresence.name);
            peerPresence.set(from, nextPresence);
            ensureParticipantTile(from, nextPresence.name, nextPresence);
            await ensurePeerReady(from, { quiet: true });
            if (pendingJoinAnnouncements.has(from)) announcePeerJoined(from, nextPresence.name);
            updateMeetingRemoteLabel(from);
            updateMeetingTilePresence(from, nextPresence);
            renderPeopleList();
            return;
        }
        if (type === 'peer-list') {
            const peerIds = Array.isArray(payload?.peers) ? payload.peers : [];
            await auditMesh(peerIds);
            return;
        }
        if (type === 'sfu-answer') {
            const pc = createSFUPeer();
            if (pc.signalingState === 'have-local-offer') {
                await pc.setRemoteDescription(new RTCSessionDescription(payload));
                await flushSFUIceCandidates();
                if (sfuNegotiationQueued) {
                    sfuNegotiationQueued = false;
                    setTimeout(() => negotiateSFU().catch(error => console.warn('Negosiasi SFU tertunda gagal', error)), 80);
                }
            }
            return;
        }
        if (type === 'sfu-tracks-available') {
            const tracks = Array.isArray(payload?.tracks) ? payload.tracks : [];
            tracks.forEach(track => {
                if (!track?.clientId) return;
                if (track.trackId) sfuTrackMeta.set(track.trackId, track);
                if (track.streamId) sfuStreamMeta.set(track.streamId, track);
                ensureParticipantTile(track.clientId, peerDisplayName(track.clientId), peerPresence.get(track.clientId) || { id: track.clientId, name: peerDisplayName(track.clientId), mic: true, camera: true });
            });
            return;
        }
        if (type === 'sfu-offer') {
            const pc = createSFUPeer();
            if (pc.signalingState !== 'stable') {
                try { await pc.setLocalDescription({ type: 'rollback' }); } catch {}
            }
            await pc.setRemoteDescription(new RTCSessionDescription(payload));
            await flushSFUIceCandidates();
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendSFU('sfu-answer', pc.localDescription);
            if (sfuNegotiationQueued) {
                sfuNegotiationQueued = false;
                setTimeout(() => negotiateSFU().catch(error => console.warn('Negosiasi SFU tertunda gagal', error)), 80);
            }
            return;
        }
        if (type === 'sfu-ice') {
            const candidate = new RTCIceCandidate(payload);
            if (!sfuPc?.remoteDescription) {
                pendingSfuIceCandidates.push(candidate);
            } else {
                await sfuPc.addIceCandidate(candidate);
            }
            return;
        }
        if (type === 'media-reconnect') {
            if (USE_SFU_TRANSPORT) {
                await restartSFU();
            } else {
                setStatus(`${peerDisplayName(from)} meminta sinkron ulang media`);
                await createOffer(from, { iceRestart: true });
            }
            return;
        }
        if (USE_SFU_TRANSPORT && ['offer', 'answer', 'ice'].includes(type)) {
            return;
        }
        if (type === 'offer') {
            const pc = createPeer(from);
            const state = negotiationState.get(from) || { makingOffer: false, ignoreOffer: false };
            const offerCollision = state.makingOffer || pc.signalingState !== 'stable';
            const polite = clientId > from;
            state.ignoreOffer = !polite && offerCollision;
            negotiationState.set(from, state);
            if (state.ignoreOffer) return;
            if (offerCollision && pc.signalingState !== 'stable') {
                try {
                    await pc.setLocalDescription({ type: 'rollback' });
                } catch (error) {
                    console.warn('Rollback negotiation tidak tersedia', peerDisplayName(from), error);
                    return;
                }
            }
            await pc.setRemoteDescription(new RTCSessionDescription(payload));
            await flushRemoteIceCandidates(from);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendSignal('answer', from, pc.localDescription);
            return;
        }
        if (type === 'answer') {
            const pc = createPeer(from);
            if (pc.signalingState !== 'have-local-offer') return;
            await pc.setRemoteDescription(new RTCSessionDescription(payload));
            await flushRemoteIceCandidates(from);
            return;
        }
        if (type === 'ice') {
            await addRemoteIceCandidate(from, payload);
            return;
        }
        if (type === 'chat') {
            appendChatMessage(payload?.name || from.slice(0, 8), payload?.text || '', payload?.at, false);
            return;
        }
        if (type === 'emoji') {
            showFloatingEmoji(payload?.emoji || '👍');
        }
    };

    document.getElementById('btnJoinMeetingRoom')?.addEventListener('click', async () => {
        if (!roomId()) {
            alert('Masukkan kode room terlebih dahulu.');
            return;
        }
        try {
            localStorage.setItem('herai_meeting_name', displayName());
            await ensureMedia();
            if (previewName) previewName.textContent = displayName();
            previewPanel?.classList.remove('hidden');
            document.getElementById('btnJoinMeetingRoom')?.classList.add('hidden');
        } catch (error) {
            console.error(error);
            showMediaHelp(error);
        }
    });

    document.getElementById('btnEnterMeetingRoom')?.addEventListener('click', async () => {
        if (!roomId()) {
            alert('Masukkan kode room terlebih dahulu.');
            return;
        }
        try {
            localStorage.setItem('herai_meeting_name', displayName());
            await ensureMedia();
            if (localLabel) localLabel.textContent = displayName();
            if (roomTitle) roomTitle.textContent = titleFromLink || `Room ${roomId()}`;
            if (roomCodeBadge) roomCodeBadge.textContent = roomId();
            await loadMeetingConfig();
            if (navContainer) navContainer.style.display = 'none';
            if (footerContainer) footerContainer.style.display = 'none';
            joinPanel?.classList.add('hidden');
            roomPanel?.classList.remove('hidden');
            meetingPage?.classList.add('in-call');
            startMeetingClock();
            startMeshAudit();
            syncRoomDeviceButtons();
            publishPresence();
            if (meetingTransport === 'livekit') {
                setStatus('Menghubungkan ke meeting server...');
                await connectLiveKit();
            } else {
                socket = new WebSocket(signalUrl());
                setStatus('Menghubungkan ke room...');
                socket.onopen = () => setStatus('Terhubung ke signaling server');
                socket.onmessage = async event => {
                    const message = JSON.parse(event.data);
                    if (message.type === 'joined') {
                        const existingPeers = message.payload?.peers || [];
                        for (const peerId of existingPeers) await ensurePeerReady(peerId, { forceOffer: !USE_SFU_TRANSPORT, delay: Math.floor(Math.random() * 900) });
                        sendSignal('peer-info', '', { name: displayName() });
                        publishPresence('');
                        if (USE_SFU_TRANSPORT) await negotiateSFU();
                        setStatus('Pertemuan sedang berlangsung');
                        return;
                    }
                    await handleSignal(message);
                };
                socket.onclose = () => setStatus('Signaling server offline atau koneksi room terputus');
                socket.onerror = () => setStatus('Signaling server belum aktif atau tidak bisa dijangkau');
            }
        } catch (error) {
            console.error(error);
            showMediaHelp(error);
        }
    });

    document.getElementById('btnCancelMeetingPreview')?.addEventListener('click', () => {
        openExitConfirm('Batalkan preview?', 'Kamera dan mikrofon preview akan dimatikan.', resetPreview);
    });

    document.getElementById('btnCancelExitMeeting')?.addEventListener('click', closeExitConfirm);
    exitConfirm?.addEventListener('click', event => {
        if (event.target === exitConfirm) closeExitConfirm();
    });
    document.getElementById('btnConfirmExitMeeting')?.addEventListener('click', () => {
        const action = pendingExitAction;
        closeExitConfirm();
        if (typeof action === 'function') action();
    });

    document.getElementById('btnPreviewMic')?.addEventListener('click', event => {
        const enabled = toggleTrack('audio', undefined, event.currentTarget);
        setDeviceButtonState(event.currentTarget, enabled, 'microphone');
    });

    document.getElementById('btnPreviewCamera')?.addEventListener('click', event => {
        const enabled = toggleTrack('video', undefined, event.currentTarget);
        setDeviceButtonState(event.currentTarget, enabled, 'video');
    });

    document.getElementById('btnToggleMeetingMic')?.addEventListener('click', event => {
        const enabled = toggleTrack('audio', undefined, event.currentTarget);
        setDeviceButtonState(event.currentTarget, enabled, 'microphone');
        publishPresence();
    });

    document.getElementById('btnToggleMeetingCamera')?.addEventListener('click', event => {
        const enabled = toggleTrack('video', undefined, event.currentTarget);
        setDeviceButtonState(event.currentTarget, enabled, 'video');
        publishPresence();
    });

    backgroundSelect?.closest('.meeting-bg-control')?.remove();

    document.getElementById('btnRaiseMeetingHand')?.addEventListener('click', event => {
        localPresence.hand = !localPresence.hand;
        event.currentTarget?.classList.toggle('is-raised', localPresence.hand);
        event.currentTarget.title = localPresence.hand ? 'Lower Hand' : 'Raise Hand';
        publishPresence();
    });

    shareButton?.addEventListener('click', async () => {
        try {
            if (screenStream) {
                await stopScreenShare();
                return;
            }
            if (activeScreenOwner && activeScreenOwner !== clientId) {
                alert('Masih ada peserta lain yang sedang share screen. Tunggu sampai share screen dimatikan terlebih dahulu.');
                return;
            }
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
            screenTrack = screenStream.getVideoTracks()[0];
            activeScreenOwner = clientId;
            localPresence.screen = true;
            renderLocalScreenTile(screenStream);
            setShareButtonState(true);
            if (meetingTransport === 'livekit') {
                const LK = await loadLiveKitClient();
                try {
                    await liveKitRoom?.localParticipant?.publishTrack(screenTrack, {
                        name: 'screen-share',
                        source: LK.Track?.Source?.ScreenShare || 'screen_share'
                    });
                } catch (publishError) {
                    console.warn('LiveKit screen publish fallback', publishError);
                    try {
                        const localScreenTrack = LK.LocalVideoTrack ? new LK.LocalVideoTrack(screenTrack) : screenTrack;
                        await liveKitRoom?.localParticipant?.publishTrack(localScreenTrack, { name: 'screen-share', source: 'screen_share' });
                    } catch (fallbackError) {
                        await liveKitRoom?.localParticipant?.setScreenShareEnabled?.(true, { audio: false });
                        if (!liveKitRoom?.localParticipant?.isScreenShareEnabled) throw fallbackError;
                    }
                }
            } else if (USE_SFU_TRANSPORT) {
                configureSender(createSFUPeer().addTrack(screenTrack, screenStream), screenTrack);
                await negotiateSFU();
            } else {
                peers.forEach(pc => pc.addTrack(screenTrack, screenStream));
                await renegotiateAllPeers();
            }
            sendSignal('screen-start', '', { name: displayName(), streamId: screenStream.id });
            publishLiveKitMeetingData({ type: 'screen-start', name: displayName(), at: new Date().toISOString() });
            publishPresence();
            screenTrack.onended = async () => {
                await stopScreenShare();
            };
        } catch (error) {
            console.warn('Screen share cancelled', error);
            const cancelledByUser = ['AbortError', 'NotAllowedError', 'PermissionDeniedError'].includes(error?.name);
            if (screenStream) screenStream.getTracks().forEach(track => track.stop());
            screenStream = null;
            screenTrack = null;
            document.getElementById('meeting-local-screen')?.remove();
            activeScreenOwner = null;
            localPresence.screen = false;
            setShareButtonState(false);
            publishPresence();
            updateTileLayout();
            if (!cancelledByUser) {
                alert('Share screen gagal dipublish ke meeting server. Coba lagi atau pilih window/tab.');
            }
        }
    });

    document.getElementById('btnToggleMeetingChat')?.addEventListener('click', () => {
        chatPanel?.classList.toggle('open');
        syncSidePanels();
    });
    document.getElementById('btnCloseMeetingChat')?.addEventListener('click', () => {
        chatPanel?.classList.remove('open');
        syncSidePanels();
    });
    document.getElementById('btnToggleMeetingPeople')?.addEventListener('click', () => {
        peoplePanel?.classList.toggle('open');
        syncSidePanels();
        renderPeopleList();
    });
    document.getElementById('btnCloseMeetingPeople')?.addEventListener('click', () => {
        peoplePanel?.classList.remove('open');
        syncSidePanels();
    });
    document.getElementById('btnSendMeetingChat')?.addEventListener('click', sendChatMessage);
    chatInput?.addEventListener('keydown', event => {
        if (event.key === 'Enter') sendChatMessage();
    });
    document.querySelectorAll('.meeting-emoji').forEach(button => {
        button.addEventListener('click', () => {
            const emoji = button.dataset.emoji || '👍';
            if (meetingTransport === 'livekit' && liveKitRoom) {
                liveKitRoom.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: 'emoji', emoji, name: displayName() })), { reliable: true }).catch(() => {});
            } else {
                sendSignal('emoji', '', { emoji, name: displayName() });
            }
            showFloatingEmoji(emoji);
        });
    });
    document.getElementById('btnMeetingPrevPage')?.addEventListener('click', () => {
        currentPage = Math.max(1, currentPage - 1);
        updateTileLayout();
    });
    document.getElementById('btnMeetingNextPage')?.addEventListener('click', () => {
        currentPage += 1;
        updateTileLayout();
    });
    tileViewSelect?.addEventListener('change', () => {
        currentPage = 1;
        updateTileLayout();
    });

    document.getElementById('btnLeaveMeetingRoom')?.addEventListener('click', () => {
        openExitConfirm('Keluar dari meeting?', 'Kamera, mikrofon, dan koneksi room akan dimatikan.', leaveMeeting);
    });

    function leaveMeeting() {
        if (socket) socket.close();
        disconnectLiveKit();
        stopMeetingClock();
        stopMeshAudit();
        socket = null;
        if (sfuPc) sfuPc.close();
        sfuPc = null;
        clearTimeout(sfuRestartTimer);
        sfuRestartTimer = null;
        sfuNegotiationInFlight = false;
        sfuNegotiationQueued = false;
        pendingSfuIceCandidates.length = 0;
        peers.forEach(pc => pc.close());
        peers.clear();
        peerNames.clear();
        peerPresence.clear();
        sfuTrackMeta.clear();
        sfuStreamMeta.clear();
        remoteScreenShares.clear();
        peerAudioMonitors.forEach(stopAudioMonitor);
        peerAudioMonitors.clear();
        stopAudioMonitor(localAudioMonitor);
        localAudioMonitor = null;
        localPresence.hand = false;
        localPresence.screen = false;
        document.getElementById('btnRaiseMeetingHand')?.classList.remove('is-raised');
        activeScreenOwner = null;
        document.querySelectorAll('.meeting-remote-tile').forEach(tile => tile.remove());
        document.getElementById('meeting-local-screen')?.remove();
        renderEmptyRemoteIfNeeded();
        if (screenStream) screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
        screenTrack = null;
        activeScreenOwner = null;
        setShareButtonState(false);
        if (localStream) localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        cameraStream = null;
        if (localVideo) localVideo.srcObject = null;
        if (previewVideo) previewVideo.srcObject = null;
        roomPanel?.classList.add('hidden');
        joinPanel?.classList.remove('hidden');
        previewPanel?.classList.add('hidden');
        chatPanel?.classList.remove('open');
        peoplePanel?.classList.remove('open');
        document.getElementById('btnJoinMeetingRoom')?.classList.remove('hidden');
        meetingPage?.classList.remove('in-call', 'chat-open', 'people-open');
        syncSidePanels();
        if (navContainer) navContainer.style.display = 'block';
        if (footerContainer) footerContainer.style.display = 'block';
        setStatus('Menunggu koneksi...');
        renderPeopleList();
    }

    function ensureAudioContext() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
        return audioContext;
    }

    function startLocalAudioMonitor() {
        if (!localStream || localAudioMonitor) return;
        localAudioMonitor = startAudioMonitor(clientId, localStream, 'meetingLocalTile');
    }

    function startRemoteAudioMonitor(peerId, stream) {
        if (!stream?.getAudioTracks?.().length || peerAudioMonitors.has(peerId)) return;
        const safeId = String(peerId || '').replace(/[^a-zA-Z0-9_-]/g, '');
        const tileId = `meeting-remote-${safeId}`;
        peerAudioMonitors.set(peerId, startAudioMonitor(peerId, stream, tileId));
    }

    function startAudioMonitor(peerId, stream, tileId) {
        try {
            if (!stream?.getAudioTracks?.().length) return null;
            const context = ensureAudioContext();
            const analyser = context.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.72;
            const source = context.createMediaStreamSource(stream);
            source.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            let speakingFrames = 0;
            let quietFrames = 0;
            let rafId = 0;
            const tick = () => {
                analyser.getByteFrequencyData(data);
                const average = data.reduce((sum, value) => sum + value, 0) / data.length;
                const isSpeaking = average > 18;
                speakingFrames = isSpeaking ? speakingFrames + 1 : 0;
                quietFrames = isSpeaking ? 0 : quietFrames + 1;
                const shouldShow = speakingFrames >= 2 || (getMeetingTile(peerId, tileId)?.classList.contains('is-speaking') && quietFrames < 14);
                updateSpeakingState(peerId, tileId, shouldShow);
                rafId = requestAnimationFrame(tick);
            };
            rafId = requestAnimationFrame(tick);
            return { analyser, source, rafId, tileId, peerId };
        } catch (error) {
            console.warn('Audio monitor tidak aktif', peerDisplayName(peerId), error);
            return null;
        }
    }

    function stopAudioMonitor(monitor) {
        if (!monitor) return;
        if (monitor.rafId) cancelAnimationFrame(monitor.rafId);
        try { monitor.source?.disconnect?.(); } catch {}
        updateSpeakingState(monitor.peerId, monitor.tileId, false);
    }

    function getMeetingTile(peerId, tileId) {
        if (peerId === clientId) return document.getElementById('meetingLocalTile');
        return document.getElementById(tileId);
    }

    function updateSpeakingState(peerId, tileId, isSpeaking) {
        const tile = getMeetingTile(peerId, tileId);
        if (!tile) return;
        tile.classList.toggle('is-speaking', isSpeaking);
        let badge = tile.querySelector('.meeting-speaker-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'meeting-speaker-badge';
            badge.innerHTML = '<i class="fas fa-volume-high"></i> Speaking';
            tile.appendChild(badge);
        }
    }

    function toggleTrack(kind, forcedValue, button) {
        const enabled = typeof forcedValue === 'boolean'
            ? forcedValue
            : !(kind === 'audio' ? desiredMicEnabled : desiredCameraEnabled);
        if (kind === 'audio') desiredMicEnabled = enabled;
        if (kind === 'video') desiredCameraEnabled = enabled;
        const track = localStream?.getTracks().find(item => item.kind === kind);
        if (track) track.enabled = enabled;
        syncPublishedDeviceState(kind, enabled);
        if (kind === 'video') {
            document.getElementById('meetingLocalTile')?.classList.toggle('is-camera-off', !enabled);
            if (previewVideo) previewVideo.style.opacity = enabled ? '1' : '0';
        }
        syncDeviceButtons();
        if (button) button.disabled = true;
        window.setTimeout(() => {
            if (button) button.disabled = false;
            syncDeviceButtons();
        }, 140);
        return enabled;
    }

    function applyDesiredDeviceState() {
        localStream?.getAudioTracks().forEach(track => { track.enabled = desiredMicEnabled; });
        localStream?.getVideoTracks().forEach(track => { track.enabled = desiredCameraEnabled; });
        syncPublishedDeviceState('audio', desiredMicEnabled);
        syncPublishedDeviceState('video', desiredCameraEnabled);
        document.getElementById('meetingLocalTile')?.classList.toggle('is-camera-off', !desiredCameraEnabled);
        if (previewVideo) previewVideo.style.opacity = desiredCameraEnabled ? '1' : '0';
        syncDeviceButtons();
    }

    function syncDeviceButtons() {
        setDeviceButtonState(document.getElementById('btnPreviewMic'), desiredMicEnabled, 'microphone');
        setDeviceButtonState(document.getElementById('btnPreviewCamera'), desiredCameraEnabled, 'video');
        setDeviceButtonState(document.getElementById('btnToggleMeetingMic'), desiredMicEnabled, 'microphone');
        setDeviceButtonState(document.getElementById('btnToggleMeetingCamera'), desiredCameraEnabled, 'video');
    }

    function syncPublishedDeviceState(kind, enabled) {
        if (meetingTransport === 'livekit' && liveKitRoom?.localParticipant) {
            const publications = [
                ...Array.from(liveKitRoom.localParticipant.audioTrackPublications?.values?.() || []),
                ...Array.from(liveKitRoom.localParticipant.videoTrackPublications?.values?.() || [])
            ];
            publications.forEach(publication => {
                const source = String(publication?.source || publication?.track?.source || '').toLowerCase();
                const trackKind = publication?.track?.mediaStreamTrack?.kind || publication?.kind || '';
                const isTarget = kind === 'audio'
                    ? trackKind === 'audio' || source.includes('microphone')
                    : (trackKind === 'video' || source.includes('camera')) && !source.includes('screen');
                if (!isTarget) return;
                const track = publication.track;
                track?.mediaStreamTrack && (track.mediaStreamTrack.enabled = enabled);
                if (enabled) track?.unmute?.();
                else track?.mute?.();
            });
        }
        const senderKind = kind === 'audio' ? 'audio' : 'video';
        [...peers.values(), sfuPc].filter(Boolean).forEach(pc => {
            pc.getSenders?.().forEach(sender => {
                if (sender.track?.kind === senderKind && sender.track !== screenTrack) {
                    sender.track.enabled = enabled;
                }
            });
        });
    }

    function assertMediaSupport() {
        if (!window.isSecureContext) {
            throw new Error('INSECURE_CONTEXT');
        }
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('MEDIA_DEVICES_UNSUPPORTED');
        }
    }

    function showMediaHelp(error) {
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        const reason = error?.name || error?.message || 'UNKNOWN';
        let message = 'Tidak bisa membuka kamera/mikrofon. Pastikan permission browser diizinkan.';
        if (reason === 'INSECURE_CONTEXT') {
            message = 'Safari hanya menampilkan izin kamera/mikrofon di HTTPS. Gunakan link ngrok HTTPS, bukan http atau file lokal.';
        } else if (reason === 'MEDIA_DEVICES_UNSUPPORTED') {
            message = 'Browser ini belum mendukung akses kamera/mikrofon untuk halaman meeting.';
        } else if (['NotAllowedError', 'PermissionDeniedError'].includes(reason)) {
            message = isSafari
                ? 'Safari memblokir kamera/mikrofon. Buka Safari Settings > Websites > Camera dan Microphone, lalu izinkan untuk domain meeting ini.'
                : 'Kamera/mikrofon diblokir. Klik ikon permission di address bar lalu pilih Allow.';
        } else if (['NotFoundError', 'DevicesNotFoundError'].includes(reason)) {
            message = 'Kamera atau mikrofon tidak ditemukan. Pastikan perangkat tersambung dan tidak sedang dipakai aplikasi lain.';
        }
        alert(message);
    }

    function setDeviceButtonState(button, enabled, kind) {
        const icon = button?.querySelector('i');
        if (icon) {
            icon.className = enabled
                ? `fas fa-${kind}`
                : `fas fa-${kind}-slash`;
        }
        button?.classList.toggle('is-off', !enabled);
    }

    function resetPreview() {
        if (localStream) localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        cameraStream = null;
        if (previewVideo) previewVideo.srcObject = null;
        if (localVideo) localVideo.srcObject = null;
        previewPanel?.classList.add('hidden');
        document.getElementById('btnJoinMeetingRoom')?.classList.remove('hidden');
        resetDeviceButtons();
    }

    function resetDeviceButtons() {
        desiredMicEnabled = true;
        desiredCameraEnabled = true;
        syncDeviceButtons();
    }

    function syncRoomDeviceButtons() {
        applyDesiredDeviceState();
        updateMeetingTilePresence(clientId, buildLocalPresence());
        renderPeopleList();
    }

    function startMeetingClock() {
        stopMeetingClock();
        const tick = () => {
            if (roomClock) roomClock.textContent = formatMeetingTime(new Date().toISOString());
        };
        tick();
        clockTimer = setInterval(tick, 1000);
    }

    function stopMeetingClock() {
        if (clockTimer) clearInterval(clockTimer);
        clockTimer = null;
    }

    function syncSidePanels() {
        const chatOpen = chatPanel?.classList.contains('open') === true;
        const peopleOpen = peoplePanel?.classList.contains('open') === true;
        meetingPage?.classList.toggle('chat-open', chatOpen);
        meetingPage?.classList.toggle('people-open', peopleOpen);
        meetingPage?.classList.toggle('side-panels-open', chatOpen || peopleOpen);
        meetingPage?.classList.toggle('side-panels-split', chatOpen && peopleOpen);
    }

    function renderPeopleList() {
        if (!peopleList || !peopleSummary) return;
        const participants = [
            { ...buildLocalPresence(), local: true },
            ...[...peerPresence.values()].map(item => ({ ...item, local: false }))
        ].sort((a, b) => {
            if (a.local) return -1;
            if (b.local) return 1;
            if (a.hand !== b.hand) return a.hand ? -1 : 1;
            return String(a.name || '').localeCompare(String(b.name || ''));
        });

        peopleSummary.textContent = `${participants.length} participant${participants.length === 1 ? '' : 's'}`;
        if (participantCount) participantCount.innerHTML = `<i class="fas fa-users"></i> ${participants.length}`;
        peopleList.innerHTML = participants.map(person => {
            const name = person.local ? `${person.name || 'Kamu'} (You)` : person.name || 'Peserta';
            const initials = getMeetingInitials(person.name || 'P');
            const detail = person.hand ? 'Raise hand' : 'In meeting';
            return `
                <div class="meeting-person-row">
                    <div class="meeting-person-avatar">${escapeMeetingHtml(initials)}</div>
                    <div class="meeting-person-main">
                        <strong>${escapeMeetingHtml(name)}</strong>
                        <span>${escapeMeetingHtml(detail)}</span>
                    </div>
                    <div class="meeting-person-state">
                        ${person.hand ? '<i class="fas fa-hand-paper is-hand" title="Raise hand"></i>' : ''}
                        <i class="fas ${person.camera ? 'fa-video' : 'fa-video-slash is-off'}" title="${person.camera ? 'Camera on' : 'Camera off'}"></i>
                        <i class="fas ${person.mic ? 'fa-microphone' : 'fa-microphone-slash is-off'}" title="${person.mic ? 'Mic on' : 'Mic off'}"></i>
                    </div>
                </div>
            `;
        }).join('');
    }

    function ensureParticipantTile(peerId, name = 'Peserta', presence = {}) {
        if (!remoteGrid) return;
        const safeId = String(peerId || '').replace(/[^a-zA-Z0-9_-]/g, '');
        const tileId = `meeting-remote-${safeId}`;
        if (document.getElementById(tileId)) return;
        const tile = document.createElement('div');
        tile.id = tileId;
        tile.className = 'meeting-remote-tile is-connecting is-camera-off';
        tile.innerHTML = `
            <video autoplay playsinline></video>
            <div class="meeting-video-initial">${escapeMeetingHtml(getMeetingInitials(name).slice(0, 1))}</div>
            <span>${escapeMeetingHtml(name)} sedang menghubungkan</span>
            <button class="meeting-pin-btn" data-pin-tile="${tileId}" title="Pin"><i class="fas fa-thumbtack"></i></button>
        `;
        remoteGrid.appendChild(tile);
        updateMeetingTilePresence(peerId, { ...presence, name, camera: presence.camera === true });
        bindPinButtons();
        updateTileLayout();
    }

    function openExitConfirm(title, message, action) {
        pendingExitAction = action;
        if (exitTitle) exitTitle.textContent = title;
        if (exitMessage) exitMessage.textContent = message;
        exitConfirm?.classList.remove('hidden');
    }

    function closeExitConfirm() {
        pendingExitAction = null;
        exitConfirm?.classList.add('hidden');
    }

    async function stopScreenShare() {
        if (!screenStream && !screenTrack) return;
        if (screenTrack) {
            if (meetingTransport === 'livekit' && liveKitRoom) {
                await liveKitRoom.localParticipant.unpublishTrack(screenTrack).catch(() => {});
                await liveKitRoom.localParticipant.setScreenShareEnabled?.(false).catch(() => {});
            } else if (USE_SFU_TRANSPORT && sfuPc) {
                const sender = sfuPc.getSenders().find(item => item.track === screenTrack);
                if (sender) sfuPc.removeTrack(sender);
            } else {
                peers.forEach(pc => {
                    const sender = pc.getSenders().find(item => item.track === screenTrack);
                    if (sender) pc.removeTrack(sender);
                });
            }
        }
        if (screenStream) screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
        screenTrack = null;
        document.getElementById('meeting-local-screen')?.remove();
        sendSignal('screen-stop', '', { name: displayName() });
        publishLiveKitMeetingData({ type: 'screen-stop', name: displayName(), at: new Date().toISOString() });
        activeScreenOwner = null;
        localPresence.screen = false;
        setShareButtonState(false);
        publishPresence();
        if (meetingTransport === 'livekit') updateLiveKitMetadata();
        else if (USE_SFU_TRANSPORT) await negotiateSFU();
        else await renegotiateAllPeers();
        updateTileLayout();
    }

    function sendChatMessage() {
        const text = chatInput?.value.trim();
        if (!text) return;
        const payload = { name: displayName(), text, at: new Date().toISOString() };
        appendChatMessage(payload.name, payload.text, payload.at, true);
        if (meetingTransport === 'livekit' && liveKitRoom) {
            publishLiveKitMeetingData({ type: 'chat', ...payload });
        } else {
            sendSignal('chat', '', payload);
        }
        chatInput.value = '';
    }

    function publishLiveKitMeetingData(payload) {
        if (meetingTransport !== 'livekit' || !liveKitRoom || !payload) return;
        liveKitRoom.localParticipant
            .publishData(new TextEncoder().encode(JSON.stringify(payload)), { reliable: true })
            .catch(() => {});
    }

    function appendChatMessage(name, text, at, isOwn = false) {
        if (!chatMessages) return;
        const item = document.createElement('div');
        item.className = `meeting-chat-message${isOwn ? ' is-own' : ''}`;
        item.innerHTML = `
            <div class="meeting-chat-bubble">
                <strong>${escapeMeetingHtml(isOwn ? 'Kamu' : name)}</strong>
                <span>${linkifyMeetingText(text)}</span>
            </div>
            <span class="meeting-chat-meta">${formatMeetingTime(at)}</span>
        `;
        chatMessages.appendChild(item);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function showFloatingEmoji(emoji) {
        if (!emojiFloat) return;
        const item = document.createElement('span');
        item.className = 'meeting-floating-emoji';
        item.textContent = emoji;
        item.style.left = `${20 + Math.random() * 60}%`;
        emojiFloat.appendChild(item);
        setTimeout(() => item.remove(), 1900);
    }

    function renderLocalScreenTile(stream) {
        if (!remoteGrid) return;
        remoteGrid.querySelector('.meeting-empty-remote')?.remove();
        let tile = document.getElementById('meeting-local-screen');
        if (!tile) {
            tile = document.createElement('div');
            tile.id = 'meeting-local-screen';
            tile.className = 'meeting-video-tile is-screen is-pinned';
            tile.innerHTML = `
                <video autoplay muted playsinline></video>
                <span>${escapeMeetingHtml(displayName())} sedang share screen</span>
                <button class="meeting-pin-btn is-active" data-pin-tile="meeting-local-screen" title="Pin"><i class="fas fa-thumbtack"></i></button>
            `;
            remoteGrid.appendChild(tile);
        }
        const video = tile.querySelector('video');
        if (video) {
            video.srcObject = stream;
            setMeetingScreenAspect(tile, stream);
        }
        bindPinButtons();
        updateTileLayout();
    }

    async function renegotiateAllPeers() {
        for (const peerId of peers.keys()) {
            await createOffer(peerId);
        }
    }

    function setShareButtonState(isSharing) {
        if (!shareButton) return;
        const icon = shareButton.querySelector('i');
        shareButton.classList.toggle('is-sharing', isSharing);
        if (icon) icon.className = isSharing ? 'fas fa-stop-circle' : 'fas fa-display';
        shareButton.title = isSharing ? 'Matikan Share Screen' : 'Share Screen';
    }

    function bindPinButtons() {
        document.querySelectorAll('.meeting-pin-btn').forEach(button => {
            if (button.dataset.bound === 'true') return;
            button.dataset.bound = 'true';
            button.addEventListener('click', event => {
                event.stopPropagation();
                togglePinnedTile(button.dataset.pinTile);
            });
        });
    }

    function togglePinnedTile(tileId) {
        const tile = document.getElementById(tileId);
        if (!tile) return;
        const willPin = !tile.classList.contains('is-pinned');
        document.querySelectorAll('#meetingRemoteGrid .is-pinned').forEach(item => item.classList.remove('is-pinned'));
        document.querySelectorAll('.meeting-pin-btn.is-active').forEach(item => item.classList.remove('is-active'));
        if (willPin) {
            tile.classList.add('is-pinned');
            tile.querySelector('.meeting-pin-btn')?.classList.add('is-active');
        }
        updateTileLayout();
    }

    function updateTileLayout() {
        const tiles = [...document.querySelectorAll('#meetingRemoteGrid .meeting-video-tile, #meetingRemoteGrid .meeting-remote-tile')];
        document.getElementById('meeting-overflow-tile')?.remove();
        const requested = tileViewSelect?.value || 'auto';
        const isCompactViewport = window.matchMedia?.('(max-width: 860px)')?.matches === true;
        const pageSize = requested === 'auto' ? 50 : Number(requested) || 50;
        const totalPages = Math.max(1, Math.ceil(tiles.length / pageSize));
        if (currentPage > totalPages) currentPage = totalPages;
        const start = (currentPage - 1) * pageSize;
        const end = start + pageSize;
        const hasScreenShare = Boolean(remoteGrid?.querySelector('.is-screen'));
        let visibleCount = Math.min(pageSize, Math.max(1, tiles.length - start));
        if (hasScreenShare) {
            const screenTiles = tiles.filter(tile => tile.classList.contains('is-screen'));
            const cameraTiles = tiles.filter(tile => !tile.classList.contains('is-screen'));
            const maxRailTiles = isCompactViewport ? 5 : 6;
            const railCountBeforeOverflow = Math.min(cameraTiles.length, maxRailTiles);
            const hiddenCount = Math.max(0, cameraTiles.length - maxRailTiles);
            const railCount = railCountBeforeOverflow + (hiddenCount > 0 ? 1 : 0);
            const railCols = !isCompactViewport && railCount > 3 ? 2 : 1;
            cameraTiles.forEach((tile, index) => {
                tile.style.display = index < maxRailTiles ? '' : 'none';
                tile.classList.remove('is-pinned');
                tile.querySelector('.meeting-pin-btn')?.classList.remove('is-active');
                tile.dataset.railCol = String((index % railCols) + 1);
            });
            screenTiles.forEach(tile => {
                tile.style.display = '';
                tile.classList.add('is-pinned');
            });
            if (hiddenCount > 0 && remoteGrid) {
                const summaryTile = document.createElement('div');
                summaryTile.id = 'meeting-overflow-tile';
                summaryTile.className = 'meeting-overflow-tile';
                summaryTile.dataset.railCol = String(((railCount - 1) % railCols) + 1);
                summaryTile.innerHTML = `<strong>+${hiddenCount}</strong><span>peserta lainnya</span>`;
                remoteGrid.appendChild(summaryTile);
            }
            visibleCount = screenTiles.length + railCount;
            remoteGrid?.style.setProperty('--meeting-rail-rows', String(Math.max(1, Math.ceil(railCount / railCols))));
            if (remoteGrid) remoteGrid.dataset.railCols = String(railCols);
        } else {
            tiles.forEach((tile, index) => {
                tile.style.display = index >= start && index < end ? '' : 'none';
                delete tile.dataset.railCol;
            });
            remoteGrid?.style.removeProperty('--meeting-rail-rows');
            if (remoteGrid) {
                delete remoteGrid.dataset.railCols;
                delete remoteGrid.dataset.screenTall;
            }
        }
        if (remoteGrid) {
            remoteGrid.classList.toggle('has-screen-share', hasScreenShare);
            remoteGrid.classList.toggle('has-pinned-tile', Boolean(remoteGrid.querySelector('.is-pinned:not(.is-screen)')));
            remoteGrid.dataset.count = String(Math.min(visibleCount, 50));
            remoteGrid.dataset.density = visibleCount > 20 ? 'dense' : visibleCount > 8 ? 'medium' : 'roomy';
            const cols = getMeetingColumnCount(visibleCount, isCompactViewport);
            const effectiveCols = cols;
            const rowCount = hasScreenShare
                ? Math.max(1, Math.ceil(Math.max(1, visibleCount - 1) / (isCompactViewport ? 2 : 1)))
                : getMeetingRowCount(visibleCount, effectiveCols, isCompactViewport);
            remoteGrid.style.setProperty('--meeting-cols', String(cols));
            remoteGrid.style.setProperty('--meeting-rows', String(rowCount));
        }
        if (pageControls) pageControls.classList.toggle('active', totalPages > 1);
        if (pageInfo) pageInfo.textContent = `${currentPage} / ${totalPages}`;
    }

    window.__HERAI_MEETING_UPDATE_LAYOUT__ = updateTileLayout;
    window.__HERAI_BIND_MEETING_PINS__ = bindPinButtons;
    window.__HERAI_MEETING_PEER_NAMES__ = peerNames;
    window.__HERAI_MEETING_PEER_PRESENCE__ = peerPresence;
    window.__HERAI_MEETING_LOCAL_PRESENCE__ = localPresence;
    let meetingResizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(meetingResizeTimer);
        meetingResizeTimer = setTimeout(updateTileLayout, 120);
    });
    bindPinButtons();
    renderPeopleList();
    syncSidePanels();

    function getMeetingColumnCount(count, isCompact = false) {
        if (isCompact) {
            if (count <= 2) return 1;
            if (count <= 4) return 2;
            if (count <= 9) return 3;
            if (count <= 16) return 4;
            if (count <= 25) return 5;
            if (count <= 36) return 6;
            return 7;
        }
        if (count <= 1) return 1;
        if (count <= 4) return 2;
        if (count <= 9) return 3;
        if (count <= 12) return 4;
        if (count <= 15) return 5;
        return 6;
    }

    function getMeetingRowCount(count, cols, isCompact = false) {
        if (isCompact && count === 2) return 2;
        return Math.max(1, Math.ceil(count / Math.max(1, cols)));
    }
};

function getMeetingClientId() {
    return crypto.randomUUID ? crypto.randomUUID() : `guest-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeMeetingRoom(value) {
    return formatMeetingRoomCode(value);
}

function formatMeetingRoomCode(value) {
    const compact = String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .replace(/-/g, '')
        .toUpperCase()
        .slice(0, 12);
    return compact.match(/.{1,4}/g)?.join('-') || '';
}

function setMeetingScreenAspect(tile, stream) {
    if (!tile || !stream) return;
    const grid = document.getElementById('meetingRemoteGrid');
    const track = stream.getVideoTracks?.()[0];
    const settings = track?.getSettings?.() || {};
    const video = tile.querySelector('video');
    const applyAspect = () => {
        const width = Number(video?.videoWidth || settings.width || 16);
        const height = Number(video?.videoHeight || settings.height || 9);
        if (!width || !height) return;
        tile.style.setProperty('--meeting-screen-aspect', `${width} / ${height}`);
        grid?.style.setProperty('--meeting-screen-aspect', `${width} / ${height}`);
        if (grid) grid.dataset.screenTall = String(height > width);
    };
    applyAspect();
    if (video) video.onloadedmetadata = applyAspect;
}

function renderMeetingRemote(peerId, stream, type = 'camera', displayName = '') {
    const remoteGrid = document.getElementById('meetingRemoteGrid');
    if (!remoteGrid) return;
    remoteGrid.querySelector('.meeting-empty-remote')?.remove();
    const safeId = peerId.replace(/[^a-zA-Z0-9_-]/g, '');
    const tileId = type === 'screen' ? `meeting-remote-${safeId}-screen` : `meeting-remote-${safeId}`;
    let tile = document.getElementById(tileId);
    if (!tile) {
        tile = document.createElement('div');
        tile.id = tileId;
        tile.className = `meeting-remote-tile${type === 'screen' ? ' is-screen is-pinned' : ''}`;
        const label = type === 'screen'
            ? `${displayName || peerId.slice(0, 8)} sedang share screen`
            : getMeetingPeerName(peerId);
        tile.innerHTML = `
            <video autoplay playsinline></video>
            <div class="meeting-video-initial">${escapeMeetingHtml(getMeetingInitials(label).slice(0, 1))}</div>
            <span>${escapeMeetingHtml(label)}</span>
            <button class="meeting-pin-btn${type === 'screen' ? ' is-active' : ''}" data-pin-tile="${tileId}" title="Pin"><i class="fas fa-thumbtack"></i></button>
        `;
        remoteGrid.appendChild(tile);
    }
    if (type !== 'screen') {
        tile.classList.remove('is-connecting', 'is-camera-off');
        const label = tile.querySelector('span');
        const name = getMeetingPeerName(peerId);
        if (label) label.textContent = name;
        const initial = tile.querySelector('.meeting-video-initial');
        if (initial) initial.textContent = getMeetingInitials(name).slice(0, 1);
    }
    if (type === 'screen') {
        tile.classList.add('is-screen', 'is-pinned');
        const label = tile.querySelector('span');
        if (label) label.textContent = `${displayName || peerId.slice(0, 8)} sedang share screen`;
    }
    const video = tile.querySelector('video');
    if (video) {
        video.srcObject = stream;
        if (type === 'screen') setMeetingScreenAspect(tile, stream);
    }
    const presence = window.__HERAI_MEETING_PEER_PRESENCE__?.get(peerId);
    if (presence) updateMeetingTilePresence(peerId, presence);
    bindMeetingPinButtons();
    updateMeetingTiles();
}

function updateMeetingRemoteLabel(peerId) {
    const safeId = peerId.replace(/[^a-zA-Z0-9_-]/g, '');
    const tile = document.getElementById(`meeting-remote-${safeId}`);
    const label = tile?.querySelector('span');
    if (label) label.textContent = getMeetingPeerName(peerId);
}

function getMeetingPeerName(peerId) {
    const names = window.__HERAI_MEETING_PEER_NAMES__;
    return names?.get(peerId) || peerId.slice(0, 8);
}

function updateMeetingTilePresence(peerId, presence = {}) {
    const localPresence = window.__HERAI_MEETING_LOCAL_PRESENCE__;
    const safeId = String(peerId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const tile = peerId === localPresence?.id
        ? document.getElementById('meetingLocalTile')
        : document.getElementById(`meeting-remote-${safeId}`);
    if (!tile) return;

    tile.classList.toggle('is-hand-raised', presence.hand === true);
    tile.classList.toggle('is-camera-off', presence.camera === false);

    const name = presence.name || getMeetingPeerName(peerId);
    let initial = tile.querySelector('.meeting-video-initial');
    if (!initial) {
        initial = document.createElement('div');
        initial.className = 'meeting-video-initial';
        tile.appendChild(initial);
    }
    initial.textContent = getMeetingInitials(name).slice(0, 1);

    let hand = tile.querySelector('.meeting-hand-badge');
    if (!hand) {
        hand = document.createElement('div');
        hand.className = 'meeting-hand-badge';
        tile.appendChild(hand);
    }
    hand.innerHTML = '<i class="fas fa-hand-paper"></i> Raise hand';
    hand.style.display = presence.hand ? 'inline-flex' : 'none';

    let mic = tile.querySelector('.meeting-mic-badge');
    if (!mic) {
        mic = document.createElement('div');
        mic.className = 'meeting-mic-badge';
        tile.appendChild(mic);
    }
    mic.innerHTML = '<i class="fas fa-microphone-slash"></i>';
    mic.style.display = presence.mic === false ? 'inline-flex' : 'none';
}

function renderMeetingRemoteShareLabel(peerId, displayName = '') {
    const safeId = peerId.replace(/[^a-zA-Z0-9_-]/g, '');
    const tile = document.getElementById(`meeting-remote-${safeId}-screen`);
    const label = tile?.querySelector('span');
    if (label) label.textContent = `${displayName || peerId.slice(0, 8)} sedang share screen`;
}

function removeMeetingRemote(peerId) {
    const safeId = peerId.replace(/[^a-zA-Z0-9_-]/g, '');
    document.getElementById(`meeting-remote-${safeId}`)?.remove();
    updateMeetingTiles();
}

function renderEmptyRemoteIfNeeded() {
    const remoteGrid = document.getElementById('meetingRemoteGrid');
    remoteGrid?.querySelector('.meeting-empty-remote')?.remove();
    updateMeetingTiles();
}

function updateMeetingTiles() {
    if (typeof window.__HERAI_MEETING_UPDATE_LAYOUT__ === 'function') {
        window.__HERAI_MEETING_UPDATE_LAYOUT__();
        return;
    }
    const remoteGrid = document.getElementById('meetingRemoteGrid');
    if (!remoteGrid) return;
    const tiles = remoteGrid.querySelectorAll('.meeting-video-tile, .meeting-remote-tile');
    remoteGrid.dataset.count = String(Math.max(1, Math.min(tiles.length, 16)));
}

function bindMeetingPinButtons() {
    if (typeof window.__HERAI_BIND_MEETING_PINS__ === 'function') {
        window.__HERAI_BIND_MEETING_PINS__();
    }
}

function formatMeetingTime(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function getMeetingInitials(value) {
    const words = String(value || 'P').trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'P';
}

function escapeMeetingHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char]));
}

function linkifyMeetingText(value) {
    const escaped = escapeMeetingHtml(value);
    const urlPattern = /\b((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?")\]])/gi;
    return escaped.replace(urlPattern, match => {
        const href = match.toLowerCase().startsWith('http') ? match : `https://${match}`;
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${match}</a>`;
    });
}
