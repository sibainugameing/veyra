//! Media engine: video frame extraction, audio mixing, FFmpeg process control, cache key.
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::process::Command;
use veyra_project::{Composition, Fps, Project};

/// Literal `<Video src="...">` values in src/. (Dynamic src values are not detected.)
pub fn scan_video_sources(p: &Project) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for f in p.list("src").iter().filter(|f| f.ends_with(".tsx") || f.ends_with(".ts")) {
        let Ok(text) = p.read_file(f) else { continue };
        for (i, _) in text.match_indices("<Video") {
            let win: String = text[i..].chars().take(400).collect();
            if let Some(k) = win.find("src=") {
                let rest = &win[k + 4..];
                if let Some(q) = rest.chars().next().filter(|c| *c == '"' || *c == '\'') {
                    if let Some(end) = rest[1..].find(q) { let s = rest[1..1 + end].to_string(); if !out.contains(&s) { out.push(s); } }
                }
            }
        }
    }
    out
}
pub fn media_key(src: &str) -> String { Path::new(src).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default() }

fn ffmpeg(p: &Project, args: &[String]) -> Result<(), String> {
    let o = Command::new("ffmpeg").current_dir(&p.root).args(args).output().map_err(|e| format!("ffmpeg: {e}"))?;
    if o.status.success() { Ok(()) } else { Err(format!("ffmpeg failed: {}", String::from_utf8_lossy(&o.stderr).trim())) }
}
pub fn extract_frames(p: &Project, src: &str, fps: Fps) -> Result<usize, String> {
    p.resolve(src)?;
    let out = p.root.join(".veyra/media").join(media_key(src));
    let _ = std::fs::remove_dir_all(&out);
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let pat = format!(".veyra/media/{}/%05d.png", media_key(src));
    let args: Vec<String> = ["-y", "-loglevel", "error", "-i", src, "-vf", &format!("fps={}", fps.arg()), "-start_number", "0", &pat].iter().map(|s| s.to_string()).collect();
    ffmpeg(p, &args)?;
    Ok(std::fs::read_dir(out).map(|r| r.count()).unwrap_or(0))
}

#[derive(Deserialize)] #[serde(rename_all = "camelCase")]
struct AudioClip { src: String, from_frame: u32, volume: f64 }
#[derive(Deserialize)] struct AudioPlan { clips: Vec<AudioClip> }

/// Frames (+ audio plan) -> exports/out.mp4 in a single FFmpeg call. Audio positions and length are in integer samples
/// derived from the exact rational fps, so A/V sync does not drift even at 30000/1001.
pub fn mux(p: &Project, comp: &Composition) -> Result<String, String> {
    const RATE: u32 = 48000;
    let plan: AudioPlan = serde_json::from_str(&p.read_file(".veyra/audio.json")?).map_err(|e| format!("audio.json: {e}"))?;
    std::fs::create_dir_all(p.root.join("exports")).map_err(|e| e.to_string())?;
    let total = comp.fps.frames_to_samples(comp.duration_in_frames as u64, RATE);
    let mut a: Vec<String> = ["-y", "-loglevel", "error", "-framerate"].iter().map(|s| s.to_string()).collect();
    a.extend([comp.fps.arg(), "-i".into(), ".veyra/frames/%05d.png".into()]);
    for c in &plan.clips { p.resolve(&c.src)?; a.extend(["-i".into(), c.src.clone()]); }
    if !plan.clips.is_empty() {
        let mut f: Vec<String> = plan.clips.iter().enumerate().map(|(i, c)| format!(
            "[{}:a]aresample={RATE},adelay={}S:all=1,volume={}[a{i}]", i + 1, comp.fps.frames_to_samples(c.from_frame as u64, RATE), c.volume)).collect();
        let ins: String = (0..plan.clips.len()).map(|i| format!("[a{i}]")).collect();
        f.push(format!("{ins}amix=inputs={}:normalize=0,atrim=end_sample={total},apad=whole_len={total}[aout]", plan.clips.len()));
        a.extend(["-filter_complex".into(), f.join(";"), "-map".into(), "0:v".into(), "-map".into(), "[aout]".into(), "-c:a".into(), "aac".into()]);
    }
    a.extend(["-pix_fmt".into(), "yuv420p".into(), "-frames:v".into(), comp.duration_in_frames.to_string(), "exports/out.mp4".into()]);
    ffmpeg(p, &a)?;
    Ok("exports/out.mp4".into())
}

/// Build-level cache key: bundle + project config + asset (path,size,mtime).
pub fn cache_key(p: &Project) -> Result<String, String> {
    let mut h = Sha256::new();
    for f in ["dist/bundle.js", "veyra.project.json"] { h.update(std::fs::read(p.root.join(f)).map_err(|e| format!("{f}: {e}"))?); }
    for f in p.list("assets") {
        let m = std::fs::metadata(p.root.join(&f)).map_err(|e| e.to_string())?;
        let ms = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0);
        h.update(format!("{f}:{}:{ms}", m.len()));
    }
    Ok(format!("{:x}", h.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn key_is_file_stem() { assert_eq!(media_key("assets/videos/clip.mp4"), "clip"); }
}
