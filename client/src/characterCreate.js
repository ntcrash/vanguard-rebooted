// Pre-game login screen. Gathers a username + password (accounts, see
// server/accountStore.js) plus a color from a small fixed palette before the
// client ever opens a socket connection, then hands the choice off to
// main.js to kick off the actual game/network setup.
//
// This replaced the old "auto-assign a random name/color on connect" flow
// first with a name-only character-creation step, and now with a real (if
// lightweight) account: the same name+password combo must be used every
// session, and the server rejects the connection outright on a wrong
// password (see main.js's onConnectError, which re-shows this screen with
// the server's error message so the player can retry).

const PALETTE = [
  "hsl(210, 70%, 55%)",
  "hsl(0, 70%, 55%)",
  "hsl(140, 60%, 45%)",
  "hsl(45, 85%, 55%)",
  "hsl(280, 60%, 60%)",
  "hsl(190, 70%, 50%)",
  "hsl(25, 80%, 55%)",
  "hsl(320, 60%, 60%)",
];

const NAME_PATTERN = /^[A-Za-z0-9 _-]{1,20}$/;
const PASSWORD_MIN_LENGTH = 4;
const PASSWORD_MAX_LENGTH = 64;

/**
 * Wires up the #login-screen overlay already present in index.html. Calls
 * `onEnter({ name, color, password })` once the player submits a valid
 * login and hides the overlay.
 *
 * Returns a small controller object so main.js can react to the server
 * accepting/rejecting the login attempt:
 * - `showError(message)`: re-reveals the screen with `message` shown (used
 *   when the server rejects the connection, e.g. wrong password) so the
 *   player can correct it and try again — nothing about a bad password
 *   should let them slip into the world.
 */
export function initCharacterCreate(onEnter) {
  const screen = document.getElementById("login-screen");
  const nameInput = document.getElementById("name-input");
  const passwordInput = document.getElementById("password-input");
  const swatchesEl = document.getElementById("color-swatches");
  const enterBtn = document.getElementById("enter-world-btn");
  const errorEl = document.getElementById("login-error");

  let selectedColor = PALETTE[0];

  PALETTE.forEach((color, i) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "color-swatch" + (i === 0 ? " selected" : "");
    swatch.style.background = color;
    swatch.setAttribute("aria-label", `Color option ${i + 1}`);
    swatch.addEventListener("click", () => {
      selectedColor = color;
      swatchesEl.querySelectorAll(".color-swatch").forEach((el) => el.classList.remove("selected"));
      swatch.classList.add("selected");
    });
    swatchesEl.appendChild(swatch);
  });

  function submit() {
    const name = nameInput.value.trim();
    if (!NAME_PATTERN.test(name)) {
      errorEl.textContent = "Enter a name: 1-20 characters (letters, numbers, spaces, - or _).";
      return;
    }
    const password = passwordInput.value;
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      errorEl.textContent = `Enter a password (${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters).`;
      return;
    }
    errorEl.textContent = "";
    screen.classList.add("hidden");
    onEnter({ name, color: selectedColor, password });
  }

  enterBtn.addEventListener("click", submit);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") passwordInput.focus();
  });
  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });

  nameInput.focus();

  return {
    /** Re-shows the login screen (e.g. after a rejected login attempt) with
     * `message` displayed, and refocuses the password field so the player
     * can immediately retry. */
    showError(message) {
      errorEl.textContent = message;
      screen.classList.remove("hidden");
      passwordInput.value = "";
      passwordInput.focus();
    },
  };
}
