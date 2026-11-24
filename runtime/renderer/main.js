// Headless frame renderer: one fixed Chromium (Electron), one PNG per frame.
// Orchestration, caching and muxing live in the Rust core (crates/veyra-render); this process only draws frames.
//   --probe : read the <Composition> declared in code and write .veyra/composition.json, then exit.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path");
const project = require("../../veyra.project.json");
const probe = process.argv.includes("--probe");
const fail = msg => { console.log(JSON.stringify({ event: "error", msg })); app.exit(1); };
const fpsOf = v => typeof v === "number" ? { num: v, den: 1 } : typeof v === "string" ? { num: +v.split("/")[0], den: +(v.split("/")[1] ?? 1) } : v;
app.disableHardwareAcceleration(); // favour reproducibility over speed
app.whenReady().then(async () => {
  try {
    fs.mkdirSync(".veyra", { recursive: true });
    const win = new BrowserWindow({ show: false, width: project.width, height: project.height, useContentSize: true,
      webPreferences: { offscreen: false, backgroundThrottling: false } });
    await win.loadFile(path.resolve("runtime/composition/index.html"));
    await win.webContents.executeJavaScript("window.__veyra.ready");
    const compFile = path.resolve(".veyra/composition.json");
    if (probe) {
      // run inside the page so the real error text (e.g. "fps 29.97 is not an integer ...") survives
      const r = await win.webContents.executeJavaScript("(() => { try { return { c: window.__veyra.config() }; } catch (e) { return { err: String(e && e.message || e) }; } })()");
      if (r.err) return fail(r.err);
      const c = r.c;
      fs.writeFileSync(compFile, JSON.stringify(c ?? { id: project.id, width: project.width, height: project.height, fps: fpsOf(project.fps), durationInFrames: project.durationInFrames }));
      console.log(JSON.stringify({ event: "probe", composition: c ? c.id : "(project.json defaults)" }));
      return app.quit();
    }
    const cfg = JSON.parse(fs.readFileSync(compFile, "utf8"));
    win.setContentSize(cfg.width, cfg.height);
    const out = path.resolve(".veyra/frames");
    fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
    const t0 = Date.now();
    for (let f = 0; f < cfg.durationInFrames; f++) {
      await win.webContents.executeJavaScript(`window.__veyra.setFrame(${f})`);
      fs.writeFileSync(path.join(out, String(f).padStart(5, "0") + ".png"), (await win.webContents.capturePage()).toPNG());
      console.log(JSON.stringify({ event: "progress", frame: f + 1, total: cfg.durationInFrames }));
    }
    const write = (name, data) => fs.writeFileSync(path.resolve(".veyra", name), JSON.stringify({ clips: data }, null, 1));
    write("audio.json", await win.webContents.executeJavaScript("window.__veyra.audio()"));
    const tl = await win.webContents.executeJavaScript("window.__veyra.timeline()");
    fs.writeFileSync(path.resolve(".veyra/timeline.json"), JSON.stringify({ fps: cfg.fps, duration: cfg.durationInFrames, clips: tl }, null, 1));
    console.log(JSON.stringify({ event: "done", ms: Date.now() - t0 }));
    app.quit();
  } catch (e) { fail(String(e.message || e)); }
});
