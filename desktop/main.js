// Electron main process for the Vanguard Rebooted desktop client.
//
// This is a thin native wrapper around the *same* client the browser plays --
// it does not reimplement or fork any game logic, and it does not bundle or
// manage the server. Which server the game talks to (VITE_SERVER_URL) is
// still decided at client *build* time, exactly like any other static host
// (see the root DEPLOYMENT.md) -- this wrapper doesn't add a second,
// separate server-selection mechanism.
//
// Two ways to point this window at content:
//   - Dev:  set ELECTRON_START_URL (e.g. http://localhost:5173, the Vite
//           dev server started via `cd client && npm run dev`) and this
//           loads that URL directly, so you get the client's normal
//           hot-reload dev loop inside a native window instead of a browser
//           tab.
//   - Prod: with no ELECTRON_START_URL set, this loads the already-built
//           static client from client/dist/index.html (built via
//           `cd client && npm run build`).
"use strict";

const { app, BrowserWindow } = require("electron");
const path = require("path");

const DEV_URL = process.env.ELECTRON_START_URL;
const PROD_INDEX_PATH = path.join(
  __dirname,
  "..",
  "client",
  "dist",
  "index.html",
);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Vanguard Rebooted",
    backgroundColor: "#0a0a12",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setMenuBarVisibility(false);

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(PROD_INDEX_PATH);
  }

  return win;
}

app.whenReady().then(() => {
  createWindow();

  // macOS convention: re-create a window when the dock icon is clicked and
  // there are no other windows open.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Standard Electron lifecycle: quit when all windows are closed, except on
// macOS where apps conventionally stay running until the user quits
// explicitly (Cmd+Q).
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
