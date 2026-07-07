// Post-login character-select screen.
//
// An account (server/accountStore.js) can now own several characters (see
// server/characterStore.js) instead of always being exactly one — this
// screen shows up right after a successful login (see main.js's
// "accountReady" handling) and lets the player either click an existing
// character to resume it, or create a new one (name + color + class, the
// same three choices the old single-screen login used to gather up front).
//
// Mirrors client/src/characterCreate.js's structure closely (same palette,
// same CLASSES copy of server/classes.js, same show/hide + showError
// controller shape) since this screen is really "the rest of that same
// pre-game flow", just split into its own file/overlay now that there are
// two distinct steps instead of one.

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

// Mirrors server/classes.js's CHARACTER_CLASSES ids/names/descriptions (kept
// as a separate client-side copy, same pattern as PALETTE above, since this
// screen renders before the server has sent anything beyond the account's
// existing character list). A class is chosen once at character creation
// and locked in forever after by the server (see server/index.js's
// joinWorldAsCharacter).
const CLASSES = [
  { id: "warrior", name: "Warrior", description: "Balanced fighter — steady HP and damage." },
  { id: "paladin", name: "Paladin", description: "Tanky defender — highest HP, softest hits." },
  { id: "rogue", name: "Rogue", description: "Fragile striker — lowest HP, hardest hits." },
  { id: "mage", name: "Mage", description: "Glass cannon — low HP, strong hits, and a ranged Arcane Bolt spell." },
];

const NAME_PATTERN = /^[A-Za-z0-9 _-]{1,20}$/;

/**
 * Wires up the #character-select-screen overlay already present in
 * index.html.
 *
 * `handlers.onSelect(name)` fires when the player clicks an existing
 * character's tile. `handlers.onCreate({ name, color, characterClass })`
 * fires when the player submits the "new character" form. Neither hides the
 * screen itself — that only happens once the server actually confirms the
 * join (see main.js's "init" handler calling the returned `hide()`), so a
 * request that gets rejected (name taken, account full, etc. — see
 * "characterActionRejected") leaves the player right where they were with
 * `showError()` explaining why, instead of flashing back and forth between
 * screens.
 */
export function initCharacterSelect(handlers) {
  const screen = document.getElementById("character-select-screen");
  const accountLabelEl = document.getElementById("character-select-account-label");
  const listEl = document.getElementById("character-list");
  const errorEl = document.getElementById("character-select-error");

  const newBtn = document.getElementById("character-create-new-btn");
  const form = document.getElementById("character-create-form");
  const nameInput = document.getElementById("character-name-input");
  const swatchesEl = document.getElementById("character-color-swatches");
  const classOptionsEl = document.getElementById("character-class-options");
  const confirmBtn = document.getElementById("character-create-confirm-btn");
  const cancelBtn = document.getElementById("character-create-cancel-btn");

  let selectedColor = PALETTE[0];
  let selectedClass = CLASSES[0].id;

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

  CLASSES.forEach((cls, i) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "class-option" + (i === 0 ? " selected" : "");
    option.title = cls.description;
    option.textContent = cls.name;
    option.addEventListener("click", () => {
      selectedClass = cls.id;
      classOptionsEl.querySelectorAll(".class-option").forEach((el) => el.classList.remove("selected"));
      option.classList.add("selected");
    });
    classOptionsEl.appendChild(option);
  });

  /** Shows the "create a new character" form and hides the "+ New
   * Character" button that opens it (re-shown by hideCreateForm()). */
  function showCreateForm() {
    form.classList.remove("hidden");
    newBtn.classList.add("hidden");
    nameInput.value = "";
    errorEl.textContent = "";
    nameInput.focus();
  }

  function hideCreateForm() {
    form.classList.add("hidden");
    newBtn.classList.remove("hidden");
  }

  function submitCreate() {
    const name = nameInput.value.trim();
    if (!NAME_PATTERN.test(name)) {
      errorEl.textContent = "Enter a name: 1-20 characters (letters, numbers, spaces, - or _).";
      return;
    }
    errorEl.textContent = "";
    handlers.onCreate?.({ name, color: selectedColor, characterClass: selectedClass });
  }

  newBtn.addEventListener("click", showCreateForm);
  cancelBtn.addEventListener("click", hideCreateForm);
  confirmBtn.addEventListener("click", submitCreate);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitCreate();
  });

  /** Rebuilds the clickable roster of existing characters from scratch —
   * called every time `show()` runs, since the list can only change between
   * screen appearances (a fresh "accountReady" per connection attempt), not
   * while this screen is already up. */
  function renderList(characters) {
    listEl.innerHTML = "";
    for (const c of characters) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "character-tile";
      const swatch = document.createElement("span");
      swatch.className = "character-tile-swatch";
      swatch.style.background = c.color || "#7ee0ff";
      const label = document.createElement("span");
      label.className = "character-tile-label";
      const className = CLASSES.find((cls) => cls.id === c.characterClass)?.name || c.characterClass;
      label.textContent = `${c.name} — Level ${c.level} ${className}`;
      tile.appendChild(swatch);
      tile.appendChild(label);
      tile.addEventListener("click", () => handlers.onSelect?.(c.name));
      listEl.appendChild(tile);
    }
  }

  return {
    /**
     * Shows the screen for `{ accountName, newAccount, characters }` (the
     * shape server/index.js's "accountReady" event sends). An account with
     * no characters yet (brand new, or every character somehow removed —
     * there's no delete feature yet, so in practice only "brand new") skips
     * straight to the creation form rather than showing an empty list with
     * nothing to click.
     */
    show({ accountName, newAccount, characters }) {
      accountLabelEl.textContent = newAccount
        ? `Account "${accountName}" created — create your first character.`
        : `Playing as account "${accountName}"`;
      renderList(characters || []);
      errorEl.textContent = "";
      if (!characters || characters.length === 0) {
        showCreateForm();
      } else {
        hideCreateForm();
      }
      screen.classList.remove("hidden");
    },

    /** Hides the screen once the server confirms the chosen/created
     * character actually joined the world (see main.js's "init" handler). */
    hide() {
      screen.classList.add("hidden");
    },

    /** Shows a rejection reason (name taken, account full, unknown
     * character, etc. — see "characterActionRejected") without losing
     * whatever the player already had on screen, so they can immediately
     * correct and retry. */
    showError(message) {
      errorEl.textContent = message;
    },
  };
}
