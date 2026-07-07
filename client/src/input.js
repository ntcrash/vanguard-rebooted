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

// Edge-triggered inventory-panel toggle: set true on the inventory keybind,
// and cleared by main.js once it's been consumed for a frame.
export const inventoryToggle = { requested: false };

// Edge-triggered quest-log-panel toggle: set true on the quest log keybind,
// and cleared by main.js once it's been consumed for a frame.
export const questLogToggle = { requested: false };

// Edge-triggered party-panel toggle: set true on the party keybind, and
// cleared by main.js once it's been consumed for a frame.
export const partyToggle = { requested: false };

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
    mouse.deltaAzimuth -= dx * 0.005;
    mouse.deltaElevation -= dy * 0.005;
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
  const inventoryBtn = document.getElementById("touch-inventory-btn");
  const questBtn = document.getElementById("touch-quest-btn");
  const partyBtn = document.getElementById("touch-party-btn");

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
      mouse.deltaAzimuth -= dx * 0.005;
      mouse.deltaElevation -= dy * 0.005;
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
