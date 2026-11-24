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
// Rebuild on load: the bundle may be stale if the sources changed outside the app (git checkout, another editor).
ipcMain.handle("project:load", async () => ({ ...(await core({ cmd: "project.build" }).then(() => core({ cmd: "project.inspect" }))),
  test: { frame: +process.env.VEYRA_FRAME || 0, edit: !!process.env.VEYRA_TEST_EDIT, prop: process.env.VEYRA_TEST_PROP || "" } }));
ipcMain.handle("file:read", async (_, rel) => (await core({ cmd: "file.read", path: rel })).text);
ipcMain.handle("file:write", async (_, rel, text) => { try { await core({ cmd: "file.write", path: rel, text }); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle("core:cmd", (_, req) => core(req).then(r => ({ ok: true, result: r }), e => ({ ok: false, error: e.message })));
ipcMain.handle("render:start", e => {
  const send = l => e.sender.send("render:event", JSON.stringify(l));
  core({ cmd: "render.start" }, send).then(() => send({ event: "exit", code: 0 }), err => { send({ event: "exit", code: 1 }); send({ event: "error", msg: err.message }); });
  return true;
});
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, backgroundColor: "#0d0f17", title: "Veyra Studio",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false } });
  await win.loadFile(path.join(__dirname, "dist/index.html"));
  // Test harness: VEYRA_TEST_DRAG="id:move|l|r:dxPixels,..." replays real mouse input on timeline clips.
  if (process.env.VEYRA_TEST_DRAG) setTimeout(async () => {
    for (const step of process.env.VEYRA_TEST_DRAG.split(",")) {
      const [id, mode, dx] = step.split(":");
      const r = await win.webContents.executeJavaScript(`(() => { const el = document.querySelector('.clip[data-id="${id}"]'); el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return { x: b.left, y: b.top + b.height / 2, w: b.width }; })()`);
      const sx = Math.round(mode === "move" ? r.x + r.w / 2 : mode === "l" ? r.x + 2 : r.x + r.w - 2), y = Math.round(r.y);
      const ev = (type, x) => win.webContents.sendInputEvent({ type, x: Math.round(x), y, button: "left", clickCount: 1 });
      ev("mouseMove", sx); ev("mouseDown", sx);
      for (let i = 1; i <= 10; i++) { ev("mouseMove", sx + (+dx) * i / 10); await new Promise(r => setTimeout(r, 30)); }
      ev("mouseUp", sx + +dx); await new Promise(r => setTimeout(r, 3500));
    }
  }, 4500);
  if (process.env.VEYRA_SHOT) setTimeout(async () => {
    fs.writeFileSync(process.env.VEYRA_SHOT, (await win.webContents.capturePage()).toPNG()); app.quit();
  }, +process.env.VEYRA_SHOT_MS || 7000);
});
