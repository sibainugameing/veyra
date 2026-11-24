//! Timeline model shared by GUI, CLI and AI, plus validation.
use serde::{Deserialize, Serialize};
use veyra_project::Fps;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Clip {
    pub id: String, pub kind: String, pub from: i64,
    /// null in JSON when the clip sits outside any Sequence (unbounded).
    pub duration: Option<i64>, pub depth: u32, pub src: Option<String>,
    /// Enclosing <Track> id (None for clips outside any track).
    #[serde(default)] pub track: Option<String>,
    /// Sequence start relative to its parent: the number written in `from={..}`.
    #[serde(default, rename = "localFrom")] pub local_from: Option<i64>,
    /// track kind / transition type / marker label
    #[serde(default)] pub meta: Option<String>,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Timeline { pub fps: Fps, pub duration: u32, pub clips: Vec<Clip> }
#[derive(Serialize, Debug)]
pub struct Report { pub ok: bool, pub errors: Vec<String>, pub warnings: Vec<String>, pub clips: usize }

pub fn validate(tl: &Timeline, total: u32, asset_exists: &dyn Fn(&str) -> bool) -> Report {
    let (mut errors, mut warnings) = (vec![], vec![]);
    for c in &tl.clips {
        let tag = format!("{} \"{}\" @{}", c.kind, c.id, c.from);
        if let Some(d) = c.duration {
            if d <= 0 { errors.push(format!("{tag}: duration must be > 0")); }
            if c.kind != "marker" && c.from + d > total as i64 { warnings.push(format!("{tag}: ends at {}, past composition end ({total}); will be cut", c.from + d)); }
        }
        if c.from < 0 { errors.push(format!("{tag}: starts before frame 0")); }
        if let Some(s) = &c.src { if !asset_exists(s) { errors.push(format!("{tag}: missing asset {s}")); } }
    }
    // Two media clips (video/audio/image) on the same track that overlap in time are almost always a mistake.
    let media: Vec<&Clip> = tl.clips.iter().filter(|c| matches!(c.kind.as_str(), "video" | "audio" | "image") && c.track.is_some() && c.duration.is_some()).collect();
    for (i, a) in media.iter().enumerate() {
        for b in &media[i + 1..] {
            let (ae, be) = (a.from + a.duration.unwrap(), b.from + b.duration.unwrap());
            if a.track == b.track && a.from < be && b.from < ae {
                warnings.push(format!("{} \"{}\" and {} \"{}\" overlap on track \"{}\"", a.kind, a.id, b.kind, b.id, a.track.as_deref().unwrap_or("")));
            }
        }
    }
    for c in tl.clips.iter().filter(|c| c.kind == "marker") {
        if c.from < 0 || c.from >= total as i64 { warnings.push(format!("marker \"{}\" @{} is outside the composition", c.id, c.from)); }
    }
    Report { ok: errors.is_empty(), errors, warnings, clips: tl.clips.len() }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn clip(id: &str, from: i64, d: Option<i64>, src: Option<&str>) -> Clip { Clip { id: id.into(), kind: "audio".into(), from, duration: d, depth: 0, src: src.map(Into::into), track: None, local_from: None, meta: None } }
    #[test] fn good_timeline_ok() {
        let tl = Timeline { fps: Fps { num: 30, den: 1 }, duration: 90, clips: vec![clip("a", 0, Some(60), Some("a.wav"))] };
        assert!(validate(&tl, 90, &|_| true).ok);
    }
    #[test] fn catches_errors_and_warnings() {
        let tl = Timeline { fps: Fps { num: 30, den: 1 }, duration: 90, clips: vec![clip("g", 80, Some(50), Some("ghost.wav")), clip("x", -5, Some(0), None)] };
        let r = validate(&tl, 90, &|_| false);
        assert!(!r.ok); assert_eq!(r.errors.len(), 3); assert_eq!(r.warnings.len(), 1);
    }
    fn on(mut c: Clip, kind: &str, track: &str) -> Clip { c.kind = kind.into(); c.track = Some(track.into()); c }
    #[test] fn warns_on_same_track_media_overlap_only() {
        let tl = |a: Clip, b: Clip| Timeline { fps: Fps { num: 30, den: 1 }, duration: 90, clips: vec![a, b] };
        let r = validate(&tl(on(clip("a", 0, Some(60), None), "video", "v"), on(clip("b", 30, Some(60), None), "video", "v")), 90, &|_| true);
        assert_eq!(r.warnings.len(), 1, "{:?}", r.warnings); assert!(r.ok);
        let r = validate(&tl(on(clip("a", 0, Some(60), None), "video", "v"), on(clip("b", 30, Some(60), None), "audio", "a")), 90, &|_| true);
        assert!(r.warnings.is_empty());                                   // different tracks
        let r = validate(&tl(on(clip("a", 0, Some(30), None), "video", "v"), on(clip("b", 30, Some(30), None), "video", "v")), 90, &|_| true);
        assert!(r.warnings.is_empty());                                   // back to back is fine
    }
    #[test] fn parses_track_fields_and_flags_stray_marker() {
        let t: Timeline = serde_json::from_str(r#"{"fps":30,"duration":90,"clips":[{"id":"s","kind":"sequence","from":30,"duration":60,"depth":0,"track":"overlay","localFrom":10},{"id":"m","kind":"marker","from":200,"duration":1,"depth":0,"meta":"x"}]}"#).unwrap();
        assert_eq!((t.clips[0].track.as_deref(), t.clips[0].local_from), (Some("overlay"), Some(10)));
        assert_eq!(validate(&t, 90, &|_| true).warnings.len(), 1);
    }
    #[test] fn parses_renderer_output_with_rational_fps() { // the exact shape the Electron renderer writes
        let t: Timeline = serde_json::from_str(r#"{"fps":{"num":30000,"den":1001},"duration":90,"clips":[]}"#).unwrap();
        assert_eq!(t.fps, Fps { num: 30000, den: 1001 });
        assert!(serde_json::from_str::<Timeline>(r#"{"fps":30,"duration":90,"clips":[]}"#).is_ok()); // legacy integer form
    }
    #[test] fn parses_null_duration() {
        let t: Timeline = serde_json::from_str(r#"{"fps":30,"duration":9,"clips":[{"id":"a","kind":"image","from":0,"duration":null,"depth":0,"src":"a.png"}]}"#).unwrap();
        assert!(t.clips[0].duration.is_none());
    }
}
