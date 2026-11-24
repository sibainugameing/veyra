// Thin Electron shell. All project logic (files, build, validate, render, cache, mux) is in the Rust core:
// each IPC call spawns `veyra api '<json>'` and relays its JSON-lines output.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path"), fs = require("node:fs");
const { spawn } = require("node:child_process");
const ROOT = path.resolve(process.env.VEYRA_PROJECT || path.join(__dirname, "../.."));
const CORE = process.env.VEYRA_CORE || path.join(ROOT, "target/release/veyra");

function core(req, onEvent = () => {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(CORE, ["--project", ROOT, "api", JSON.stringify(req)]); let buf = "", last = null;
    c.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const m = JSON.parse(l); if (m.event) onEvent(m.event); else last = m; } catch { /* ignore */ } } });
    c.on("error", e => reject(new Error(`cannot run Rust core (${CORE}): ${e.message}`)));
    c.on("close", () => last ? (last.ok ? resolve(last.result) : reject(new Error(last.error))) : reject(new Error("core returned nothing")));
  });
}
ipcMain.handle("project:load", async () => ({ ...(await core({ cmd: "project.inspect" })),
  test: { frame: +process.env.VEYRA_FRAME || 0, edit: !!process.env.VEYRA_TEST_EDIT } }));
ipcMain.handle("file:read", async (_, rel) => (await core({ cmd: "file.read", path: rel })).text);
ipcMain.handle("file:write", async (_, rel, text) => { try { await core({ cmd: "file.write", path: rel, text }); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle("render:start", e => {
  const send = l => e.sender.send("render:event", JSON.stringify(l));
  core({ cmd: "render.start" }, send).then(() => send({ event: "exit", code: 0 }), err => { send({ event: "exit", code: 1 }); send({ event: "error", msg: err.message }); });
  return true;
});
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, backgroundColor: "#0d0f17", title: "Veyra Studio",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false } });
  await win.loadFile(path.join(__dirname, "dist/index.html"));
  if (process.env.VEYRA_SHOT) setTimeout(async () => {
    fs.writeFileSync(process.env.VEYRA_SHOT, (await win.webContents.capturePage()).toPNG()); app.quit();
  }, +process.env.VEYRA_SHOT_MS || 7000);
});
