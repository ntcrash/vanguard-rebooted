// Vanguard Rebooted — mob aggro AI
//
// Pure targeting/movement math for mobs that have been struck and are now
// hostile toward their attacker, mirroring the "pure logic in its own file"
// pattern used by quests.js/parties.js/voiceProximity.js so it can be
// unit-tested without booting the socket.io server. index.js owns the
// side effects (mutating live mob/player objects, emitting socket events) —
// this module only computes "where should the mob move" and "is it allowed
// to attack right now" as plain data.
//
// A mob starts purely passive (see tickMobs' wander branch in index.js).
// Landing a hit on it (see the `attack` handler) calls acquireAggro() to
// make it hostile toward that specific player: it chases and periodically
// strikes back until the target dies/disconnects/flees beyond leash range,
// or the mob itself dies, at which point it reverts to wandering.

export const MOB_LEASH_RANGE = 25; // if the target strays this far from the mob's *home*, it gives up and resumes wandering
export const MOB_CHASE_SPEED = 2.4; // units/sec while chasing an aggro target — faster than passive wandering (MOB_SPEED = 1.4)
export const MOB_AGGRO_ATTACK_INTERVAL_MS = 1400; // minimum time between an aggroed mob's attacks
export const MOB_CHASE_ARRIVE_DIST = 0.4; // matches MOB_ARRIVE_DIST used for wandering

/** Marks `mob` as hostile toward `targetId`, resetting its attack timer so
 * it doesn't get a "free" instant hit the moment it acquires aggro (the
 * player who just landed the triggering hit gets a brief window before the
 * mob can strike back). */
export function acquireAggro(mob, targetId, now) {
  mob.aggroTargetId = targetId;
  mob.nextAttackAt = now + MOB_AGGRO_ATTACK_INTERVAL_MS;
}

/** Clears aggro — e.g. once the mob or its target dies, or the target has
 * fled beyond leash range. Safe to call on a mob that has no aggro target. */
export function dropAggro(mob) {
  mob.aggroTargetId = null;
  mob.nextAttackAt = 0;
}

/** True if a mob currently chasing `target` should give up: the target is
 * missing (disconnected) or dead, or has led the mob further from the mob's
 * *home* spawn point than `leashRange`. Measuring from home (not the mob's
 * current position) keeps a chase bounded to roughly its home territory
 * rather than letting the mob drift indefinitely as it pursues. */
export function shouldDropAggro(mob, target, leashRange = MOB_LEASH_RANGE) {
  if (!target || !target.alive) return true;
  const dx = target.x - mob.homeX;
  const dz = target.z - mob.homeZ;
  return Math.hypot(dx, dz) > leashRange;
}

/** Computes one tick's movement step from (x, z) toward (targetX, targetZ)
 * at `speed` units/sec over `dt` seconds, shared by both wandering (target
 * = a random point) and aggro-chasing (target = the hostile player's live
 * position) — both just move a fixed distance toward *some* point and face
 * that direction. Returns the new x/z/rotY plus whether it has now arrived
 * (within MOB_CHASE_ARRIVE_DIST). */
export function stepToward(x, z, targetX, targetZ, speed, dt) {
  const dx = targetX - x;
  const dz = targetZ - z;
  const dist = Math.hypot(dx, dz);
  if (dist < MOB_CHASE_ARRIVE_DIST) {
    return { x, z, rotY: Math.atan2(dx, dz), arrived: true };
  }
  const step = Math.min(dist, speed * dt);
  return {
    x: x + (dx / dist) * step,
    z: z + (dz / dist) * step,
    rotY: Math.atan2(dx, dz),
    arrived: false,
  };
}

/** True if enough time has passed since `mob`'s last attack for it to strike
 * again. Callers must separately confirm the target is within attack range
 * before actually applying damage — this only gates the cooldown. */
export function canMobAttack(mob, now) {
  return now >= (mob.nextAttackAt || 0);
}
