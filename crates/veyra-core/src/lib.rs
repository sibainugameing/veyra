//! Command API: the single entry point for GUI, CLI and AI (spec 12.3). JSON in, JSON out.
use serde_json::{json, Value};
use veyra_project::Project;

fn load_timeline(p: &Project) -> Result<veyra_timeline::Timeline, String> {
    let t = p.read_file(".veyra/timeline.json").map_err(|_| "timeline not generated yet; run render first".to_string())?;
    serde_json::from_str(&t).map_err(|e| format!("timeline.json: {e}"))
}
fn arg<'a>(req: &'a Value, k: &str) -> Result<&'a str, String> { req[k].as_str().ok_or_else(|| format!("missing string field '{k}'")) }

/// Timing props must stay valid frames; this protects the timeline from GUI drags and AI edits alike.
fn check_timing(props: &[(String, Value)]) -> Result<(), String> {
    for (k, v) in props {
        match k.as_str() {
            "from" => if v.as_i64().ok_or("from must be an integer")? < 0 { return Err("from must be >= 0".into()) },
            "durationInFrames" => if v.as_i64().ok_or("durationInFrames must be an integer")? < 1 { return Err("durationInFrames must be >= 1".into()) },
            _ => {}
        }
    }
    Ok(())
}
/// One undoable edit (one history entry) that rewrites literal props of one element, then rebuilds.
fn edit(p: &Project, path: &str, id: &str, props: Vec<(String, Value)>) -> Result<Value, String> {
    check_timing(&props)?;
    let before = p.read_file(path)?;
    let after = veyra_source::set_props(&before, id, &props)?;
    p.write_file(path, &after)?;
    let label = format!("{id}.{}", props.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>().join("+"));
    let mut h = veyra_history::History::load(p);
    h.record(veyra_history::Entry { label: label.clone(), path: path.into(), before, after: after.clone() });
    h.save(p)?;
    veyra_render::build_runtime(p).map_err(|e| format!("build error: {e}"))?;
    Ok(json!({"text": after, "label": label}))
}

pub fn dispatch(p: &Project, req: &Value, emit: &mut dyn FnMut(Value)) -> Result<Value, String> {
    match arg(req, "cmd")? {
        "project.inspect" => {
            let files = [p.list("src"), p.list("assets")].concat();
            let runtime_url = format!("file://{}", p.root.join("runtime/composition/index.html").display());
            Ok(json!({"root": p.root, "config": p.config, "composition": p.composition(), "files": files, "runtimeUrl": runtime_url}))
        }
        "project.build" => { veyra_render::build_runtime(p).map_err(|e| format!("build error: {e}"))?; Ok(json!({"built": true})) }
        "project.validate" => {
            let r = veyra_timeline::validate(&load_timeline(p)?, p.composition().duration_in_frames, &|s| p.resolve(s).map(|x| x.exists()).unwrap_or(false));
            serde_json::to_value(r).map_err(|e| e.to_string())
        }
        "timeline.get" => serde_json::to_value(load_timeline(p)?).map_err(|e| e.to_string()),
        "file.read" => Ok(json!({"text": p.read_file(arg(req, "path")?)?})),
        "file.write" => {
            p.write_file(arg(req, "path")?, arg(req, "text")?)?;
            veyra_render::build_runtime(p).map_err(|e| format!("build error: {e}"))?;
            Ok(json!({"built": true}))
        }
        "source.elements" => {
            let els = veyra_source::scan(&p.read_file(arg(req, "path")?)?);
            Ok(json!({"elements": els.iter().filter(|e| e.id.is_some()).collect::<Vec<_>>(), "total": els.len()}))
        }
        "source.set_prop" => {
            let props = vec![(arg(req, "prop")?.to_string(), req["value"].clone())];
            edit(p, arg(req, "path")?, arg(req, "id")?, props)
        }
        "source.set_props" => {
            let m = req["props"].as_object().ok_or("missing object field 'props'")?;
            if m.is_empty() { return Err("props is empty".into()); }
            edit(p, arg(req, "path")?, arg(req, "id")?, m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        }
        c @ ("history.undo" | "history.redo") => {
            let mut h = veyra_history::History::load(p);
            let e = if c == "history.undo" { h.undo(p)? } else { h.redo(p)? };
            h.save(p)?;
            veyra_render::build_runtime(p).map_err(|e| format!("build error: {e}"))?;
            Ok(json!({"path": e.path, "text": p.read_file(&e.path)?, "label": e.label}))
        }
        "history.list" => {
            let h = veyra_history::History::load(p);
            Ok(json!({"cursor": h.cursor, "entries": h.entries.iter().map(|e| &e.label).collect::<Vec<_>>()}))
        }
        "render.start" => veyra_render::render(p, emit),
        other => Err(format!("unknown cmd: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pr(k: &str, v: Value) -> Vec<(String, Value)> { vec![(k.into(), v)] }
    #[test] fn timing_guard() {
        assert!(check_timing(&pr("from", json!(0))).is_ok());
        assert!(check_timing(&pr("from", json!(-1))).is_err());
        assert!(check_timing(&pr("from", json!(1.5))).is_err());
        assert!(check_timing(&pr("durationInFrames", json!(0))).is_err());
        assert!(check_timing(&pr("durationInFrames", json!(1))).is_ok());
        assert!(check_timing(&pr("fontSize", json!(-9))).is_ok()); // only timing props are constrained
    }
}
