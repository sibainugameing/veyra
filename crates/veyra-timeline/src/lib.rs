//! Timeline model shared by GUI, CLI and AI, plus validation.
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Clip {
    pub id: String, pub kind: String, pub from: i64,
    /// null in JSON when the clip sits outside any Sequence (unbounded).
    pub duration: Option<i64>, pub depth: u32, pub src: Option<String>,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Timeline { pub fps: u32, pub duration: u32, pub clips: Vec<Clip> }
#[derive(Serialize, Debug)]
pub struct Report { pub ok: bool, pub errors: Vec<String>, pub warnings: Vec<String>, pub clips: usize }

pub fn validate(tl: &Timeline, total: u32, asset_exists: &dyn Fn(&str) -> bool) -> Report {
    let (mut errors, mut warnings) = (vec![], vec![]);
    for c in &tl.clips {
        let tag = format!("{} \"{}\" @{}", c.kind, c.id, c.from);
        if let Some(d) = c.duration {
            if d <= 0 { errors.push(format!("{tag}: duration must be > 0")); }
            if c.from + d > total as i64 { warnings.push(format!("{tag}: ends at {}, past composition end ({total}); will be cut", c.from + d)); }
        }
        if c.from < 0 { errors.push(format!("{tag}: starts before frame 0")); }
        if let Some(s) = &c.src { if !asset_exists(s) { errors.push(format!("{tag}: missing asset {s}")); } }
    }
    Report { ok: errors.is_empty(), errors, warnings, clips: tl.clips.len() }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn clip(id: &str, from: i64, d: Option<i64>, src: Option<&str>) -> Clip { Clip { id: id.into(), kind: "audio".into(), from, duration: d, depth: 0, src: src.map(Into::into) } }
    #[test] fn good_timeline_ok() {
        let tl = Timeline { fps: 30, duration: 90, clips: vec![clip("a", 0, Some(60), Some("a.wav"))] };
        assert!(validate(&tl, 90, &|_| true).ok);
    }
    #[test] fn catches_errors_and_warnings() {
        let tl = Timeline { fps: 30, duration: 90, clips: vec![clip("g", 80, Some(50), Some("ghost.wav")), clip("x", -5, Some(0), None)] };
        let r = validate(&tl, 90, &|_| false);
        assert!(!r.ok); assert_eq!(r.errors.len(), 3); assert_eq!(r.warnings.len(), 1);
    }
    #[test] fn parses_null_duration() {
        let t: Timeline = serde_json::from_str(r#"{"fps":30,"duration":9,"clips":[{"id":"a","kind":"image","from":0,"duration":null,"depth":0,"src":"a.png"}]}"#).unwrap();
        assert!(t.clips[0].duration.is_none());
    }
}
