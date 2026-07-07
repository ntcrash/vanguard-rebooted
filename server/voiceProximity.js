// Proximity voice chat — pure pairing math, kept dependency-free and
// side-effect-free (no socket.io, no timers) so it can be unit-tested with a
// plain Node script the same way server/parties.js and server/quests.js are,
// per this project's "pure logic in its own file" convention. The
// side-effecting glue (actually emitting voicePeerJoin/voicePeerLeave and
// relaying voiceSignal over socket.io) lives in server/index.js alongside the
// other tick functions (tickMobs, etc.) it's modeled after.
//
// Design: rather than every client opening a WebRTC connection to every other
// client (O(n^2) audio streams, most of them silent/wasted for a large
// world), the server tracks which *pairs* of alive players are currently
// within VOICE_PROXIMITY_RANGE of each other and only tells those specific
// pairs to negotiate a peer connection. Walking out of range tears the
// connection back down. This mirrors the "server decides who needs to know
// about what" posture already used for mob aggro/pickup collection, just
// applied to player-to-player pairs instead of player-to-world-object.

const VOICE_PROXIMITY_RANGE = 18; // units -- deliberately a bit larger than
// PICKUP_COLLECT_RANGE/MOB_ATTACK_RANGE in server/index.js, since "close
// enough to talk" is a more generous distance than "close enough to melee".

/** Canonical, order-independent key for an unordered pair of ids, so
 * `pairKey(a, b) === pairKey(b, a)` and each unordered pair has exactly one
 * key regardless of which order its members are discovered in. */
function pairKey(idA, idB) {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

/** Inverse of pairKey(): splits a pair key back into its two member ids. */
function splitPairKey(key) {
  return key.split("|");
}

/** Given an iterable of player-like objects ({ id, x, z, alive }), returns a
 * Set of pairKey()s for every unordered pair of *alive* players currently
 * within VOICE_PROXIMITY_RANGE of each other. A player missing x/z (or not
 * alive) simply can't form any pair -- mirrors how a dead/disconnected player
 * isn't a valid attack or pickup target elsewhere in this codebase. */
function computeVoicePairs(players) {
  const list = Array.from(players).filter(
    (p) => p && p.alive && typeof p.x === "number" && typeof p.z === "number"
  );
  const pairs = new Set();

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const dist = Math.hypot(a.x - b.x, a.z - b.z);
      if (dist <= VOICE_PROXIMITY_RANGE) {
        pairs.add(pairKey(a.id, b.id));
      }
    }
  }

  return pairs;
}

/** Compares a previous tick's pair set against a freshly computed one and
 * returns which pairs newly formed ("joined", should start a WebRTC
 * negotiation) and which no longer hold ("left", should tear one down).
 * Pairs present in both sets are unchanged and appear in neither list -- an
 * already-negotiated connection is left alone tick after tick as long as the
 * two players stay in range, same as an already-aggro'd mob doesn't re-aggro
 * every tick. */
function diffVoicePairs(prevPairs, nextPairs) {
  const joined = [];
  const left = [];

  for (const key of nextPairs) {
    if (!prevPairs.has(key)) joined.push(key);
  }
  for (const key of prevPairs) {
    if (!nextPairs.has(key)) left.push(key);
  }

  return { joined, left };
}

export { VOICE_PROXIMITY_RANGE, pairKey, splitPairKey, computeVoicePairs, diffVoicePairs };
