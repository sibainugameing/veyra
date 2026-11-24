//! Project model: config, asset listing, and path-confined file access.
use serde::de::{self, Deserializer};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

/// Exact rational frame rate (spec 6.1): 30000/1001 is stored as such, never as 29.97.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Fps { pub num: u32, pub den: u32 }
fn gcd(a: u32, b: u32) -> u32 { if b == 0 { a } else { gcd(b, a % b) } }
impl Fps {
    pub fn new(num: u32, den: u32) -> Result<Self, String> {
        if num == 0 || den == 0 { return Err("fps must be positive".into()) }
        let g = gcd(num, den); Ok(Self { num: num / g, den: den / g })
    }
    pub fn as_f64(&self) -> f64 { self.num as f64 / self.den as f64 }
    /// FFmpeg rational form, e.g. "30000/1001".
    pub fn arg(&self) -> String { format!("{}/{}", self.num, self.den) }
    /// Frame index -> audio sample index, in integer arithmetic, rounded to nearest (no float drift).
    pub fn frames_to_samples(&self, frames: u64, rate: u32) -> u64 {
        let d = self.num as u128;
        ((frames as u128 * self.den as u128 * rate as u128 * 2 + d) / (2 * d)) as u64
    }
}
fn parse_fps_str(s: &str) -> Result<Fps, String> {
    let (a, b) = s.split_once('/').unwrap_or((s, "1"));
    Fps::new(a.trim().parse().map_err(|_| format!("bad fps: {s}"))?, b.trim().parse().map_err(|_| format!("bad fps: {s}"))?)
}
impl<'de> Deserialize<'de> for Fps {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)] #[serde(untagged)]
        enum Raw { Int(u32), Float(f64), Str(String), Obj { num: u32, den: u32 } }
        match Raw::deserialize(d)? {
            Raw::Int(n) => Fps::new(n, 1),
            Raw::Float(f) if f.fract() == 0.0 && f > 0.0 => Fps::new(f as u32, 1),
            Raw::Float(f) => Err(format!("fractional fps {f} must be written as a fraction like \"30000/1001\"")),
            Raw::Str(s) => parse_fps_str(&s),
            Raw::Obj { num, den } => Fps::new(num, den),
        }.map_err(de::Error::custom)
    }
}

/// What the code declares with <Composition>; written by the renderer probe to .veyra/composition.json.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Composition { pub id: String, pub width: u32, pub height: u32, pub fps: Fps, pub duration_in_frames: u32 }

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfig {
    pub id: String, pub name: String, pub entry: String,
    pub width: u32, pub height: u32, pub fps: Fps, pub duration_in_frames: u32, pub runtime: String,
}

#[derive(Clone, Debug)]
pub struct Project { pub root: PathBuf, pub config: ProjectConfig }

impl Project {
    pub fn open(root: impl AsRef<Path>) -> Result<Self, String> {
        let root = root.as_ref().canonicalize().map_err(|e| format!("project root: {e}"))?;
        let text = std::fs::read_to_string(root.join("veyra.project.json")).map_err(|e| format!("veyra.project.json: {e}"))?;
        let config = serde_json::from_str(&text).map_err(|e| format!("veyra.project.json: {e}"))?;
        Ok(Self { root, config })
    }
    /// The composition declared in code (after a probe/render); falls back to veyra.project.json defaults.
    pub fn composition(&self) -> Composition {
        std::fs::read_to_string(self.root.join(".veyra/composition.json")).ok().and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_else(|| Composition { id: self.config.id.clone(), width: self.config.width, height: self.config.height, fps: self.config.fps, duration_in_frames: self.config.duration_in_frames })
    }
    /// Resolve a project-relative path; absolute paths and `..` are rejected.
    pub fn resolve(&self, rel: &str) -> Result<PathBuf, String> {
        if Path::new(rel).components().any(|c| !matches!(c, Component::Normal(_) | Component::CurDir)) {
            return Err(format!("path outside project: {rel}"));
        }
        Ok(self.root.join(rel))
    }
    pub fn list(&self, dir: &str) -> Vec<String> {
        let mut out = vec![]; walk(&self.root.join(dir), dir, &mut out); out.sort(); out
    }
    pub fn read_file(&self, rel: &str) -> Result<String, String> {
        std::fs::read_to_string(self.resolve(rel)?).map_err(|e| e.to_string())
    }
    pub fn write_file(&self, rel: &str, text: &str) -> Result<(), String> {
        if !rel.starts_with("src/") { return Err("only src/ is writable".into()); }
        std::fs::write(self.resolve(rel)?, text).map_err(|e| e.to_string())
    }
}
fn walk(dir: &Path, rel: &str, out: &mut Vec<String>) {
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let r = format!("{rel}/{}", e.file_name().to_string_lossy());
            if e.path().is_dir() { walk(&e.path(), &r, out) } else { out.push(r) }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn proj() -> Project {
        Project { root: PathBuf::from("/tmp/p"), config: ProjectConfig { id: "x".into(), name: "x".into(), entry: "src/main.tsx".into(), width: 1, height: 1, fps: Fps { num: 30, den: 1 }, duration_in_frames: 1, runtime: "0".into() } }
    }
    #[test] fn rejects_escape() {
        for bad in ["../x", "/etc/passwd", "src/../../x"] { assert!(proj().resolve(bad).is_err(), "{bad}"); }
        assert!(proj().resolve("src/main.tsx").is_ok());
    }
    fn fps(j: &str) -> Result<Fps, String> { serde_json::from_str::<Fps>(j).map_err(|e| e.to_string()) }
    #[test] fn fps_parses_int_string_object_and_reduces() {
        assert_eq!(fps("30").unwrap(), Fps { num: 30, den: 1 });
        assert_eq!(fps("30.0").unwrap(), Fps { num: 30, den: 1 });
        assert_eq!(fps("\"30000/1001\"").unwrap(), Fps { num: 30000, den: 1001 });
        assert_eq!(fps("\"60/2\"").unwrap(), Fps { num: 30, den: 1 });
        assert_eq!(fps("{\"num\":24000,\"den\":1001}").unwrap(), Fps { num: 24000, den: 1001 });
    }
    #[test] fn fps_rejects_float_zero_garbage() {
        assert!(fps("29.97").unwrap_err().contains("fraction"));
        for bad in ["0", "\"x/y\"", "\"30/0\"", "-5", "null"] { assert!(fps(bad).is_err(), "{bad}"); }
    }
    #[test] fn samples_are_exact_at_ntsc_boundaries() {
        let f = Fps { num: 30000, den: 1001 };
        assert_eq!(f.frames_to_samples(30000, 48000), 48_048_000);   // 1001 s exactly
        assert_eq!(f.frames_to_samples(30, 48000), 48_048);          // 1.001 s
        assert_eq!(f.frames_to_samples(1, 48000), 1602);             // 1601.6 rounded
        assert_eq!(f.frames_to_samples(90, 48000), 144_144);
        assert_eq!(Fps { num: 30, den: 1 }.frames_to_samples(30, 48000), 48_000);
    }
    #[test] fn only_src_writable() {
        assert!(proj().write_file("assets/a.png", "").is_err());
        assert!(proj().write_file("src/../veyra.project.json", "").is_err());
    }
}
