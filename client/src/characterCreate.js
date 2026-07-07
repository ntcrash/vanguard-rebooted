// Pre-game login screen. Gathers a username + password (accounts, see
// server/accountStore.js) before the client ever opens a socket connection,
// then hands the choice off to main.js to kick off the actual network setup.
//
// This used to also gather a color + character class right here, back when
// an account mapped 1:1 onto a single character created the moment the
// account itself was created. Now an account can own several characters
// (see server/characterStore.js) — color and class are chosen per-character
// on the new character-select screen (client/src/characterSelect.js) that
// appears *after* a successful login, not bundled into this screen anymore.
//
// The server still rejects the connection outright on a wrong password (see
// main.js's onConnectError, which re-shows this screen with the server's
// error message so the player can retry).

const NAME_PATTERN = /^[A-Za-z0-9 _-]{1,20}$/;
const PASSWORD_MIN_LENGTH = 4;
const PASSWORD_MAX_LENGTH = 64;

/**
 * Wires up the #login-screen overlay already present in index.html. Calls
 * `onEnter({ name, password })` once the player submits a valid login and
 * hides the overlay.
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
  const enterBtn = document.getElementById("enter-world-btn");
  const errorEl = document.getElementById("login-error");

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
    onEnter({ name, password });
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
