// Vanguard Rebooted — simple parties (grouping)
//
// Pure party-membership math, kept in its own module (mirroring quests.js/
// accountStore.js/playerStore.js) so it can be unit-tested without booting
// the socket.io server. server/index.js owns all the side effects (in-memory
// party/invite storage, socket events, chat notices) — this module only
// tracks "who's in which party, and who leads it" as plain data.
//
// Parties are intentionally NOT persisted to server/data/players.json: like
// the live `mobs`/`pickups` world state, a party only makes sense while its
// members are actually online together, so it's fine for it to reset on a
// server restart (same tradeoff already made for in-memory mob/pickup state).

export const PARTY_MAX_SIZE = 5;

/** Creates a brand-new party of one, led by `leaderId`. The party's id is
 * deterministically derived from the leader's (socket) id at creation time,
 * so no separate id-counter/generator is needed. */
export function createParty(leaderId) {
  return { id: `party-${leaderId}`, leaderId, memberIds: [leaderId] };
}

export function isPartyFull(party) {
  return party.memberIds.length >= PARTY_MAX_SIZE;
}

export function isPartyMember(party, id) {
  return party.memberIds.includes(id);
}

export function isPartyLeader(party, id) {
  return party.leaderId === id;
}

/** Adds `memberId` to `party`, returning a new party object. No-ops (returns
 * the same party unchanged) if `memberId` is already a member or the party
 * is already at PARTY_MAX_SIZE. */
export function addPartyMember(party, memberId) {
  if (isPartyMember(party, memberId) || isPartyFull(party)) return party;
  return { ...party, memberIds: [...party.memberIds, memberId] };
}

/** Removes `memberId` from `party`, returning a new party object. If the
 * departing member was the leader, leadership passes to the next-longest-
 * tenured remaining member (memberIds[0] after filtering, since members are
 * appended in join order). Returns null if removing `memberId` would leave
 * the party empty (its very last member left/disbanded) — the caller is
 * responsible for deciding whether a lone remaining member should also be
 * treated as "no real party left" (see server/index.js's disband-at-size-1
 * policy, a side-effecting decision that doesn't belong in this pure module). */
export function removePartyMember(party, memberId) {
  const memberIds = party.memberIds.filter((id) => id !== memberId);
  if (memberIds.length === 0) return null;
  const leaderId = party.leaderId === memberId ? memberIds[0] : party.leaderId;
  return { ...party, leaderId, memberIds };
}
