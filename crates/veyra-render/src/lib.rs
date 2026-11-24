//! Render orchestration: build runtime -> probe <Composition> -> cache check -> Chromium (Electron) frames -> FFmpeg mux.
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use veyra_project::Project;

pub fn build_runtime(p: &Project) -> Result<(), String> {
    let o = Command::new("node").arg("scripts/build.mjs").current_dir(&p.root).output().map_err(|e| format!("node: {e}"))?;
    if o.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&o.stderr).chars().take(600).collect()) }
}

fn frame_count(p: &Project) -> usize { std::fs::read_dir(p.root.join(".veyra/frames")).map(|r| r.count()).unwrap_or(0) }

/// Run the Electron renderer. VEYRA_WRAPPER (e.g. "xvfb-run -a") and VEYRA_NO_SANDBOX are for headless/container use.
fn run_renderer(p: &Project, extra: &[&str], emit: &mut dyn FnMut(Value)) -> Result<(), String> {
    let mut cmd: Vec<String> = std::env::var("VEYRA_WRAPPER").map(|w| w.split_whitespace().map(String::from).collect()).unwrap_or_default();
    cmd.push(p.root.join("node_modules/.bin/electron").to_string_lossy().to_string());
    if std::env::var("VEYRA_NO_SANDBOX").is_ok() { cmd.push("--no-sandbox".into()); }
    cmd.push("runtime/renderer/main.js".into());
    cmd.extend(extra.iter().map(|s| s.to_string()));
    let mut child = Command::new(&cmd[0]).args(&cmd[1..]).current_dir(&p.root)
        .stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| format!("spawn renderer: {e}"))?;
    let mut err: Option<String> = None;
    for line in BufReader::new(child.stdout.take().unwrap()).lines().map_while(Result::ok) {
        if let Ok(v) = serde_json::from_str::<Value>(&line) {
            if v["event"] == "error" { err = Some(v["msg"].as_str().unwrap_or("renderer error").to_string()); } else { emit(v); }
        }
    }
    let ok = child.wait().map_err(|e| e.to_string())?.success();
    match (err, ok) { (Some(m), _) => Err(m), (None, false) => Err("renderer process failed".into()), _ => Ok(()) }
}

pub fn render(p: &Project, emit: &mut dyn FnMut(Value)) -> Result<Value, String> {
    build_runtime(p)?;
    // The <Composition> in code is the source of truth for size / fps / length.
    run_renderer(p, &["--probe"], &mut |_| {})?;
    let comp = p.composition();
    emit(json!({"event": "composition", "id": comp.id, "width": comp.width, "height": comp.height, "fps": comp.fps.arg(), "frames": comp.duration_in_frames}));
    let key = veyra_media::cache_key(p)?;
    let cached = p.read_file(".veyra/cache.json").ok().and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .map(|v| v["key"] == key.as_str()).unwrap_or(false)
        && frame_count(p) == comp.duration_in_frames as usize
        && p.root.join(".veyra/audio.json").exists() && p.root.join(".veyra/timeline.json").exists();
    if cached {
        emit(json!({"event": "cache_hit", "frames": comp.duration_in_frames}));
    } else {
        for src in veyra_media::scan_video_sources(p) {
            let n = veyra_media::extract_frames(p, &src, comp.fps)?;
            emit(json!({"event": "media", "src": src, "frames": n}));
        }
        run_renderer(p, &[], emit)?;
        if frame_count(p) != comp.duration_in_frames as usize { return Err(format!("expected {} frames, got {}", comp.duration_in_frames, frame_count(p))); }
        std::fs::write(p.root.join(".veyra/cache.json"), json!({"key": key}).to_string()).map_err(|e| e.to_string())?;
    }
    let out = veyra_media::mux(p, &comp)?;
    Ok(json!({"output": out, "cacheHit": cached}))
}
