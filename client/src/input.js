// Tracks keyboard + mouse-drag state. Pauses movement keys while the chat input is focused.

export const keys = { forward: false, back: false, left: false, right: false, sprint: false };

export const mouse = {
  dragging: false,
  lastX: 0,
  deltaAzimuth: 0, // radians accumulated since last read
  deltaElevation: 0,
  wheel: 0, // accumulated scroll since last read
};

// Edge-triggered attack request: set true on a left-click or the attack
// keybind, and cleared by main.js once it's been consumed for a frame.
export const attack = { requested: false };

// Edge-triggered spell-cast request: set true on the spell keybind (or the
// touch spell button), and cleared by main.js once it's been consumed for a
// frame. Deliberately separate from `attack` above -- a class's spell (see
// server/spells.js) has its own independent cooldown/level-gate, so it
// shouldn't share a single "requested" flag with the plain melee attack.
export const spellCast = { requested: false };

// Edge-triggered inventory-panel toggle: set true on the inventory keybind,
// and cleared by main.js once it's been consumed for a frame.
export const inventoryToggle = { requested: false };

// Edge-triggered quest-log-panel toggle: set true on the quest log keybind,
// and cleared by main.js once it's been consumed for a frame.
export const questLogToggle = { requested: false };

// Edge-triggered party-panel toggle: set true on the party keybind, and
// cleared by main.js once it's been consumed for a frame.
export const partyToggle = { requested: false };

// Edge-triggered mic on/off toggle (proximity voice chat, see voice.js): set
// true on the mic keybind/button, and cleared by main.js once it's been
// consumed for a frame.
export const micToggle = { requested: false };

// Edge-triggered Esc game-menu-panel toggle (Resume/Save/Exit): set true on
// the Escape keybind/touch button, and cleared by main.js once it's been
// consumed for a frame. Same pattern as the other panel toggles above.
export const menuToggle = { requested: false };

// Edge-triggered store-panel toggle (server/store.js's merchant NPC): set
// true on the store keybind/button, and cleared by main.js once it's been
// consumed for a frame. Same edge-triggered pattern as the other panel
// toggles above -- whether it actually opens the panel (vs. showing a "move
// closer" hint) is main.js's call, based on distance to the NPC.
export const storeToggle = { requested: false };

// Edge-triggered quest-board-panel toggle (server/questNpc.js's quest-giver
// NPC): set true on the quest-NPC keybind/button, and cleared by main.js
// once it's been consumed for a frame. Same proximity-gated pattern as
// storeToggle above -- distinct from questLogToggle, which opens the
// always-available "L" quest log regardless of position.
export const questNpcToggle = { requested: false };

// Converts a raw pointer-drag delta (dx, dy in screen px) into camera
// azimuth/elevation deltas. Pure/exported so the sign convention can be unit
// tested without a browser. Vertical (elevation) matches the conventional
// "non-inverted" mouse-look feel used by most first/third-person games:
// dragging the pointer up (dy negative) looks up (elevation decreases,
// swinging the orbit camera down toward eye level), dragging down (dy
// positive) looks down (elevation increases, swinging the camera up and
// over the player). Previously this was backwards — dragging up made the
// camera swing up and look down, dragging down made it look up — which was
// the "Mouse needs to be inverted" bug.
export const MOUSE_SENSITIVITY = 0.005;
export function mouseDeltaToLook(dx, dy, sensitivity = MOUSE_SENSITIVITY) {
  return {
    deltaAzimuth: -dx * sensitivity,
    deltaElevation: dy * sensitivity,
  };
}

// On-screen movement joystick tuning, in px of finger travel from the base's
// center. Exported as pure helpers (no DOM) so the direction/clamping math
// can be unit tested without a browser.
export const JOYSTICK_DEADZONE = 16;
export const JOYSTICK_RADIUS = 50;

// Clamps a (dx, dy) offset to a maximum radius, preserving direction.
export function clampToRadius(dx, dy, radius) {
  const dist = Math.hypot(dx, dy);
  if (dist <= radius || dist === 0) return { x: dx, y: dy };
  const scale = radius / dist;
  return { x: dx * scale, y: dy * scale };
}

// Converts a joystick offset into the same forward/back/left/right booleans
// keyboard input produces, so movement code doesn't need to know the input
// came from a touch joystick vs. WASD. Diagonal offsets naturally set two
// flags at once, same as pressing two keys together.
export function joystickVectorToKeys(dx, dy, deadzone) {
  return {
    forward: dy < -deadzone,
    back: dy > deadzone,
    left: dx < -deadzone,
    right: dx > deadzone,
  };
}

function chatFocused() {
  return document.activeElement && document.activeElement.id === "chat-input";
}

const KEY_MAP = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
};

// A "click" (as opposed to a camera-drag) is a left mouse press that's
// released quickly and without much movement.
const CLICK_MOVE_THRESHOLD = 6; // px
const CLICK_TIME_THRESHOLD = 300; // ms

export function initInput(canvas) {
  let downX = 0;
  let downY = 0;
  let downAt = 0;

  window.addEventListener("keydown", (e) => {
    if (chatFocused()) return;
    const action = KEY_MAP[e.code];
    if (action) keys[action] = true;
    if (e.code === "Space" || e.code === "KeyF") {
      e.preventDefault();
      attack.requested = true;
    }
    if (e.code === "KeyQ") {
      e.preventDefault();
      spellCast.requested = true;
    }
    if (e.code === "KeyI") {
      e.preventDefault();
      inventoryToggle.requested = true;
    }
    if (e.code === "KeyL") {
      e.preventDefault();
      questLogToggle.requested = true;
    }
    if (e.code === "KeyP") {
      e.preventDefault();
      partyToggle.requested = true;
    }
    if (e.code === "KeyV") {
      e.preventDefault();
      micToggle.requested = true;
    }
    if (e.code === "Escape") {
      e.preventDefault();
      menuToggle.requested = true;
    }
    if (e.code === "KeyB") {
      e.preventDefault();
      storeToggle.requested = true;
    }
    if (e.code === "KeyN") {
      e.preventDefault();
      questNpcToggle.requested = true;
    }
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
      keys.sprint = true;
    }
  });

  window.addEventListener("keyup", (e) => {
    const action = KEY_MAP[e.code];
    if (action) keys[action] = false;
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
      keys.sprint = false;
    }
  });

  // Clear movement if the window loses focus (avoids "stuck key" bugs).
  window.addEventListener("blur", () => {
    keys.forward = keys.back = keys.left = keys.right = keys.sprint = false;
  });

  canvas.addEventListener("mousedown", (e) => {
    mouse.dragging = true;
    mouse.lastX = e.clientX;
    mouse.lastY = e.clientY;
    downX = e.clientX;
    downY = e.clientY;
    downAt = performance.now();
  });
  window.addEventListener("mouseup", (e) => {
    mouse.dragging = false;
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    const elapsed = performance.now() - downAt;
    if (e.button === 0 && moved < CLICK_MOVE_THRESHOLD && elapsed < CLICK_TIME_THRESHOLD) {
      attack.requested = true;
    }
  });
  window.addEventListener("mousemove", (e) => {
    if (!mouse.dragging) return;
    const dx = e.clientX - mouse.lastX;
    const dy = e.clientY - mouse.lastY;
    mouse.lastX = e.clientX;
    mouse.lastY = e.clientY;
    const look = mouseDeltaToLook(dx, dy);
    mouse.deltaAzimuth += look.deltaAzimuth;
    mouse.deltaElevation += look.deltaElevation;
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      mouse.wheel += e.deltaY * 0.01;
    },
    { passive: false }
  );

  setupTouchControls(canvas);
}

// Mobile/touch controls: a virtual joystick for movement, tap-and-hold
// buttons for sprint/attack/inventory, and single-finger drag-anywhere on
// the canvas for camera rotation (mirroring the mouse-drag behavior above).
// All of it feeds the same shared `keys`/`mouse`/`attack`/`inventoryToggle`
// state, so main.js's movement/attack/inventory logic doesn't need to know
// whether the input came from a keyboard/mouse or a touchscreen. No-ops
// gracefully if the touch-control DOM elements aren't present.
function setupTouchControls(canvas) {
  const joystickBase = document.getElementById("touch-joystick-base");
  const joystickKnob = document.getElementById("touch-joystick-knob");
  const sprintBtn = document.getElementById("touch-sprint-btn");
  const attackBtn = document.getElementById("touch-attack-btn");
  const spellBtn = document.getElementById("touch-spell-btn");
  const inventoryBtn = document.getElementById("touch-inventory-btn");
  const questBtn = document.getElementById("touch-quest-btn");
  const partyBtn = document.getElementById("touch-party-btn");
  const micBtn = document.getElementById("touch-mic-btn");
  const menuBtn = document.getElementById("touch-menu-btn");
  const storeBtn = document.getElementById("touch-store-btn");
  const questNpcBtn = document.getElementById("touch-quest-npc-btn");

  let joystickTouchId = null;
  let joystickCenterX = 0;
  let joystickCenterY = 0;

  function resetJoystick() {
    keys.forward = keys.back = keys.left = keys.right = false;
    if (joystickKnob) joystickKnob.style.transform = "translate(0px, 0px)";
  }

  if (joystickBase) {
    joystickBase.addEventListener(
      "touchstart",
      (e) => {
        if (joystickTouchId !== null) return;
        const touch = e.changedTouches[0];
        const rect = joystickBase.getBoundingClientRect();
        joystickCenterX = rect.left + rect.width / 2;
        joystickCenterY = rect.top + rect.height / 2;
        joystickTouchId = touch.identifier;
        e.preventDefault();
      },
      { passive: false }
    );

    window.addEventListener(
      "touchmove",
      (e) => {
        if (joystickTouchId === null) return;
        const touch = Array.from(e.changedTouches).find((t) => t.identifier === joystickTouchId);
        if (!touch) return;
        e.preventDefault();
        const raw = { x: touch.clientX - joystickCenterX, y: touch.clientY - joystickCenterY };
        const clamped = clampToRadius(raw.x, raw.y, JOYSTICK_RADIUS);
        if (joystickKnob) joystickKnob.style.transform = `translate(${clamped.x}px, ${clamped.y}px)`;
        const dirKeys = joystickVectorToKeys(clamped.x, clamped.y, JOYSTICK_DEADZONE);
        keys.forward = dirKeys.forward;
        keys.back = dirKeys.back;
        keys.left = dirKeys.left;
        keys.right = dirKeys.right;
      },
      { passive: false }
    );

    const endJoystickTouch = (e) => {
      if (joystickTouchId === null) return;
      const touch = Array.from(e.changedTouches).find((t) => t.identifier === joystickTouchId);
      if (!touch) return;
      joystickTouchId = null;
      resetJoystick();
    };
    window.addEventListener("touchend", endJoystickTouch);
    window.addEventListener("touchcancel", endJoystickTouch);
  }

  if (sprintBtn) {
    const setSprint = (on) => (e) => {
      e.preventDefault();
      keys.sprint = on;
      sprintBtn.classList.toggle("active", on);
    };
    sprintBtn.addEventListener("touchstart", setSprint(true), { passive: false });
    sprintBtn.addEventListener("touchend", setSprint(false));
    sprintBtn.addEventListener("touchcancel", setSprint(false));
  }

  if (attackBtn) {
    attackBtn.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        attack.requested = true;
      },
      { passive: false }
    );
  }

  if (spellBtn) {
    spellBtn.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        spellCast.requested = true;
      },
      { passive: false }
    );
  }

  if (inventoryBtn) {
    inventoryBtn.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        inventoryToggle.requested = true;
      },
      { passive: false }
    );
  }

  if (questBtn) {
    questBtn.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        questLogToggle.requested = true;
      },
      { passive: false }
    );
  }

  if (partyBtn) {
    partyBtn.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        partyToggle.requested = true;
      },
      { passive: false }
    );
  }

  if (micBtn) {
    micBtn.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        micToggle.requested = true;
      },
      { passive: false }
    );
  }

  if (menuBtn) {
    menuBtn.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        menuToggle.requested = true;
      },
      { passive: false }
    );
  }

  if (storeBtn) {
    storeBtn.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        storeToggle.requested = true;
      },
      { passive: false }
    );
  }

  if (questNpcBtn) {
    questNpcBtn.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        questNpcToggle.requested = true;
      },
      { passive: false }
    );
  }

  // Single-finger drag anywhere else on the canvas rotates the camera,
  // same math as the mousemove handler above, tracked by touch identifier
  // so it doesn't fight with the joystick/button touches.
  let cameraTouchId = null;
  canvas.addEventListener(
    "touchstart",
    (e) => {
      if (cameraTouchId !== null) return;
      const touch = e.changedTouches[0];
      cameraTouchId = touch.identifier;
      mouse.dragging = true;
      mouse.lastX = touch.clientX;
      mouse.lastY = touch.clientY;
    },
    { passive: true }
  );
  canvas.addEventListener(
    "touchmove",
    (e) => {
      if (cameraTouchId === null) return;
      const touch = Array.from(e.changedTouches).find((t) => t.identifier === cameraTouchId);
      if (!touch) return;
      const dx = touch.clientX - mouse.lastX;
      const dy = touch.clientY - mouse.lastY;
      mouse.lastX = touch.clientX;
      mouse.lastY = touch.clientY;
      const look = mouseDeltaToLook(dx, dy);
      mouse.deltaAzimuth += look.deltaAzimuth;
      mouse.deltaElevation += look.deltaElevation;
    },
    { passive: true }
  );
  const endCameraTouch = (e) => {
    if (cameraTouchId === null) return;
    const touch = Array.from(e.changedTouches).find((t) => t.identifier === cameraTouchId);
    if (!touch) return;
    cameraTouchId = null;
    mouse.dragging = false;
  };
  canvas.addEventListener("touchend", endCameraTouch);
  canvas.addEventListener("touchcancel", endCameraTouch);
}
