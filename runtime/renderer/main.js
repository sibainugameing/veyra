// Headless frame renderer: one fixed Chromium (Electron), one PNG per frame.
// Orchestration, caching and muxing live in the Rust core (crates/veyra-render); this process only draws frames.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path");
const cfg = require("../../veyra.project.json");
app.disableHardwareAcceleration(); // favour reproducibility over speed in Phase 0
app.whenReady().then(async () => {
  const out = path.resolve(".veyra/frames");
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ show: false, width: cfg.width, height: cfg.height, useContentSize: true,
    webPreferences: { offscreen: false, backgroundThrottling: false } });
  await win.loadFile(path.resolve("runtime/composition/index.html"));
  await win.webContents.executeJavaScript("window.__veyra.ready");
  const t0 = Date.now();
  for (let f = 0; f < cfg.durationInFrames; f++) {
    await win.webContents.executeJavaScript(`window.__veyra.setFrame(${f})`);
    fs.writeFileSync(path.join(out, String(f).padStart(5, "0") + ".png"), (await win.webContents.capturePage()).toPNG());
    console.log(JSON.stringify({ event: "progress", frame: f + 1, total: cfg.durationInFrames }));
  }
  const write = (name, data) => fs.writeFileSync(path.resolve(".veyra", name), JSON.stringify({ fps: cfg.fps, duration: cfg.durationInFrames, clips: data }, null, 1));
  write("audio.json", await win.webContents.executeJavaScript("window.__veyra.audio()"));
  write("timeline.json", await win.webContents.executeJavaScript("window.__veyra.timeline()"));
  console.log(JSON.stringify({ event: "done", ms: Date.now() - t0 }));
  app.quit();
});
