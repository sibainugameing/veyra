import React, { createContext, useContext } from "react";
const FrameCtx = createContext(0);
const SeqCtx = createContext({ off: 0, dur: Infinity, depth: 0 });
export type Clip = { id: string; kind: "sequence" | "audio" | "video" | "image"; from: number; duration: number; depth: number; src?: string };
/** Timeline model collected while rendering; exported to .veyra/timeline.json (GUI / AI read this). */
export const timelinePlan = new Map<string, Clip>();
function useClip(kind: Clip["kind"], src: string) {
  const s = useContext(SeqCtx);
  timelinePlan.set(`${kind}:${src}@${s.off}`, { id: src.split("/").pop()!, kind, from: s.off, duration: s.dur, depth: s.depth, src });
  return s;
}
/** Audio plan collected during rendering; read by the renderer after the last frame. */
export const audioPlan = new Map<string, { src: string; fromFrame: number; volume: number }>();
export const FrameProvider = FrameCtx.Provider;
export const useFrame = () => useContext(FrameCtx);

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
/** Pure function of frame: no clock, no randomness (determinism, spec ch.6). */
export function interpolate(f: number, inp: number[], out: number[]): number {
  const n = inp.length;
  if (f <= inp[0]) return out[0];
  if (f >= inp[n - 1]) return out[n - 1];
  for (let k = 1; k < n; k++) if (f <= inp[k]) {
    const t = (f - inp[k - 1]) / (inp[k] - inp[k - 1]);
    return out[k - 1] + (out[k] - out[k - 1]) * ease(t);
  }
  return out[n - 1];
}
export function Sequence(p: { from: number; durationInFrames: number; name?: string; children: React.ReactNode }) {
  const f = useFrame();
  const parent = useContext(SeqCtx);
  const abs = parent.off + p.from;
  const id = p.name ?? `sequence@${abs}+${p.durationInFrames}`;
  timelinePlan.set(`${id}:${abs}:${p.durationInFrames}`, { id, kind: "sequence", from: abs, duration: p.durationInFrames, depth: parent.depth });
  if (f < p.from || f >= p.from + p.durationInFrames) return null;
  return (
    <SeqCtx.Provider value={{ off: abs, dur: p.durationInFrames, depth: parent.depth + 1 }}>
      <FrameCtx.Provider value={f - p.from}>{p.children}</FrameCtx.Provider>
    </SeqCtx.Provider>
  );
}
export function Text(p: { id?: string; text: string; fontSize?: number; color?: string; opacity?: number; x?: number; y?: number }) {
  return (
    <div data-veyra-id={p.id} style={{ position: "absolute", left: `${p.x ?? 50}%`, top: `${p.y ?? 50}%`, transform: "translate(-50%,-50%)",
      fontSize: p.fontSize ?? 64, color: p.color ?? "#fff", opacity: p.opacity ?? 1, fontFamily: "sans-serif", fontWeight: 600, whiteSpace: "nowrap" }}>{p.text}</div>
  );
}

/** Audio is not played in the renderer: it only registers a mix instruction (absolute start frame). */
export function Audio(p: { src: string; volume?: number }) {
  const { off } = useClip("audio", p.src);
  audioPlan.set(`${p.src}@${off}`, { src: p.src, fromFrame: off, volume: p.volume ?? 1 });
  return null;
}

const mediaKey = (src: string) => src.split("/").pop()!.replace(/\.[^.]+$/, "");
const box = (p: { x?: number; y?: number; width?: number; height?: number; opacity?: number }): React.CSSProperties => ({
  position: "absolute", left: p.x ?? 0, top: p.y ?? 0, width: p.width, height: p.height, opacity: p.opacity ?? 1,
});
type Box = { x?: number; y?: number; width?: number; height?: number; opacity?: number };

export function Image(p: Box & { src: string; fit?: "cover" | "contain" | "fill" }) {
  useClip("image", p.src);
  return <img src={p.src} style={{ ...box(p), objectFit: p.fit ?? "contain" }} />;
}
export function Shape(p: Box & { kind?: "rect" | "circle"; fill?: string; radius?: number }) {
  return <div style={{ ...box(p), background: p.fill ?? "#fff", borderRadius: p.kind === "circle" ? "50%" : p.radius ?? 0 }} />;
}
/** Frame-accurate video: shows pre-extracted frame N (see scripts/media.mjs). Avoids <video> seek nondeterminism. */
export function Video(p: Box & { src: string; fit?: "cover" | "contain" | "fill"; audio?: boolean; volume?: number }) {
  const f = useFrame();
  const { off } = useClip("video", p.src);
  if (p.audio) audioPlan.set(`${p.src}@${off}`, { src: p.src, fromFrame: off, volume: p.volume ?? 1 });
  return <img src={`.veyra/media/${mediaKey(p.src)}/${String(f).padStart(5, "0")}.png`} style={{ ...box(p), objectFit: p.fit ?? "contain" }} />;
}
