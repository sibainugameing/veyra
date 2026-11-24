//! Edit history (spec 12.7): every GUI/AI edit is a before/after snapshot, undoable and redoable.
//! Persisted in .veyra/history.json so separate `veyra` processes share one history.
use serde::{Deserialize, Serialize};
use veyra_project::Project;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Entry { pub label: String, pub path: String, pub before: String, pub after: String }
#[derive(Serialize, Deserialize, Default, Debug)]
pub struct History { pub entries: Vec<Entry>, pub cursor: usize }

const MAX: usize = 200;
impl History {
    pub fn load(p: &Project) -> Self {
        std::fs::read_to_string(p.root.join(".veyra/history.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }
    pub fn save(&self, p: &Project) -> Result<(), String> {
        std::fs::create_dir_all(p.root.join(".veyra")).map_err(|e| e.to_string())?;
        std::fs::write(p.root.join(".veyra/history.json"), serde_json::to_string(self).unwrap()).map_err(|e| e.to_string())
    }
    pub fn record(&mut self, e: Entry) {
        self.entries.truncate(self.cursor); self.entries.push(e);
        if self.entries.len() > MAX { self.entries.remove(0); }
        self.cursor = self.entries.len();
    }
    /// Refuses to overwrite a file that changed since the edit (e.g. typed in the editor), so nothing is lost silently.
    pub fn undo(&mut self, p: &Project) -> Result<Entry, String> {
        if self.cursor == 0 { return Err("nothing to undo".into()) }
        let e = self.entries[self.cursor - 1].clone();
        if p.read_file(&e.path)? != e.after { return Err(format!("{} changed after this edit; cannot undo safely", e.path)) }
        p.write_file(&e.path, &e.before)?; self.cursor -= 1; Ok(e)
    }
    pub fn redo(&mut self, p: &Project) -> Result<Entry, String> {
        if self.cursor >= self.entries.len() { return Err("nothing to redo".into()) }
        let e = self.entries[self.cursor].clone();
        if p.read_file(&e.path)? != e.before { return Err(format!("{} changed after undo; cannot redo safely", e.path)) }
        p.write_file(&e.path, &e.after)?; self.cursor += 1; Ok(e)
    }
}
