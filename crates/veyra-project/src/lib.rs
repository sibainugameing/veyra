//! Project model: config, asset listing, and path-confined file access.
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfig {
    pub id: String, pub name: String, pub entry: String,
    pub width: u32, pub height: u32, pub fps: u32, pub duration_in_frames: u32, pub runtime: String,
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
        Project { root: PathBuf::from("/tmp/p"), config: ProjectConfig { id: "x".into(), name: "x".into(), entry: "src/main.tsx".into(), width: 1, height: 1, fps: 30, duration_in_frames: 1, runtime: "0".into() } }
    }
    #[test] fn rejects_escape() {
        for bad in ["../x", "/etc/passwd", "src/../../x"] { assert!(proj().resolve(bad).is_err(), "{bad}"); }
        assert!(proj().resolve("src/main.tsx").is_ok());
    }
    #[test] fn only_src_writable() {
        assert!(proj().write_file("assets/a.png", "").is_err());
        assert!(proj().write_file("src/../veyra.project.json", "").is_err());
    }
}
