// Preload script for the Vanguard Rebooted desktop client window.
//
// Runs in an isolated context with access to a small, explicit slice of
// Electron/Node APIs, bridged into the page via contextBridge (nodeIntegration
// stays off in desktop/main.js's BrowserWindow, per Electron's own security
// guidance). The web client (client/src/*) doesn't need any native/desktop-
// only capability today -- this file exists mainly as the wiring point for
// one later (e.g. a "running in the desktop app" badge, native notifications,
// or a custom title bar) rather than exposing anything functional yet.
"use strict";

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("vanguardDesktop", {
  isElectron: true,
});
