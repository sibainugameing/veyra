//! `veyra [--project DIR] <inspect|validate|timeline|render|api '<json>'>`
//! Output: JSON lines. `{"event":..}` while running, then `{"ok":true,"result":..}` or `{"ok":false,"error":..}`.
use serde_json::{json, Value};
use std::process::exit;

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let mut root = std::env::var("VEYRA_PROJECT").unwrap_or_else(|_| ".".into());
    if let Some(i) = args.iter().position(|a| a == "--project") { if i + 1 < args.len() { root = args.remove(i + 1); args.remove(i); } }
    let req: Value = match args.first().map(String::as_str) {
        Some("api") => serde_json::from_str(args.get(1).map(String::as_str).unwrap_or("{}")).unwrap_or_else(|e| fail(&format!("bad JSON: {e}"))),
        Some(c @ ("inspect" | "validate" | "timeline" | "render")) => json!({"cmd": match c { "inspect" => "project.inspect", "validate" => "project.validate", "timeline" => "timeline.get", _ => "render.start" }}),
        _ => { eprintln!("usage: veyra [--project DIR] <inspect|validate|timeline|render|api '<json>'>"); exit(2) }
    };
    let project = veyra_project::Project::open(&root).unwrap_or_else(|e| fail(&e));
    match veyra_core::dispatch(&project, &req, &mut |ev| println!("{}", json!({"event": ev}))) {
        Ok(v) => println!("{}", json!({"ok": true, "result": v})),
        Err(e) => fail(&e),
    }
}
fn fail(msg: &str) -> ! { println!("{}", json!({"ok": false, "error": msg})); exit(1) }
