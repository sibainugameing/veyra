//! Render orchestration: build runtime -> media prep -> cache check -> Chromium (Electron) frames -> FFmpeg mux.
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use veyra_project::Project;

pub fn build_runtime(p: &Project) -> Result<(), String> {
    let o = Command::new("node").arg("scripts/build.mjs").current_dir(&p.root).output().map_err(|e| format!("node: {e}"))?;
    if o.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&o.stderr).chars().take(600).collect()) }
}

fn frame_count(p: &Project) -> usize { std::fs::read_dir(p.root.join(".veyra/frames")).map(|r| r.count()).unwrap_or(0) }

pub fn render(p: &Project, emit: &mut dyn FnMut(Value)) -> Result<Value, String> {
    build_runtime(p)?;
    let key = veyra_media::cache_key(p)?;
    let cached = p.read_file(".veyra/cache.json").ok().and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .map(|v| v["key"] == key.as_str()).unwrap_or(false)
        && frame_count(p) == p.config.duration_in_frames as usize
        && p.root.join(".veyra/audio.json").exists() && p.root.join(".veyra/timeline.json").exists();
    if cached {
        emit(json!({"event": "cache_hit", "frames": p.config.duration_in_frames}));
    } else {
        for src in veyra_media::scan_video_sources(p) {
            let n = veyra_media::extract_frames(p, &src)?;
            emit(json!({"event": "media", "src": src, "frames": n}));
        }
        // VEYRA_WRAPPER (e.g. "xvfb-run -a") and VEYRA_NO_SANDBOX are for headless/container use.
        let mut cmd: Vec<String> = std::env::var("VEYRA_WRAPPER").map(|w| w.split_whitespace().map(String::from).collect()).unwrap_or_default();
        cmd.push(p.root.join("node_modules/.bin/electron").to_string_lossy().to_string());
        if std::env::var("VEYRA_NO_SANDBOX").is_ok() { cmd.push("--no-sandbox".into()); }
        cmd.push("runtime/renderer/main.js".into());
        let mut child = Command::new(&cmd[0]).args(&cmd[1..]).current_dir(&p.root)
            .stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| format!("spawn renderer: {e}"))?;
        for line in BufReader::new(child.stdout.take().unwrap()).lines().map_while(Result::ok) {
            if let Ok(v) = serde_json::from_str::<Value>(&line) { emit(v); }
        }
        if !child.wait().map_err(|e| e.to_string())?.success() { return Err("renderer process failed".into()); }
        if frame_count(p) != p.config.duration_in_frames as usize { return Err(format!("expected {} frames, got {}", p.config.duration_in_frames, frame_count(p))); }
        std::fs::write(p.root.join(".veyra/cache.json"), json!({"key": key}).to_string()).map_err(|e| e.to_string())?;
    }
    let out = veyra_media::mux(p)?;
    Ok(json!({"output": out, "cacheHit": cached}))
}
