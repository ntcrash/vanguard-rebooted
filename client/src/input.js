// Tracks keyboard + mouse-drag state. Pauses movement keys while the chat input is focused.

export const keys = { forward: false, back: false, left: false, right: false };

export const mouse = {
  dragging: false,
  lastX: 0,
  deltaAzimuth: 0, // radians accumulated since last read
  deltaElevation: 0,
  wheel: 0, // accumulated scroll since last read
};

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

export function initInput(canvas) {
  window.addEventListener("keydown", (e) => {
    if (chatFocused()) return;
    const action = KEY_MAP[e.code];
    if (action) keys[action] = true;
  });

  window.addEventListener("keyup", (e) => {
    const action = KEY_MAP[e.code];
    if (action) keys[action] = false;
  });

  // Clear movement if the window loses focus (avoids "stuck key" bugs).
  window.addEventListener("blur", () => {
    keys.forward = keys.back = keys.left = keys.right = false;
  });

  canvas.addEventListener("mousedown", (e) => {
    mouse.dragging = true;
    mouse.lastX = e.clientX;
    mouse.lastY = e.clientY;
  });
  window.addEventListener("mouseup", () => {
    mouse.dragging = false;
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
