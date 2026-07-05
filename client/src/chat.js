// Wires up the chat log + input box. Kept separate from main.js so the
// render loop file doesn't get cluttered with DOM bookkeeping.

const MAX_LINES = 50;

export function initChat(onSend) {
  const log = document.getElementById("chat-log");
  const input = document.getElementById("chat-input");

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const text = input.value.trim();
      if (text) {
        onSend(text);
        input.value = "";
      }
      input.blur();
    } else if (e.key === "Escape") {
      input.value = "";
      input.blur();
    }
    e.stopPropagation();
  });

  return {
    addLine(name, text, isSelf) {
      const line = document.createElement("div");
      line.className = "line";
      line.innerHTML = `<span class="name" style="${isSelf ? "color:#7ee0ff" : ""}">${escapeHtml(
        name
      )}:</span><span class="text">${escapeHtml(text)}</span>`;
      log.appendChild(line);
      while (log.children.length > MAX_LINES) log.removeChild(log.firstChild);
      log.scrollTop = log.scrollHeight;
    },
    addSystemLine(text) {
      const line = document.createElement("div");
      line.className = "line";
      line.style.opacity = "0.7";
      line.style.fontStyle = "italic";
      line.textContent = text;
      log.appendChild(line);
      while (log.children.length > MAX_LINES) log.removeChild(log.firstChild);
      log.scrollTop = log.scrollHeight;
    },
  };
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
