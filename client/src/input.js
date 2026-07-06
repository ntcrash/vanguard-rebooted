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
}
