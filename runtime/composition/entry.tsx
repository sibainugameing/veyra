import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { FrameProvider, audioPlan, timelinePlan } from "@veyra/core";
import Main from "@project";

const root = createRoot(document.getElementById("root")!);
// Explicit prepare phase (ch.6.3): fonts must be ready before any frame is captured.
const api = {
  timeline: () => [...timelinePlan.values()].sort((a, b) => a.from - b.from || a.depth - b.depth),
  audio: () => [...audioPlan.values()],
  ready: document.fonts.ready,
  setFrame(n: number) {
    flushSync(() => root.render(<FrameProvider value={n}><Main /></FrameProvider>));
    return document.fonts.ready.then(() => Promise.all([...document.images].map(i => i.decode().catch(() => {})))).then(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  },
};
(window as any).__veyra = api;
// Editor <-> runtime protocol (Editor React and Composition React stay separate, spec 4.2).
window.addEventListener("message", async e => {
  const d = e.data;
  if (d?.type === "setFrame") { await api.setFrame(d.frame); parent.postMessage({ type: "frameReady", frame: d.frame }, "*"); }
  else if (d?.type === "scan") { // render every frame once so the timeline plan is complete
    for (let f = 0; f < d.duration; f++) await api.setFrame(f);
    await api.setFrame(d.frame ?? 0);
    parent.postMessage({ type: "timeline", clips: api.timeline() }, "*");
  }
});
parent.postMessage({ type: "runtimeReady" }, "*");
