package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	inlivesfu "github.com/inlivedev/sfu"
	"github.com/pion/webrtc/v4"
)

type SignalMessage struct {
	Type    string          `json:"type"`
	Room    string          `json:"room,omitempty"`
	From    string          `json:"from,omitempty"`
	To      string          `json:"to,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type Client struct {
	id             string
	room           string
	hub            *Hub
	conn           *websocket.Conn
	send           chan SignalMessage
	pcMu           sync.Mutex
	pc             *webrtc.PeerConnection
	senders        map[string]*webrtc.RTPSender
	pendingICE     []webrtc.ICECandidateInit
	sfuClient      *inlivesfu.Client
	sfuAnswerChan  chan webrtc.SessionDescription
	stateMu        sync.RWMutex
	screenActive   bool
	screenStreamID string
	negotiationMu  sync.Mutex
	negotiateTimer *time.Timer
	closed         bool
}

type Room struct {
	clients map[string]*Client
	sfuRoom *inlivesfu.Room
	tracks  map[string]*PublishedTrack
}

type PublishedTrack struct {
	id    string
	owner string
	kind  string
	track *webrtc.TrackLocalStaticRTP
}

type RoomInfo struct {
	Room    string   `json:"room"`
	Clients int      `json:"clients"`
	Peers   []string `json:"peers"`
}

type Hub struct {
	mu      sync.RWMutex
	ctx     context.Context
	manager *inlivesfu.Manager
	rooms   map[string]*Room
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func main() {
	defaultPort := getenv("PORT", "8080")
	addr := flag.String("addr", ":"+defaultPort, "HTTP listen address")
	flag.Parse()

	ctx := context.Background()
	sfuOptions := inlivesfu.DefaultOptions()
	sfuOptions.IceServers = pionICEServers()
	hub := &Hub{
		ctx:     ctx,
		manager: inlivesfu.NewManager(ctx, "herai-signaling", sfuOptions),
		rooms:   make(map[string]*Room),
	}

	http.HandleFunc("/__app-auth", handleAppAuth)
	http.HandleFunc("/__app-logout", handleAppLogout)
	http.HandleFunc("/__gas", proxyGAS)
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if serveStaticApp(w, r) {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"service":"herai-signaling","endpoints":{"health":"/healthz","rooms":"/rooms","websocket":"/ws"}}`))
	})
	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"service":"herai-signaling"}`))
	})
	http.HandleFunc("/rooms", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    true,
			"rooms": hub.roomInfos(),
		})
	})
	http.HandleFunc("/meeting-config", handleMeetingConfig)
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		serveWS(hub, w, r)
	})

	log.Printf("HerAI signaling server listening on %s", *addr)
	log.Fatal(http.ListenAndServe(*addr, nil))
}

func handleMeetingConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")

	raw := strings.TrimSpace(getenv("HERAI_ICE_SERVERS", ""))
	if raw == "" {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok": true,
			"iceServers": []map[string]any{
				{"urls": "stun:stun.l.google.com:19302"},
				{"urls": "stun:stun1.l.google.com:19302"},
				{"urls": "stun:stun.cloudflare.com:3478"},
			},
		})
		return
	}

	var iceServers []map[string]any
	if err := json.Unmarshal([]byte(raw), &iceServers); err != nil || len(iceServers) == 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "message": "HERAI_ICE_SERVERS must be a JSON array"})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":         true,
		"iceServers": iceServers,
	})
}

func serveWS(hub *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("upgrade failed: %v", err)
		return
	}

	client := &Client{
		id:            r.URL.Query().Get("clientId"),
		room:          r.URL.Query().Get("room"),
		hub:           hub,
		conn:          conn,
		send:          make(chan SignalMessage, 4096),
		senders:       make(map[string]*webrtc.RTPSender),
		sfuAnswerChan: make(chan webrtc.SessionDescription, 8),
	}
	if client.id == "" || client.room == "" {
		_ = conn.WriteJSON(SignalMessage{Type: "error", Payload: mustRaw(`{"message":"clientId and room are required"}`)})
		_ = conn.Close()
		return
	}

	hub.join(client)
	go client.writePump()
	client.readPump()
}

func (h *Hub) join(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	room := h.rooms[client.room]
	if room == nil {
		roomOptions := inlivesfu.DefaultRoomOptions()
		roomOptions.Bitrates.InitialBandwidth = 900_000
		sfuRoom, err := h.manager.NewRoom(client.room, client.room, inlivesfu.RoomTypeLocal, roomOptions)
		if err != nil {
			log.Printf("failed to create inlive sfu room=%s: %v", client.room, err)
			return
		}
		room = &Room{
			clients: make(map[string]*Client),
			sfuRoom: sfuRoom,
			tracks:  make(map[string]*PublishedTrack),
		}
		h.rooms[client.room] = room
	}

	if existing := room.clients[client.id]; existing != nil {
		_ = existing.conn.WriteJSON(SignalMessage{Type: "error", Payload: mustRaw(`{"message":"duplicate client id replaced"}`)})
		_ = existing.conn.Close()
		delete(room.clients, client.id)
	}

	var peers []string
	for id := range room.clients {
		peers = append(peers, id)
	}
	room.clients[client.id] = client

	enqueueSignal(client, SignalMessage{Type: "joined", Room: client.room, From: "server", Payload: mustJSON(map[string]any{
		"clientId": client.id,
		"peers":    peers,
	})})

	for id, peer := range room.clients {
		if id == client.id {
			continue
		}
		enqueueSignal(peer, SignalMessage{Type: "peer-joined", Room: client.room, From: client.id})
	}
}

func (h *Hub) leave(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	room := h.rooms[client.room]
	if room == nil {
		return
	}

	if room.clients[client.id] != client {
		return
	}

	client.markClosed()
	if room.sfuRoom != nil {
		if err := room.sfuRoom.StopClient(client.id); err != nil {
			log.Printf("failed to stop inlive sfu client=%s room=%s: %v", client.id, client.room, err)
		}
	}
	delete(room.clients, client.id)
	for trackID, track := range room.tracks {
		if track.owner == client.id {
			delete(room.tracks, trackID)
			for _, peer := range room.clients {
				if peer.removeSender(trackID) {
					peer.scheduleSFUNegotiation(180 * time.Millisecond)
				}
			}
		}
	}
	client.closePeerConnection()
	close(client.send)

	for _, peer := range room.clients {
		enqueueSignal(peer, SignalMessage{Type: "peer-left", Room: client.room, From: client.id})
	}

	if len(room.clients) == 0 {
		delete(h.rooms, client.room)
	}
}

func (h *Hub) forward(message SignalMessage) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	room := h.rooms[message.Room]
	if room == nil {
		return
	}

	if message.To != "" {
		if target := room.clients[message.To]; target != nil {
			enqueueSignal(target, message)
		}
		return
	}

	for id, client := range room.clients {
		if id == message.From {
			continue
		}
		enqueueSignal(client, message)
	}
}

func (h *Hub) roomInfos() []RoomInfo {
	h.mu.RLock()
	defer h.mu.RUnlock()

	infos := make([]RoomInfo, 0, len(h.rooms))
	for id, room := range h.rooms {
		peers := make([]string, 0, len(room.clients))
		for clientID := range room.clients {
			peers = append(peers, clientID)
		}
		infos = append(infos, RoomInfo{
			Room:    id,
			Clients: len(room.clients),
			Peers:   peers,
		})
	}
	return infos
}

func (c *Client) readPump() {
	defer func() {
		c.hub.leave(c)
		_ = c.conn.Close()
	}()

	c.conn.SetReadLimit(1 << 20)
	_ = c.conn.SetReadDeadline(time.Now().Add(70 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(70 * time.Second))
		return nil
	})

	for {
		var message SignalMessage
		if err := c.conn.ReadJSON(&message); err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("read error: %v", err)
			}
			return
		}
		if message.Room == "" {
			message.Room = c.room
		}
		message.From = c.id
		if message.Type == "peer-list-request" {
			c.hub.sendPeerList(c)
			continue
		}
		if message.Type == "screen-start" {
			c.setScreenShareState(true, message.Payload)
		}
		if message.Type == "screen-stop" {
			c.setScreenShareState(false, nil)
		}
		if strings.HasPrefix(message.Type, "sfu-") {
			c.hub.handleSFUMessage(c, message)
			continue
		}
		c.hub.forward(message)
	}
}

func (h *Hub) sendPeerList(client *Client) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	room := h.rooms[client.room]
	if room == nil {
		return
	}

	peers := make([]string, 0, len(room.clients))
	for id := range room.clients {
		if id != client.id {
			peers = append(peers, id)
		}
	}

	enqueueSignal(client, SignalMessage{Type: "peer-list", Room: client.room, From: "server", Payload: mustJSON(map[string]any{
		"peers": peers,
	})})
}

func enqueueSignal(client *Client, message SignalMessage) {
	defer func() {
		if recovered := recover(); recovered != nil {
			log.Printf("dropping signal type=%s room=%s client=%s: client channel closed", message.Type, client.room, client.id)
		}
	}()
	if client.isClosed() {
		return
	}
	select {
	case client.send <- message:
	default:
		log.Printf("dropping signal type=%s room=%s client=%s: send queue full", message.Type, client.room, client.id)
	}
}

func (h *Hub) handleSFUMessage(client *Client, message SignalMessage) {
	switch message.Type {
	case "sfu-offer":
		h.handleSFUOffer(client, message.Payload)
	case "sfu-answer":
		client.handleSFUAnswer(message.Payload)
	case "sfu-ice":
		client.handleSFUIce(message.Payload)
	}
}

func (h *Hub) handleSFUOffer(client *Client, payload json.RawMessage) {
	var offer webrtc.SessionDescription
	if err := json.Unmarshal(payload, &offer); err != nil {
		log.Printf("invalid sfu offer from %s: %v", client.id, err)
		return
	}

	sfuClient, err := h.ensureInliveSFUClient(client)
	if err != nil {
		log.Printf("failed to prepare inlive sfu client=%s room=%s: %v", client.id, client.room, err)
		return
	}

	answer, err := sfuClient.Negotiate(offer)
	if err != nil {
		log.Printf("failed to negotiate inlive sfu offer for %s: %v", client.id, err)
		return
	}

	enqueueSignal(client, SignalMessage{Type: "sfu-answer", Room: client.room, From: "server", Payload: mustJSON(answer)})
}

func (h *Hub) ensureInliveSFUClient(client *Client) (*inlivesfu.Client, error) {
	client.pcMu.Lock()
	if client.sfuClient != nil {
		sfuClient := client.sfuClient
		client.pcMu.Unlock()
		return sfuClient, nil
	}
	client.pcMu.Unlock()

	h.mu.RLock()
	room := h.rooms[client.room]
	h.mu.RUnlock()
	if room == nil || room.sfuRoom == nil {
		return nil, inlivesfu.ErrRoomNotFound
	}

	options := inlivesfu.DefaultClientOptions()
	options.PacerType = inlivesfu.PacerTypeLeakyBucket
	options.EnableVoiceDetection = true
	options.EnableOpusDTX = true
	options.EnableOpusInbandFEC = true
	options.ReorderPackets = true
	options.MinPlayoutDelay = 120
	options.MaxPlayoutDelay = 320

	sfuClient, err := room.sfuRoom.AddClient(client.id, client.id, options)
	if err != nil {
		return nil, err
	}

	client.pcMu.Lock()
	client.sfuClient = sfuClient
	client.flushPendingICE(sfuClient)
	client.pcMu.Unlock()

	sfuClient.OnIceCandidate(func(ctx context.Context, candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		enqueueSignal(client, SignalMessage{Type: "sfu-ice", Room: client.room, From: "server", Payload: mustJSON(candidate.ToJSON())})
	})

	sfuClient.OnRenegotiation(func(ctx context.Context, offer webrtc.SessionDescription) (webrtc.SessionDescription, error) {
		enqueueSignal(client, SignalMessage{Type: "sfu-offer", Room: client.room, From: "server", Payload: mustJSON(&offer)})
		select {
		case answer := <-client.sfuAnswerChan:
			return answer, nil
		case <-ctx.Done():
			return webrtc.SessionDescription{}, ctx.Err()
		case <-time.After(20 * time.Second):
			return webrtc.SessionDescription{}, context.DeadlineExceeded
		}
	})

	sfuClient.OnTracksAdded(func(tracks []inlivesfu.ITrack) {
		trackTypes := make(map[string]inlivesfu.TrackType, len(tracks))
		for _, track := range tracks {
			trackType := inlivesfu.TrackType(inlivesfu.TrackTypeMedia)
			if track.Kind() == webrtc.RTPCodecTypeVideo && client.isScreenShareTrack(track.StreamID()) {
				trackType = inlivesfu.TrackType(inlivesfu.TrackTypeScreen)
			}
			trackTypes[track.ID()] = trackType
		}
		sfuClient.SetTracksSourceType(trackTypes)
	})

	sfuClient.OnTracksAvailable(func(tracks []inlivesfu.ITrack) {
		subscriptions := make([]inlivesfu.SubscribeTrackRequest, 0, len(tracks))
		trackMeta := make([]map[string]string, 0, len(tracks))
		for _, track := range tracks {
			if track.ClientID() == client.id {
				continue
			}
			trackMeta = append(trackMeta, map[string]string{
				"trackId":  track.ID(),
				"streamId": track.StreamID(),
				"clientId": track.ClientID(),
				"source":   track.SourceType().String(),
				"kind":     track.Kind().String(),
			})
			subscriptions = append(subscriptions, inlivesfu.SubscribeTrackRequest{
				ClientID: track.ClientID(),
				TrackID:  track.ID(),
			})
		}
		if len(subscriptions) == 0 {
			return
		}
		enqueueSignal(client, SignalMessage{Type: "sfu-tracks-available", Room: client.room, From: "server", Payload: mustJSON(map[string]any{
			"tracks": trackMeta,
		})})
		if err := sfuClient.SubscribeTracks(subscriptions); err != nil {
			log.Printf("failed to subscribe inlive sfu tracks client=%s room=%s: %v", client.id, client.room, err)
		}
	})

	sfuClient.OnConnectionStateChanged(func(state webrtc.PeerConnectionState) {
		log.Printf("inlive sfu state client=%s room=%s state=%s", client.id, client.room, state.String())
	})

	return sfuClient, nil
}

func (h *Hub) ensurePeerConnection(client *Client) (*webrtc.PeerConnection, error) {
	client.pcMu.Lock()
	if client.pc != nil {
		pc := client.pc
		client.pcMu.Unlock()
		return pc, nil
	}
	client.pcMu.Unlock()

	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{
		ICEServers: pionICEServers(),
	})
	if err != nil {
		return nil, err
	}

	pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		enqueueSignal(client, SignalMessage{Type: "sfu-ice", Room: client.room, From: "server", Payload: mustJSON(candidate.ToJSON())})
	})

	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed || state == webrtc.PeerConnectionStateDisconnected {
			log.Printf("sfu pc state client=%s room=%s state=%s", client.id, client.room, state.String())
		}
	})

	pc.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		h.publishRemoteTrack(client, remoteTrack)
	})

	client.pcMu.Lock()
	client.pc = pc
	client.pcMu.Unlock()

	h.mu.RLock()
	room := h.rooms[client.room]
	existingTracks := make([]*PublishedTrack, 0)
	if room != nil {
		for _, track := range room.tracks {
			if track.owner != client.id {
				existingTracks = append(existingTracks, track)
			}
		}
	}
	h.mu.RUnlock()

	for _, track := range existingTracks {
		client.addPublishedTrack(track)
	}

	return pc, nil
}

func (h *Hub) publishRemoteTrack(client *Client, remoteTrack *webrtc.TrackRemote) {
	codec := remoteTrack.Codec()
	kind := remoteTrack.Kind().String()
	streamID := client.id
	if kind == "video" && client.isScreenShareTrack(remoteTrack.StreamID()) {
		kind = "screen"
		streamID = client.id + ":screen"
	}
	localTrack, err := webrtc.NewTrackLocalStaticRTP(codec.RTPCodecCapability, remoteTrack.ID(), streamID)
	if err != nil {
		log.Printf("failed to create local track for %s: %v", client.id, err)
		return
	}

	trackID := client.id + ":" + kind + ":" + remoteTrack.ID()
	h.removePublishedTrack(client, trackID)
	published := &PublishedTrack{
		id:    trackID,
		owner: client.id,
		kind:  kind,
		track: localTrack,
	}

	h.mu.Lock()
	room := h.rooms[client.room]
	if room == nil {
		h.mu.Unlock()
		return
	}
	room.tracks[trackID] = published
	peers := make([]*Client, 0, len(room.clients))
	for id, peer := range room.clients {
		if id != client.id {
			peers = append(peers, peer)
		}
	}
	h.mu.Unlock()

	enqueueSignal(client, SignalMessage{Type: "sfu-track-published", Room: client.room, From: "server", Payload: mustJSON(map[string]any{
		"id":   trackID,
		"kind": published.kind,
	})})

	for _, peer := range peers {
		if peer.addPublishedTrack(published) {
			peer.scheduleSFUNegotiation(180 * time.Millisecond)
		}
	}

	go func() {
		for {
			packet, _, err := remoteTrack.ReadRTP()
			if err != nil {
				h.removePublishedTrack(client, trackID)
				return
			}
			if err := localTrack.WriteRTP(packet); err != nil {
				log.Printf("failed to relay RTP track=%s: %v", trackID, err)
			}
		}
	}()
}

func (h *Hub) removePublishedTrack(owner *Client, trackID string) {
	h.mu.Lock()
	room := h.rooms[owner.room]
	if room == nil {
		h.mu.Unlock()
		return
	}
	delete(room.tracks, trackID)
	peers := make([]*Client, 0, len(room.clients))
	for id, peer := range room.clients {
		if id != owner.id {
			peers = append(peers, peer)
		}
	}
	h.mu.Unlock()

	for _, peer := range peers {
		if peer.removeSender(trackID) {
			peer.scheduleSFUNegotiation(180 * time.Millisecond)
		}
	}
}

func (c *Client) addPublishedTrack(track *PublishedTrack) bool {
	c.pcMu.Lock()
	defer c.pcMu.Unlock()
	if c.pc == nil || c.senders == nil {
		return false
	}
	if track.owner == c.id {
		return false
	}
	if _, exists := c.senders[track.id]; exists {
		return false
	}
	sender, err := c.pc.AddTrack(track.track)
	if err != nil {
		log.Printf("failed to add SFU track=%s to client=%s: %v", track.id, c.id, err)
		return false
	}
	c.senders[track.id] = sender
	go drainRTCP(sender)
	return true
}

func (c *Client) removeSender(trackID string) bool {
	c.pcMu.Lock()
	defer c.pcMu.Unlock()
	if c.pc == nil || c.senders == nil {
		return false
	}
	sender := c.senders[trackID]
	if sender == nil {
		return false
	}
	delete(c.senders, trackID)
	if err := c.pc.RemoveTrack(sender); err != nil {
		log.Printf("failed to remove SFU track=%s from client=%s: %v", trackID, c.id, err)
	}
	return true
}

func (c *Client) negotiateSFU() {
	c.pcMu.Lock()
	defer c.pcMu.Unlock()
	if c.pc == nil {
		return
	}
	if c.pc.SignalingState() != webrtc.SignalingStateStable {
		c.scheduleSFUNegotiation(260 * time.Millisecond)
		return
	}
	offer, err := c.pc.CreateOffer(nil)
	if err != nil {
		log.Printf("failed to create sfu renegotiation offer for %s: %v", c.id, err)
		return
	}
	if err := c.pc.SetLocalDescription(offer); err != nil {
		log.Printf("failed to set sfu renegotiation offer for %s: %v", c.id, err)
		return
	}
	enqueueSignal(c, SignalMessage{Type: "sfu-offer", Room: c.room, From: "server", Payload: mustJSON(c.pc.LocalDescription())})
}

func (c *Client) handleSFUAnswer(payload json.RawMessage) {
	var answer webrtc.SessionDescription
	if err := json.Unmarshal(payload, &answer); err != nil {
		log.Printf("invalid sfu answer from %s: %v", c.id, err)
		return
	}
	c.pcMu.Lock()
	answerChan := c.sfuAnswerChan
	c.pcMu.Unlock()

	select {
	case answerChan <- answer:
	default:
		log.Printf("dropping sfu answer for %s: answer queue full", c.id)
	}
}

func (c *Client) handleSFUIce(payload json.RawMessage) {
	var candidate webrtc.ICECandidateInit
	if err := json.Unmarshal(payload, &candidate); err != nil {
		log.Printf("invalid sfu ice from %s: %v", c.id, err)
		return
	}
	c.pcMu.Lock()
	sfuClient := c.sfuClient
	if sfuClient == nil {
		c.pendingICE = append(c.pendingICE, candidate)
		c.pcMu.Unlock()
		return
	}
	c.pcMu.Unlock()
	if err := sfuClient.AddICECandidate(candidate); err != nil {
		log.Printf("failed to add inlive sfu ice for %s: %v", c.id, err)
	}
}

func (c *Client) flushPendingICE(sfuClient *inlivesfu.Client) {
	if len(c.pendingICE) == 0 {
		return
	}
	pending := c.pendingICE
	c.pendingICE = nil
	for _, candidate := range pending {
		if err := sfuClient.AddICECandidate(candidate); err != nil {
			log.Printf("failed to flush pending inlive sfu ice for %s: %v", c.id, err)
		}
	}
}

func (c *Client) closePeerConnection() {
	c.pcMu.Lock()
	defer c.pcMu.Unlock()
	if c.pc != nil {
		_ = c.pc.Close()
		c.pc = nil
	}
	c.sfuClient = nil
	c.senders = make(map[string]*webrtc.RTPSender)
	c.pendingICE = nil
}

func (c *Client) scheduleSFUNegotiation(delay time.Duration) {
	c.negotiationMu.Lock()
	defer c.negotiationMu.Unlock()
	if c.closed {
		return
	}
	if c.negotiateTimer != nil {
		c.negotiateTimer.Reset(delay)
		return
	}
	c.negotiateTimer = time.AfterFunc(delay, func() {
		c.negotiationMu.Lock()
		c.negotiateTimer = nil
		closed := c.closed
		c.negotiationMu.Unlock()
		if closed {
			return
		}
		c.negotiateSFU()
	})
}

func (c *Client) markClosed() {
	c.negotiationMu.Lock()
	c.closed = true
	if c.negotiateTimer != nil {
		c.negotiateTimer.Stop()
		c.negotiateTimer = nil
	}
	c.negotiationMu.Unlock()
}

func (c *Client) isClosed() bool {
	c.negotiationMu.Lock()
	defer c.negotiationMu.Unlock()
	return c.closed
}

func (c *Client) setScreenShareState(active bool, payload json.RawMessage) {
	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	c.screenActive = active
	c.screenStreamID = ""
	if !active || len(payload) == 0 {
		return
	}
	var body struct {
		StreamID string `json:"streamId"`
	}
	if err := json.Unmarshal(payload, &body); err == nil {
		c.screenStreamID = body.StreamID
	}
}

func (c *Client) isScreenShareTrack(streamID string) bool {
	c.stateMu.RLock()
	defer c.stateMu.RUnlock()
	if !c.screenActive {
		return false
	}
	return c.screenStreamID == "" || c.screenStreamID == streamID
}

func pionICEServers() []webrtc.ICEServer {
	raw := strings.TrimSpace(getenv("HERAI_ICE_SERVERS", ""))
	if raw == "" {
		return []webrtc.ICEServer{
			{URLs: []string{"stun:stun.l.google.com:19302"}},
			{URLs: []string{"stun:stun1.l.google.com:19302"}},
			{URLs: []string{"stun:stun.cloudflare.com:3478"}},
		}
	}

	var generic []map[string]any
	if err := json.Unmarshal([]byte(raw), &generic); err != nil {
		log.Printf("invalid HERAI_ICE_SERVERS for SFU: %v", err)
		return nil
	}

	servers := make([]webrtc.ICEServer, 0, len(generic))
	for _, item := range generic {
		server := webrtc.ICEServer{}
		switch urls := item["urls"].(type) {
		case string:
			server.URLs = []string{urls}
		case []any:
			for _, value := range urls {
				if text, ok := value.(string); ok {
					server.URLs = append(server.URLs, text)
				}
			}
		}
		if username, ok := item["username"].(string); ok {
			server.Username = username
		}
		if credential, ok := item["credential"].(string); ok {
			server.Credential = credential
		}
		if len(server.URLs) > 0 {
			servers = append(servers, server)
		}
	}
	return servers
}

func drainRTCP(sender *webrtc.RTPSender) {
	buf := make([]byte, 1500)
	for {
		if _, _, err := sender.Read(buf); err != nil {
			return
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteJSON(message); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func mustJSON(value any) json.RawMessage {
	bytes, err := json.Marshal(value)
	if err != nil {
		return mustRaw(`{}`)
	}
	return bytes
}

func mustRaw(value string) json.RawMessage {
	return json.RawMessage(value)
}

func getenv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func serveStaticApp(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	if !hasAppAccess(r) {
		serveAccessGate(w, r)
		return true
	}

	staticRoot := getenv("HERAI_STATIC_ROOT", "./public")
	cleanPath := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
	if cleanPath == "." {
		cleanPath = "index.html"
	}
	if cleanPath == ".." || strings.HasPrefix(cleanPath, "../") {
		http.NotFound(w, r)
		return true
	}

	fullPath := filepath.Join(staticRoot, cleanPath)
	if info, err := os.Stat(fullPath); err == nil && !info.IsDir() {
		serveStaticFile(w, r, fullPath)
		return true
	}

	indexPath := filepath.Join(staticRoot, "index.html")
	if _, err := os.Stat(indexPath); err == nil {
		serveStaticFile(w, r, indexPath)
		return true
	}

	return false
}

func serveStaticFile(w http.ResponseWriter, r *http.Request, path string) {
	ext := strings.ToLower(filepath.Ext(path))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if ext == ".html" {
		w.Header().Set("Cache-Control", "no-store")
	} else if ext == ".js" || ext == ".css" {
		w.Header().Set("Cache-Control", "no-cache, max-age=0, must-revalidate")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}
	http.ServeFile(w, r, path)
}

func handleAppAuth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		serveAccessGate(w, r)
		return
	}

	password := ""
	contentType := strings.ToLower(r.Header.Get("Content-Type"))
	if strings.Contains(contentType, "application/json") {
		var payload struct {
			Password string `json:"password"`
		}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		password = payload.Password
	} else {
		_ = r.ParseForm()
		password = r.FormValue("password")
	}

	expected := getenv("APP_ACCESS_PASSWORD", "")
	if expected == "" || !hmac.Equal([]byte(password), []byte(expected)) {
		serveAccessGateWithError(w, r, "Password akses salah.")
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "herai_app_access",
		Value:    appAccessToken(),
		Path:     "/",
		MaxAge:   12 * 60 * 60,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"),
	})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func handleAppLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     "herai_app_access",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"),
	})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func hasAppAccess(r *http.Request) bool {
	if getenv("APP_ACCESS_PASSWORD", "") == "" {
		return true
	}
	cookie, err := r.Cookie("herai_app_access")
	if err != nil {
		return false
	}
	return hmac.Equal([]byte(cookie.Value), []byte(appAccessToken()))
}

func appAccessToken() string {
	secret := getenv("APP_ACCESS_PASSWORD", "")
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte("herai-superapp-access-v1"))
	return hex.EncodeToString(mac.Sum(nil))
}

func serveAccessGate(w http.ResponseWriter, r *http.Request) {
	serveAccessGateWithError(w, r, "")
}

func serveAccessGateWithError(w http.ResponseWriter, r *http.Request, message string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusUnauthorized)
	errorBlock := ""
	if message != "" {
		errorBlock = `<p class="error">` + htmlEscape(message) + `</p>`
	}
	_, _ = w.Write([]byte(`<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HerAI Secure Access</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { align-items: center; background: #101828; display: flex; justify-content: center; margin: 0; min-height: 100vh; padding: 24px; }
    main { background: #fff; border: 1px solid #f2f4f7; border-radius: 8px; box-shadow: 0 30px 80px rgba(0,0,0,.28); max-width: 420px; padding: 28px; width: 100%; }
    h1 { color: #101828; font-size: 1.35rem; line-height: 1.2; margin: 0 0 8px; }
    p { color: #667085; font-size: .92rem; line-height: 1.55; margin: 0 0 18px; }
    label { color: #344054; display: block; font-size: .82rem; font-weight: 800; margin-bottom: 8px; }
    input { border: 1px solid #d0d5dd; border-radius: 8px; box-sizing: border-box; font-size: 1rem; margin-bottom: 14px; padding: 12px 13px; width: 100%; }
    button { background: #ff1493; border: 0; border-radius: 8px; color: #fff; cursor: pointer; font-weight: 900; padding: 12px 14px; width: 100%; }
    .error { background: #fee4e2; border-radius: 8px; color: #b42318; font-weight: 800; padding: 10px 12px; }
    small { color: #98a2b3; display: block; font-size: .74rem; margin-top: 12px; text-align: center; }
  </style>
</head>
<body>
  <main>
    <h1>HerAI Secure Access</h1>
    <p>Masukkan password akses untuk membuka aplikasi dan asset internal.</p>
    ` + errorBlock + `
    <form method="post" action="/__app-auth">
      <label for="password">Access Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
      <button type="submit">Masuk</button>
    </form>
    <small>Protected application gateway</small>
  </main>
</body>
</html>`))
}

func htmlEscape(value string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#039;")
	return replacer.Replace(value)
}

func proxyGAS(w http.ResponseWriter, r *http.Request) {
	setJSONHeaders(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !hasAppAccess(r) {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "error", "message": "App access required"})
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, `{"status":"error","message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	target := getenv("GAS_WEB_APP_URL", "")
	if target == "" {
		http.Error(w, `{"status":"error","message":"GAS_WEB_APP_URL is not configured"}`, http.StatusBadGateway)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, `{"status":"error","message":"failed to read request body"}`, http.StatusBadRequest)
		return
	}
	if len(bytes.TrimSpace(body)) == 0 {
		body = []byte(`{}`)
	}

	status, responseBody, contentType, err := postToGAS(target, body)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "error", "message": err.Error()})
		return
	}

	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.WriteHeader(status)
	_, _ = w.Write(responseBody)
}

func postToGAS(target string, body []byte) (int, []byte, string, error) {
	client := &http.Client{
		Timeout: 30 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	req, err := http.NewRequest(http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return http.StatusBadGateway, nil, "", err
	}
	req.Header.Set("Content-Type", "text/plain;charset=utf-8")

	res, err := client.Do(req)
	if err != nil {
		return http.StatusBadGateway, nil, "", err
	}
	defer res.Body.Close()

	if isRedirect(res.StatusCode) && res.Header.Get("Location") != "" {
		return getGASRedirect(client, res.Header.Get("Location"))
	}

	responseBody, err := io.ReadAll(res.Body)
	if err != nil {
		return http.StatusBadGateway, nil, "", err
	}
	return res.StatusCode, responseBody, normalizeContentType(res.Header.Get("Content-Type")), nil
}

func getGASRedirect(client *http.Client, location string) (int, []byte, string, error) {
	req, err := http.NewRequest(http.MethodGet, location, nil)
	if err != nil {
		return http.StatusBadGateway, nil, "", err
	}
	res, err := client.Do(req)
	if err != nil {
		return http.StatusBadGateway, nil, "", err
	}
	defer res.Body.Close()

	responseBody, err := io.ReadAll(res.Body)
	if err != nil {
		return http.StatusBadGateway, nil, "", err
	}
	return res.StatusCode, responseBody, normalizeContentType(res.Header.Get("Content-Type")), nil
}

func setJSONHeaders(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
}

func isRedirect(status int) bool {
	return status == http.StatusMovedPermanently ||
		status == http.StatusFound ||
		status == http.StatusSeeOther ||
		status == http.StatusTemporaryRedirect ||
		status == http.StatusPermanentRedirect
}

func normalizeContentType(value string) string {
	if value == "" || strings.Contains(strings.ToLower(value), "text/html") {
		return "application/json"
	}
	return value
}
