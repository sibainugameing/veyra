import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
declare const veyra: any; declare const monacoReady: Promise<any>;
type Clip = { id: string; kind: string; from: number; duration: number; depth: number; src?: string };

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
          setErr(!r.ok); setStatus(r.ok ? "Built" : r.error); if (r.ok) setRev(x => x + 1); }, 400); });
      loadFile("src/main.tsx");
      if (proj.test.edit) setTimeout(() => editor.current.setValue(editor.current.getValue().replace("Welcome to Veyra", "Edited from the GUI")), 2500);
    }); return () => { dead = true; }; }, [proj]);
  const fileRef = useRef(file); fileRef.current = file;
  const loadFile = async (rel: string) => { setFile(rel); fileRef.current = rel;
    if (!/\.(tsx?|json|md)$/.test(rel)) { suppress.current = true; editor.current?.setValue(`// ${rel}\n// binary asset (preview not supported)`); suppress.current = false; return; }
    const t = await veyra.readFile(rel); suppress.current = true; editor.current?.setValue(t); suppress.current = false; };

  // preview <-> runtime messaging
  useEffect(() => { const h = (e: MessageEvent) => { const d = e.data;
    if (d?.type === "runtimeReady") { runtimeReady.current = true; ifr.current?.contentWindow?.postMessage({ type: "scan", duration: proj.config.durationInFrames, frame }, "*"); }
    else if (d?.type === "timeline") setClips(d.clips); };
    window.addEventListener("message", h); return () => window.removeEventListener("message", h); }, [proj, frame]);
  useEffect(() => { ifr.current?.contentWindow?.postMessage({ type: "setFrame", frame }, "*"); }, [frame]);
  useEffect(() => { runtimeReady.current = false; }, [rev]);
  useEffect(() => { if (!playing || !proj) return; const t = setInterval(() => setFrame(f => (f + 1) % proj.config.durationInFrames), 1000 / proj.config.fps); return () => clearInterval(t); }, [playing, proj]);
  useEffect(() => { if (!pvbox.current || !proj) return; const ro = new ResizeObserver(() => setScale(pvbox.current!.clientWidth / proj.config.width)); ro.observe(pvbox.current); return () => ro.disconnect(); }, [proj]);

  if (!proj) return <div style={{ padding: 20 }}>Loading…</div>;
  const cfg = proj.config, D = cfg.durationInFrames, pct = (f: number) => (f / D * 100) + "%";
  const tlClick = (e: React.MouseEvent<HTMLDivElement>) => { const b = e.currentTarget.getBoundingClientRect(); setFrame(Math.max(0, Math.min(D - 1, Math.floor((e.clientX - b.left) / b.width * D)))); };

  return <div className="app">
    <div className="top"><b>Veyra Studio</b><span style={{ color: "var(--mu)" }}>{cfg.name} · {cfg.width}×{cfg.height} · {cfg.fps}fps · {D}f</span><span className="sp" />
      <button className="p" onClick={() => { setStatus("Rendering…"); setErr(false); veyra.render(); }}>● Export mp4</button></div>
    <div className="files"><h4>Explorer</h4>{proj.files.map((f: string) => <div key={f} className={f === file ? "on" : ""} onClick={() => loadFile(f)}>{f}</div>)}</div>
    <div><h4>Code · {file}</h4><div id="ed" ref={edEl} /></div>
    <div className="right">
      <div className="pv"><h4 style={{ padding: "0 0 4px" }}>Preview</h4>
        <div className="pvbox" ref={pvbox} style={{ height: cfg.height * scale }}>
          <iframe ref={ifr} key={rev} src={proj.runtimeUrl + "?rev=" + rev} style={{ width: cfg.width, height: cfg.height, transform: `scale(${scale})` }} /></div></div>
      <div className="ctl"><button onClick={() => setPlaying(p => !p)}>{playing ? "⏸" : "▶"}</button>
        <input type="range" min={0} max={D - 1} value={frame} onChange={e => setFrame(+e.target.value)} />
        <span>{frame}/{D - 1} · {(frame / cfg.fps).toFixed(2)}s</span></div>
      <h4>Inspector</h4>
      <div className="insp">{sel ? <dl><dt>id</dt><dd>{sel.id}</dd><dt>kind</dt><dd>{sel.kind}</dd><dt>from</dt><dd>{sel.from}f ({(sel.from / cfg.fps).toFixed(2)}s)</dd>
        <dt>duration</dt><dd>{sel.duration}f</dd>{sel.src && <><dt>src</dt><dd>{sel.src}</dd></>}</dl> : <span style={{ color: "var(--mu)" }}>Select a clip in the timeline. (Editable props: Phase 2b)</span>}</div>
    </div>
    <div className="tl"><h4>Timeline</h4><div className="tlin" onClick={tlClick}>
      {clips.map((c, i) => <div className="row" key={i}><span className="lab" style={{ paddingLeft: c.depth * 8 }}>{c.id}</span>
        <div className={`clip k-${c.kind}${sel === c ? " sel" : ""}`} style={{ left: pct(c.from), width: pct(Math.min(c.duration, D - c.from)) }}
          onClick={e => { e.stopPropagation(); setSel(c); setFrame(c.from); }}>{c.kind}</div></div>)}
      <div className="ph" style={{ left: pct(frame) }} /></div></div>
    <div className="out"><span className={err ? "err" : ""}>{status}</span>{prog !== null && <div className="bar"><i style={{ width: prog + "%" }} /></div>}</div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<App />);
