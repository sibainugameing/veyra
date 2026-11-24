//! Command API: the single entry point for GUI, CLI and AI (spec 12.3). JSON in, JSON out.
use serde_json::{json, Value};
use veyra_project::Project;

fn load_timeline(p: &Project) -> Result<veyra_timeline::Timeline, String> {
    let t = p.read_file(".veyra/timeline.json").map_err(|_| "timeline not generated yet; run render first".to_string())?;
    serde_json::from_str(&t).map_err(|e| format!("timeline.json: {e}"))
}
fn arg<'a>(req: &'a Value, k: &str) -> Result<&'a str, String> { req[k].as_str().ok_or_else(|| format!("missing string field '{k}'")) }

pub fn dispatch(p: &Project, req: &Value, emit: &mut dyn FnMut(Value)) -> Result<Value, String> {
    match arg(req, "cmd")? {
        "project.inspect" => {
            let files = [p.list("src"), p.list("assets")].concat();
            let runtime_url = format!("file://{}", p.root.join("runtime/composition/index.html").display());
            Ok(json!({"root": p.root, "config": p.config, "files": files, "runtimeUrl": runtime_url}))
        }
        "project.validate" => {
            let r = veyra_timeline::validate(&load_timeline(p)?, p.config.duration_in_frames, &|s| p.resolve(s).map(|x| x.exists()).unwrap_or(false));
            serde_json::to_value(r).map_err(|e| e.to_string())
        }
        "timeline.get" => serde_json::to_value(load_timeline(p)?).map_err(|e| e.to_string()),
        "file.read" => Ok(json!({"text": p.read_file(arg(req, "path")?)?})),
        "file.write" => {
            p.write_file(arg(req, "path")?, arg(req, "text")?)?;
            veyra_render::build_runtime(p).map_err(|e| format!("build error: {e}"))?;
            Ok(json!({"built": true}))
        }
        "render.start" => veyra_render::render(p, emit),
        other => Err(format!("unknown cmd: {other}")),
    }
}
