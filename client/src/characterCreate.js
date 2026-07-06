// Pre-game character creation screen. Gathers a display name + a color from a
// small fixed palette before the client ever opens a socket connection, then
// hands the choice off to main.js to kick off the actual game/network setup.
//
// This is intentionally lightweight (no accounts/passwords) — it replaces the
// old "auto-assign a random name and color on connect" flow with an explicit
// step the player takes before joining. Real persistent accounts are a later,
// separate roadmap item (see ROADMAP.md, "Basic account/login").

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

/**
 * Wires up the #login-screen overlay already present in index.html. Calls
 * `onEnter({ name, color })` once the player submits a valid character and
 * hides the overlay.
 */
export function initCharacterCreate(onEnter) {
  const screen = document.getElementById("login-screen");
  const nameInput = document.getElementById("name-input");
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
    errorEl.textContent = "";
    screen.classList.add("hidden");
    onEnter({ name, color: selectedColor });
  }

  enterBtn.addEventListener("click", submit);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });

  nameInput.focus();
}
