// Proximity voice chat — WebRTC peer connection management.
//
// The server (see server/voiceProximity.js + the "Proximity voice chat"
// block in server/index.js) decides *which pairs* of nearby players should
// be talking to each other and tells each side via "voicePeerJoin"/
// "voicePeerLeave" -- this module only handles the actual per-peer WebRTC
// plumbing once told to. Signaling (SDP offer/answer + ICE candidates) is
// relayed through the existing socket.io connection (network.js's
// sendVoiceSignal/"voiceSignal"), same as every other piece of this game's
// networking, rather than opening a second connection of any kind.
//
// This can't be runtime-tested in the sandbox this project is built in --
// there's no real browser, so no getUserMedia/RTCPeerConnection/audio
// pipeline to exercise (same limitation noted for the day/night cycle's GLSL
// shader and the touch-controls' real touch events). What *can* be kept
// testable is factored out: server/voiceProximity.js's pairing math is pure
// and unit-tested there. This file is the deliberately-untested DOM/WebRTC
// glue, kept as small and boring as possible to minimize the untested
// surface area.

// Public STUN-only config: enough to establish a direct peer connection for
// most home/office NATs. A production deployment behind especially
// restrictive NATs/firewalls may need a TURN server added here too -- see
// DEPLOYMENT.md's "Voice chat" note.
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

/**
 * Creates a voice manager bound to `net` (an object exposing
 * `sendVoiceSignal(targetId, data)` -- see network.js). Returns handlers
 * meant to be wired directly to the matching socket events/UI action in
 * main.js:
 *   - handlePeerJoin(peerId, initiate): server says this peer is now in
 *     range; start negotiating. Exactly one side of a pair is told
 *     `initiate: true` (the lower-sorted socket id, see server/index.js) so
 *     only one offer is ever created per pair.
 *   - handlePeerLeave(peerId): server says this peer is no longer in range;
 *     tear the connection down.
 *   - handleSignal(fromId, data): relayed SDP/ICE data from a peer.
 *   - setMicEnabled(on): toggles whether this player's own mic audio is sent
 *     to every currently-connected peer.
 *   - disposeAll(): tears down every peer connection (e.g. on disconnect).
 */
export function createVoiceManager(net) {
  /** @type {Map<string, { pc: RTCPeerConnection, audioEl: HTMLAudioElement }>} */
  const peers = new Map();
  let localStream = null; // lazily created on first setMicEnabled(true)
  let micEnabled = false;
  let micRequestPromise = null; // in-flight getUserMedia call, so a rapid double-toggle doesn't race two requests

  async function ensureLocalStream() {
    if (localStream) return localStream;
    if (micRequestPromise) return micRequestPromise;

    micRequestPromise = navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => {
        localStream = stream;
        // A peer connection may already exist (proximity joined before the
        // player turned their mic on for the first time) -- attach the
        // now-available track to each of them so it doesn't need its own
        // separate "add track later" renegotiation path.
        for (const { pc } of peers.values()) {
          for (const track of stream.getAudioTracks()) {
            pc.addTrack(track, stream);
          }
        }
        return stream;
      })
      .catch((err) => {
        console.warn("[voice] microphone access denied/unavailable:", err?.message || err);
        return null;
      })
      .finally(() => {
        micRequestPromise = null;
      });

    return micRequestPromise;
  }

  function attachRemoteAudio(peerId, stream) {
    let audioEl = document.getElementById(`voice-audio-${peerId}`);
    if (!audioEl) {
      audioEl = document.createElement("audio");
      audioEl.id = `voice-audio-${peerId}`;
      audioEl.autoplay = true;
      // Hidden -- this is a pure audio pipe, no visible player controls.
      audioEl.style.display = "none";
      document.body.appendChild(audioEl);
    }
    audioEl.srcObject = stream;
    return audioEl;
  }

  function removePeer(peerId) {
    const entry = peers.get(peerId);
    if (!entry) return;
    entry.pc.close();
    entry.audioEl.srcObject = null;
    entry.audioEl.remove();
    peers.delete(peerId);
  }

  function createPeer(peerId, initiate) {
    // A join for an already-open connection (e.g. a duplicate tick) simply
    // no-ops rather than tearing down a working connection.
    if (peers.has(peerId)) return peers.get(peerId).pc;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const audioEl = attachRemoteAudio(peerId, new MediaStream());
    peers.set(peerId, { pc, audioEl });

    if (localStream) {
      for (const track of localStream.getAudioTracks()) {
        pc.addTrack(track, localStream);
      }
    }

    pc.ontrack = (event) => {
      audioEl.srcObject = event.streams[0] || new MediaStream(event.track ? [event.track] : []);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        net.sendVoiceSignal(peerId, { candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        removePeer(peerId);
      }
    };

    if (initiate) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          net.sendVoiceSignal(peerId, { sdp: pc.localDescription });
        } catch (err) {
          console.warn("[voice] failed to create offer:", err?.message || err);
        }
      };
    }

    return pc;
  }

  return {
    handlePeerJoin(peerId, initiate) {
      createPeer(peerId, initiate);
      // A mic enabled *before* this peer joined already has its track
      // attached by createPeer() above via `localStream`; a mic enabled
      // *after* this peer joined is attached by ensureLocalStream()'s own
      // loop over `peers`, so no extra wiring is needed either way.
    },

    handlePeerLeave(peerId) {
      removePeer(peerId);
    },

    async handleSignal(fromId, data) {
      // A signal for a peer we don't know about yet (offer arrived before
      // our own "voicePeerJoin" for some reason -- e.g. a dropped/reordered
      // event) still needs a peer connection to answer into.
      const pc = createPeer(fromId, false);

      try {
        if (data?.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          if (data.sdp.type === "offer") {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            net.sendVoiceSignal(fromId, { sdp: pc.localDescription });
          }
        } else if (data?.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } catch (err) {
        console.warn("[voice] failed to handle signal:", err?.message || err);
      }
    },

    async setMicEnabled(on) {
      micEnabled = on;
      if (on) {
        const stream = await ensureLocalStream();
        if (stream) {
          for (const track of stream.getAudioTracks()) track.enabled = true;
        }
      } else if (localStream) {
        // Disable rather than remove/stop the track -- keeps the existing
        // peer connections' negotiated state intact so re-enabling the mic
        // doesn't need a fresh round of offer/answer/ICE.
        for (const track of localStream.getAudioTracks()) track.enabled = false;
      }
    },

    isMicEnabled() {
      return micEnabled;
    },

    disposeAll() {
      for (const peerId of Array.from(peers.keys())) removePeer(peerId);
      if (localStream) {
        for (const track of localStream.getTracks()) track.stop();
        localStream = null;
      }
    },
  };
}
