import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
declare const veyra: any; declare const monacoReady: Promise<any>;
type Clip = { id: string; kind: string; from: number; duration: number | null; depth: number; src?: string; track?: string; localFrom?: number; meta?: string };

function App() {
  const [proj, setProj] = useState<any>(null);
  const [file, setFile] = useState("src/main.tsx");
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);
  const [sel, setSel] = useState<Clip | null>(null);
  const [status, setStatus] = useState("Ready");
  const [err, setErr] = useState(false);
  const [rev, setRev] = useState(0);
  const [prog, setProg] = useState<number | null>(null);
  const [comp, setComp] = useState<any>(null); // <Composition> as declared in code
  const [els, setEls] = useState<any[]>([]);
  const [selEl, setSelEl] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; abs: number; dur: number } | null>(null);
  const tlRef = useRef<HTMLDivElement>(null), justDragged = useRef(false);
  const [scale, setScale] = useState(0.35);
  const ifr = useRef<HTMLIFrameElement>(null), pvbox = useRef<HTMLDivElement>(null), edEl = useRef<HTMLDivElement>(null);
  const editor = useRef<any>(null), suppress = useRef(false), timer = useRef<any>(null), runtimeReady = useRef(false);

  useEffect(() => { veyra.loadProject().then((p: any) => { setProj(p); setFrame(p.test.frame); }); }, []);
  useEffect(() => { veyra.onRender((l: string) => { try { const e = JSON.parse(l);
    if (e.event === "progress") setProg(e.frame / e.total * 100);
    else if (e.event === "exit") { setProg(null); setErr(e.code !== 0); setStatus(e.code === 0 ? "Exported exports/out.mp4" : "Render failed"); }
    else if (e.event === "cache_hit") setStatus("Render cache hit"); } catch { /* non-JSON line */ } }); }, []);

  // Monaco editor
  useEffect(() => { if (!proj) return; let dead = false;
    monacoReady.then((monaco: any) => { if (dead || editor.current) return;
      const ts = monaco.languages.typescript;
      ts.typescriptDefaults.setCompilerOptions({ jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, allowNonTsExtensions: true });
      ts.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true }); // type info for @veyra/core comes in Phase 2b
      editor.current = monaco.editor.create(edEl.current, { value: "", language: "typescript", theme: "vs-dark", automaticLayout: true, minimap: { enabled: false }, fontSize: 13 });
      editor.current.onDidChangeModelContent(() => { if (suppress.current) return; clearTimeout(timer.current);
        timer.current = setTimeout(async () => { setStatus("Building…");
          const r = await veyra.writeFile(fileRef.current, editor.current.getValue());
          setErr(!r.ok); setStatus(r.ok ? "Built" : r.error); if (r.ok) { setRev(x => x + 1); loadElements(); } }, 400); });
      loadFile("src/main.tsx");
      loadElements("src/main.tsx");
      if (proj.test.prop) setTimeout(() => { const [k, v] = proj.test.prop.split("="); const [id, prop] = k.split("."); setProp(id, prop, v, !isNaN(Number(v))); }, 3000);
      if (proj.test.edit) setTimeout(() => editor.current.setValue(editor.current.getValue().replace("Welcome to Veyra", "Edited from the GUI")), 2500);
    }); return () => { dead = true; }; }, [proj]);
  const fileRef = useRef(file); fileRef.current = file;
  const loadFile = async (rel: string) => { setFile(rel); fileRef.current = rel;
    if (!/\.(tsx?|json|md)$/.test(rel)) { suppress.current = true; editor.current?.setValue(`// ${rel}\n// binary asset (preview not supported)`); suppress.current = false; return; }
    const t = await veyra.readFile(rel); suppress.current = true; editor.current?.setValue(t); suppress.current = false; loadElements(rel); };
  const loadElements = async (rel = fileRef.current) => {
    if (!rel.endsWith(".tsx")) { setEls([]); return; }
    const r = await veyra.cmd({ cmd: "source.elements", path: rel }); if (r.ok) setEls(r.result.elements); };
  // Inspector edits go through the Rust core (source.set_prop): only that one literal prop is rewritten.
  const applyText = (t: string) => { suppress.current = true; editor.current?.setValue(t); suppress.current = false; setRev(x => x + 1); loadElements(); };
  const setProp = async (id: string, prop: string, raw: string, isNum: boolean) => {
    const value = isNum ? Number(raw) : raw; if (isNum && !isFinite(value as number)) { setErr(true); setStatus("not a number: " + raw); return; }
    setStatus("Updating…"); const r = await veyra.cmd({ cmd: "source.set_prop", path: fileRef.current, id, prop, value });
    if (r.ok) { applyText(r.result.text); setErr(false); setStatus(`Updated ${id}.${prop}`); } else { setErr(true); setStatus(r.error); } };
  const hist = async (cmd: string) => { const r = await veyra.cmd({ cmd });
    if (!r.ok) { setErr(true); setStatus(r.error); return; }
    if (r.result.path === fileRef.current) applyText(r.result.text); else loadFile(r.result.path);
    setErr(false); setStatus((cmd === "history.undo" ? "Undid " : "Redid ") + r.result.label); };

  // preview <-> runtime messaging
  useEffect(() => { const h = (e: MessageEvent) => { const d = e.data;
    if (d?.type === "runtimeReady") { runtimeReady.current = true; ifr.current?.contentWindow?.postMessage({ type: "scan", duration: proj.config.durationInFrames, frame }, "*"); }
    else if (d?.type === "timeline") { setClips(d.clips); if (d.config) setComp(d.config); }
    else if (d?.type === "error") { setErr(true); setStatus(d.msg); } };
    window.addEventListener("message", h); return () => window.removeEventListener("message", h); }, [proj, frame]);
  useEffect(() => { ifr.current?.contentWindow?.postMessage({ type: "setFrame", frame }, "*"); }, [frame]);
  useEffect(() => { runtimeReady.current = false; }, [rev]);
  useEffect(() => { if (!playing || !proj) return; const c = comp ?? proj.config; const t = setInterval(() => setFrame(f => (f + 1) % c.durationInFrames), 1000 * c.fps.den / c.fps.num); return () => clearInterval(t); }, [playing, proj, comp]);
  useEffect(() => { if (!pvbox.current || !proj) return; const ro = new ResizeObserver(() => setScale(pvbox.current!.clientWidth / (comp ?? proj.config).width)); ro.observe(pvbox.current); return () => ro.disconnect(); }, [proj, comp]);

  // A sequence is draggable only if the source says so: id + editable {from, durationInFrames} + both are number literals.
  const dragOk = (c: Clip) => { const e = els.find((x: any) => x.id === c.id); if (c.kind !== "sequence" || !e) return false;
    const ed: string[] = e.editable ?? [];
    return ["from", "durationInFrames"].every(n => ed.includes(n) && e.attrs.find((a: any) => a.name === n)?.kind === "num"); };
  const startDrag = (ev: React.PointerEvent, c: Clip, mode: "move" | "l" | "r") => {
    ev.stopPropagation(); ev.preventDefault();
    const w = tlRef.current!.getBoundingClientRect().width, D0 = (comp ?? proj.config).durationInFrames, x0 = ev.clientX;
    const lf = c.localFrom ?? 0, dur0 = c.duration ?? 1; let cur = { from: lf, dur: dur0 }; justDragged.current = false;
    const calc = (dx: number) => { const d = Math.round(dx * D0 / w); let f = lf, du = dur0;
      if (mode === "move") f = Math.max(0, lf + d);
      else if (mode === "r") du = Math.max(1, dur0 + d);
      else { const nf = Math.max(-lf, Math.min(d, dur0 - 1)); f = lf + nf; du = dur0 - nf; }
      return { from: f, dur: du }; };
    const mv = (e: PointerEvent) => { if (Math.abs(e.clientX - x0) > 2) justDragged.current = true; cur = calc(e.clientX - x0); setDrag({ id: c.id, abs: c.from + (cur.from - lf), dur: cur.dur }); };
    const up = async () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); setDrag(null);
      if (cur.from === lf && cur.dur === dur0) return;
      const props: any = {}; if (cur.from !== lf) props.from = cur.from; if (cur.dur !== dur0) props.durationInFrames = cur.dur;
      const r = await veyra.cmd({ cmd: "source.set_props", path: fileRef.current, id: c.id, props });
      if (r.ok) { applyText(r.result.text); setErr(false); setStatus(`Updated ${c.id}: ` + Object.entries(props).map(([k, v]) => `${k}=${v}`).join(", ")); }
      else { setErr(true); setStatus(r.error); } };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); };

  if (!proj) return <div style={{ padding: 20 }}>Loading…</div>;
  const cfg = comp ? { ...proj.config, ...comp } : proj.config, fpsv = cfg.fps.num / cfg.fps.den, D = cfg.durationInFrames, pct = (f: number) => (f / D * 100) + "%";
  const tlClick = (e: React.MouseEvent<HTMLDivElement>) => { const b = e.currentTarget.getBoundingClientRect(); setFrame(Math.max(0, Math.min(D - 1, Math.floor((e.clientX - b.left) / b.width * D)))); };

  return <div className="app">
    <div className="top"><b>Veyra Studio</b><span style={{ color: "var(--mu)" }}>{cfg.name} · {cfg.width}×{cfg.height} · {+fpsv.toFixed(3)}fps · {D}f</span><span className="sp" />
      <button onClick={() => hist("history.undo")}>↶ Undo</button><button onClick={() => hist("history.redo")}>↷ Redo</button>
      <button className="p" onClick={() => { setStatus("Rendering…"); setErr(false); veyra.render(); }}>● Export mp4</button></div>
    <div className="files"><h4>Explorer</h4>{proj.files.map((f: string) => <div key={f} className={f === file ? "on" : ""} onClick={() => loadFile(f)}>{f}</div>)}</div>
    <div><h4>Code · {file}</h4><div id="ed" ref={edEl} /></div>
    <div className="right">
      <div className="pv"><h4 style={{ padding: "0 0 4px" }}>Preview</h4>
        <div className="pvbox" ref={pvbox} style={{ height: cfg.height * scale }}>
          <iframe ref={ifr} key={rev} src={proj.runtimeUrl + "?rev=" + rev} style={{ width: cfg.width, height: cfg.height, transform: `scale(${scale})` }} /></div></div>
      <div className="ctl"><button onClick={() => setPlaying(p => !p)}>{playing ? "⏸" : "▶"}</button>
        <input type="range" min={0} max={D - 1} value={frame} onChange={e => setFrame(+e.target.value)} />
        <span>{frame}/{D - 1} · {(frame / fpsv).toFixed(2)}s</span></div>
      <h4>Inspector</h4>
      <div className="insp">{sel ? <dl><dt>id</dt><dd>{sel.id}</dd><dt>kind</dt><dd>{sel.kind}</dd><dt>from</dt><dd>{sel.from}f ({(sel.from / fpsv).toFixed(2)}s)</dd>
        <dt>duration</dt><dd>{sel.duration}f</dd>{sel.src && <><dt>src</dt><dd>{sel.src}</dd></>}</dl> : <span style={{ color: "var(--mu)" }}>Select a clip in the timeline.</span>}
        <div className="sec">Source properties</div>
        {els.length === 0 ? <span style={{ color: "var(--mu)" }}>No elements with an id in this file.</span> : <>
          <div className="chips">{els.map((e: any) => <button key={e.id} className={(selEl ?? els[0]?.id) === e.id ? "on" : ""} onClick={() => setSelEl(e.id)}>{e.id}</button>)}</div>
          {els.filter((e: any) => e.id === (selEl ?? els[0]?.id)).map((e: any) => <div key={e.id}>
            <div style={{ color: "var(--mu)", fontSize: 11 }}>&lt;{e.tag}&gt; line {e.line}</div>
            {(() => {
              const ed: string[] = e.editable ?? [];
              const have = e.attrs.filter((a: any) => a.name !== "id" && a.name !== "editable");
              const rows = [...have, ...ed.filter(n => !have.some((a: any) => a.name === n)).map(n => ({ name: n, kind: "missing", value: "" }))];
              return <>{!e.editable && <div style={{ color: "var(--mu)", fontSize: 11 }}>no editable metadata: read-only</div>}
                {rows.map((a: any) => {
                  const isEd = ed.includes(a.name), ro = !isEd || a.kind === "expr" || a.kind === "bool";
                  const why = !isEd ? "not marked editable in the source" : ro ? "expression: edit in code" : "";
                  return <label className="pr" key={e.id + a.name + a.value}>{a.name}
                    <input defaultValue={a.kind === "expr" || a.kind === "bool" ? "ƒ " + a.value : a.value} disabled={ro} title={why} placeholder={a.kind === "missing" ? "(unset)" : ""}
                      type={a.kind === "str" && /^#[0-9a-f]{6}$/i.test(a.value) ? "color" : "text"}
                      onBlur={ev => { const v = ev.target.value; if (ro || v === a.value || (a.kind === "missing" && v === "")) return;
                        setProp(e.id, a.name, v, a.kind === "num" || (a.kind === "missing" && !isNaN(Number(v)))); }}
                      onKeyDown={ev => { if (ev.key === "Enter") (ev.target as HTMLInputElement).blur(); }} /></label>; })}</>;
            })()}
          </div>)}</>}
      </div>
    </div>
    <div className="tl"><h4>Timeline</h4><div className="tlin" ref={tlRef} onClick={tlClick}>
      <div className="ruler">{Array.from({ length: Math.floor((D - 1) / Math.round(fpsv)) + 1 }, (_, i) => <span key={i} className="tick" style={{ left: pct(i * Math.round(fpsv)) }}>{i}s</span>)}
        {clips.filter(c => c.kind === "marker").map(m => <span key={m.id} className="mk" style={{ left: pct(m.from) }} title={`${m.id}${m.meta ? ": " + m.meta : ""} @${m.from}`}>◆</span>)}</div>
      {(() => {
        const rows = (list: Clip[]) => list.map((c, i) => {
          const dragging = drag && drag.id === c.id, ok = dragOk(c);
          const from = dragging ? drag!.abs : c.from, dur = dragging ? drag!.dur : (c.duration ?? D - c.from);
          return <div className="row" key={c.kind + c.id + i}><span className="lab" style={{ paddingLeft: c.depth * 8 }}>{c.id}</span>
            <div data-id={c.id} className={`clip k-${c.kind}${sel === c ? " sel" : ""}${ok ? " ed" : ""}${dragging ? " dragging" : ""}`}
              style={{ left: pct(from), width: pct(Math.max(0, Math.min(dur, D - from))) }}
              title={ok ? "drag to move, drag the edges to trim" : c.kind === "sequence" ? "not draggable: needs id + editable={{ from: true, durationInFrames: true }} and numeric literals" : ""}
              onPointerDown={ok ? e => { const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left; startDrag(e, c, x < 7 ? "l" : x > r.width - 7 ? "r" : "move"); } : undefined}
              onClick={e => { e.stopPropagation(); if (justDragged.current) { justDragged.current = false; return; } setSel(c); setFrame(c.from); }}>
              {dragging ? `${drag!.abs}→${drag!.abs + drag!.dur}` : c.kind === "transition" ? c.id : c.kind}</div></div>; });
        const tracks = clips.filter(c => c.kind === "track"), media = (t?: string) => clips.filter(c => c.track === t && c.kind !== "track" && c.kind !== "marker");
        return <>{tracks.map(t => <div key={t.id}><div className="row th"><span className="lab">▾ {t.id}</span><span className="tname">{t.meta}</span></div>{rows(media(t.id))}</div>)}
          {rows(media(undefined))}</>; })()}
      <div className="ph" style={{ left: pct(frame) }} /></div></div>
    <div className="out"><span className={err ? "err" : ""}>{status}</span>{prog !== null && <div className="bar"><i style={{ width: prog + "%" }} /></div>}</div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<App />);
