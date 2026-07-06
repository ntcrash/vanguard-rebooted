import * as THREE from "three";

// Floating combat-text numbers: spawned wherever a mob (or, later, a player)
// takes damage, rise a bit, fade out, then remove themselves. Purely a visual
// layer — it never touches gameplay state, just reads world positions that
// main.js hands it.

const RISE_SPEED = 1.3; // world units/sec the number drifts upward
const DURATION_MS = 850; // total lifetime before removal
const HORIZONTAL_JITTER = 0.5; // random spread so stacked hits don't overlap exactly

const _tmp = new THREE.Vector3();

/** Manages a pool of floating damage-number DOM labels positioned over a Three.js scene. */
export class DamageNumbers {
  constructor(container) {
    this.container = container;
    this.active = []; // { el, origin: Vector3, startAt: number }
  }

  /**
   * Spawns a floating number at a world position.
   * @param {THREE.Vector3} worldPos - where the hit landed; not retained, copied internally.
   * @param {number} amount - damage dealt; rendered rounded and prefixed with "-".
   * @param {{ finishing?: boolean }} [opts] - `finishing` styles a killing-blow hit distinctly.
   */
  spawn(worldPos, amount, { finishing = false } = {}) {
    if (!Number.isFinite(amount) || amount <= 0) return;

    const el = document.createElement("div");
    el.className = "damage-number" + (finishing ? " finishing" : "");
    el.textContent = `-${Math.round(amount)}`;
    this.container.appendChild(el);

    const origin = worldPos.clone();
    origin.x += (Math.random() - 0.5) * HORIZONTAL_JITTER;
    origin.z += (Math.random() - 0.5) * HORIZONTAL_JITTER;

    this.active.push({ el, origin, startAt: performance.now() });
  }

  /** Advances every active number's rise/fade and repositions it on screen. Call once per frame. */
  update(camera, screenWidth, screenHeight) {
    if (this.active.length === 0) return;
    const now = performance.now();

    for (let i = this.active.length - 1; i >= 0; i--) {
      const item = this.active[i];
      const elapsedMs = now - item.startAt;
      const progress = elapsedMs / DURATION_MS;

      if (progress >= 1) {
        item.el.remove();
        this.active.splice(i, 1);
        continue;
      }

      _tmp.copy(item.origin);
      _tmp.y += (elapsedMs / 1000) * RISE_SPEED;
      _tmp.project(camera);

      if (_tmp.z > 1) {
        item.el.style.display = "none";
        continue;
      }

      item.el.style.display = "block";
      item.el.style.left = `${(_tmp.x * 0.5 + 0.5) * screenWidth}px`;
      item.el.style.top = `${(-_tmp.y * 0.5 + 0.5) * screenHeight}px`;
      item.el.style.opacity = String(1 - progress);
    }
  }

  /** Removes all active labels immediately (e.g. on teardown). */
  clear() {
    for (const item of this.active) item.el.remove();
    this.active.length = 0;
  }
}
