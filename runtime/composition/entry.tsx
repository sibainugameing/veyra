import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { FrameProvider, audioPlan, timelinePlan, compositionPlan } from "@veyra/core";
import Main from "@project";

const root = createRoot(document.getElementById("root")!);
const draw = (n: number) => flushSync(() => root.render(<FrameProvider value={n}><Main /></FrameProvider>));
// Explicit prepare phase (ch.6.3): fonts and images must be ready before any frame is captured.
const api = {
  /** The <Composition> declared in code (null if the project has none). */
  config() { compositionPlan.current = null; draw(0); return compositionPlan.current; },
  timeline: () => [...timelinePlan.values()].sort((a, b) => a.from - b.from || a.depth - b.depth),
  audio: () => [...audioPlan.values()],
  ready: document.fonts.ready,
  setFrame(n: number) {
    draw(n);
    return document.fonts.ready.then(() => Promise.all([...document.images].map(i => i.decode().catch(() => {}))))
      .then(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  },
};
(window as any).__veyra = api;
// Editor <-> runtime protocol (Editor React and Composition React stay separate, spec 4.2).
window.addEventListener("message", async e => {
  const d = e.data;
  try {
    if (d?.type === "setFrame") { await api.setFrame(d.frame); parent.postMessage({ type: "frameReady", frame: d.frame }, "*"); }
    else if (d?.type === "scan") { // render every frame once so the timeline plan is complete
      const c = api.config(); const D = c?.durationInFrames ?? d.duration;
      for (let f = 0; f < D; f++) await api.setFrame(f);
      await api.setFrame(Math.min(d.frame ?? 0, D - 1));
      parent.postMessage({ type: "timeline", clips: api.timeline(), config: c }, "*");
    }
  } catch (err: any) { parent.postMessage({ type: "error", msg: String(err?.message ?? err) }, "*"); }
});
parent.postMessage({ type: "runtimeReady" }, "*");
