import React, { createContext, useContext } from "react";
const FrameCtx = createContext(0);
const SeqCtx = createContext({ off: 0, dur: Infinity, depth: 0 });
export type Clip = { id: string; kind: "sequence" | "audio" | "video" | "image" | "track" | "transition" | "marker"; from: number; duration: number; depth: number; src?: string;
  track?: string; /** Sequence: start relative to its parent (what `from={..}` says in the source) */ localFrom?: number; /** track kind, transition type, marker label */ meta?: string };
const TrackCtx = createContext<string | undefined>(undefined);
/** Timeline model collected while rendering; exported to .veyra/timeline.json (GUI / AI read this). */
export const timelinePlan = new Map<string, Clip>();
function useClip(kind: Clip["kind"], src: string) {
  const s = useContext(SeqCtx);
  timelinePlan.set(`${kind}:${src}@${s.off}`, { id: src.split("/").pop()!, kind, from: s.off, duration: s.dur, depth: s.depth, src, track: useContext(TrackCtx) });
  return s;
}
/** Audio plan collected during rendering; read by the renderer after the last frame. */
export const audioPlan = new Map<string, { src: string; fromFrame: number; volume: number }>();
export const FrameProvider = FrameCtx.Provider;
export const useFrame = () => useContext(FrameCtx);

// ---------- time: rational fps (spec 6.1) ----------
export type Fps = { num: number; den: number };
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
export function parseFps(v: number | string | Fps): Fps {
  let n: number, d = 1;
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error(`fps ${v} is not an integer; write fractional rates as a string, e.g. "30000/1001"`);
    n = v;
  } else if (typeof v === "string") { const [a, b] = v.split("/"); n = Number(a); d = b === undefined ? 1 : Number(b); }
  else { n = v.num; d = v.den; }
  if (!Number.isInteger(n) || !Number.isInteger(d) || n <= 0 || d <= 0) throw new Error(`invalid fps: ${JSON.stringify(v)}`);
  const g = gcd(n, d);
  return { num: n / g, den: d / g };
}
export type VideoConfig = { id: string; width: number; height: number; fps: Fps; durationInFrames: number };
const ConfigCtx = createContext<VideoConfig | null>(null);
/** Set while rendering; the renderer reads it (window.__veyra.config) so the code is the source of truth. */
export const compositionPlan: { current: VideoConfig | null } = { current: null };
export function useVideoConfig(): VideoConfig {
  const c = useContext(ConfigCtx);
  if (!c) throw new Error("useVideoConfig() must be used inside <Composition>");
  return c;
}
export function Composition(p: { id: string; width: number; height: number; fps: number | string | Fps; durationInFrames: number; children?: React.ReactNode }) {
  for (const k of ["width", "height", "durationInFrames"] as const)
    if (!Number.isInteger(p[k]) || p[k] <= 0) throw new Error(`<Composition ${p.id}>: ${k} must be a positive integer (got ${p[k]})`);
  const cfg: VideoConfig = { id: p.id, width: p.width, height: p.height, fps: parseFps(p.fps), durationInFrames: p.durationInFrames };
  compositionPlan.current = cfg;
  return (
    <ConfigCtx.Provider value={cfg}>
      <div data-veyra-composition={p.id} style={{ position: "relative", width: p.width, height: p.height, overflow: "hidden" }}>{p.children}</div>
    </ConfigCtx.Provider>
  );
}

// ---------- animation (spec 5.3): pure functions of the frame number ----------
export type EasingFn = (t: number) => number;
export const Easing = {
  linear: (t: number) => t,
  in: (t: number) => t * t,
  out: (t: number) => 1 - (1 - t) * (1 - t),
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  cubicIn: (t: number) => t * t * t,
  cubicOut: (t: number) => 1 - Math.pow(1 - t, 3),
  cubicInOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  /** CSS-style cubic-bezier(x1, y1, x2, y2), solved by bisection (deterministic). */
  bezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
    const cx = (t: number) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
    const cy = (t: number) => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
    return (x: number) => { if (x <= 0) return 0; if (x >= 1) return 1; let lo = 0, hi = 1;
      for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (cx(m) < x) lo = m; else hi = m; } return cy((lo + hi) / 2); };
  },
};
type Extrap = "clamp" | "extend";
/** Piecewise interpolation. Default easing is Easing.inOut (use { easing: Easing.linear } for linear). */
export function interpolate(f: number, inp: number[], out: number[], o: { easing?: EasingFn; extrapolateLeft?: Extrap; extrapolateRight?: Extrap } = {}): number {
  const n = inp.length;
  if (n < 2 || out.length !== n) throw new Error("interpolate: input and output ranges must have the same length (>= 2)");
  for (let k = 1; k < n; k++) if (!(inp[k] > inp[k - 1])) throw new Error("interpolate: input range must be strictly increasing");
  const easing = o.easing ?? Easing.inOut;
  if (f < inp[0]) return o.extrapolateLeft === "extend" ? out[0] + (out[1] - out[0]) * (f - inp[0]) / (inp[1] - inp[0]) : out[0];
  if (f > inp[n - 1]) return o.extrapolateRight === "extend" ? out[n - 1] + (out[n - 1] - out[n - 2]) * (f - inp[n - 1]) / (inp[n - 1] - inp[n - 2]) : out[n - 1];
  for (let k = 1; k < n; k++) if (f <= inp[k]) return out[k - 1] + (out[k] - out[k - 1]) * easing((f - inp[k - 1]) / (inp[k] - inp[k - 1]));
  return out[n - 1];
}
export type Keyframe = { at: number; value: number; easing?: EasingFn };
/** Keyframes with a per-segment easing (taken from the segment's starting keyframe). */
export function keyframes(frame: number, kfs: Keyframe[]): number {
  if (kfs.length === 0) throw new Error("keyframes: need at least one keyframe");
  for (let k = 1; k < kfs.length; k++) if (!(kfs[k].at > kfs[k - 1].at)) throw new Error("keyframes: 'at' must be strictly increasing");
  if (frame <= kfs[0].at) return kfs[0].value;
  const last = kfs[kfs.length - 1]; if (frame >= last.at) return last.value;
  for (let k = 1; k < kfs.length; k++) if (frame <= kfs[k].at) {
    const a = kfs[k - 1], b = kfs[k];
    return a.value + (b.value - a.value) * (a.easing ?? Easing.inOut)((frame - a.at) / (b.at - a.at));
  }
  return last.value;
}
export type SpringConfig = { stiffness?: number; damping?: number; mass?: number };
/** Closed-form damped oscillator, 0 -> 1, zero initial velocity (no simulation state, so any frame can be seeked). */
function springUnit(t: number, { stiffness = 100, damping = 10, mass = 1 }: SpringConfig): number {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass), z = damping / (2 * Math.sqrt(stiffness * mass));
  if (Math.abs(z - 1) < 1e-9) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  if (z < 1) { const wd = w0 * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t)); }
  const s = Math.sqrt(z * z - 1), r1 = -w0 * (z - s), r2 = -w0 * (z + s);
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}
const settleCache = new Map<string, number>();
function settleTime(c: SpringConfig): number { // last time the spring is more than 1% away from its target
  const key = JSON.stringify(c); const hit = settleCache.get(key); if (hit !== undefined) return hit;
  let last = 0; for (let t = 0; t <= 20; t += 0.005) if (Math.abs(1 - springUnit(t, c)) > 0.01) last = t;
  settleCache.set(key, last + 0.005); return last + 0.005;
}
export function spring(o: { frame: number; fps: number | Fps; from?: number; to?: number; config?: SpringConfig; delay?: number; durationInFrames?: number }): number {
  const fpsN = typeof o.fps === "number" ? o.fps : o.fps.num / o.fps.den;
  let t = (o.frame - (o.delay ?? 0)) / fpsN;
  if (o.durationInFrames) t = t * settleTime(o.config ?? {}) / (o.durationInFrames / fpsN); // stretch so it settles in N frames
  return (o.from ?? 0) + ((o.to ?? 1) - (o.from ?? 0)) * springUnit(t, o.config ?? {});
}
// small combinators: repeat / reverse / speed / sequencing
export const loop = (f: number, period: number) => ((f % period) + period) % period;
export const pingPong = (f: number, period: number) => { const m = loop(f, 2 * period); return m <= period ? m : 2 * period - m; };
export const timeScale = (f: number, rate: number, offset = 0) => (f - offset) * rate;
export const reverse = (f: number, duration: number) => duration - 1 - f;
export const stagger = (index: number, gap: number) => index * gap;
/** Start frames for back-to-back segments: chain([30, 20, 40]) -> [0, 30, 50]. */
export const chain = (durations: number[]) => { let s = 0; return durations.map(d => { const x = s; s += d; return x; }); };

export function Sequence(p: { id?: string; name?: string; editable?: Record<string, boolean>; from: number; durationInFrames: number; children?: React.ReactNode }) {
  const f = useFrame();
  const parent = useContext(SeqCtx);
  const track = useContext(TrackCtx);
  const abs = parent.off + p.from;
  const id = p.id ?? p.name ?? `sequence@${abs}+${p.durationInFrames}`;
  timelinePlan.set(`${id}:${abs}:${p.durationInFrames}`, { id, kind: "sequence", from: abs, duration: p.durationInFrames, depth: parent.depth, track, localFrom: p.from });
  if (f < p.from || f >= p.from + p.durationInFrames) return null;
  return (
    <SeqCtx.Provider value={{ off: abs, dur: p.durationInFrames, depth: parent.depth + 1 }}>
      <FrameCtx.Provider value={f - p.from}>{p.children}</FrameCtx.Provider>
    </SeqCtx.Provider>
  );
}
/** A layer lane (spec 5.4). Later tracks paint above earlier ones. */
export function Track(p: { id: string; kind?: "video" | "audio" | "overlay"; children?: React.ReactNode }) {
  timelinePlan.set(`track:${p.id}`, { id: p.id, kind: "track", from: 0, duration: Infinity, depth: 0, meta: p.kind ?? "overlay" });
  return (
    <TrackCtx.Provider value={p.id}>
      <div data-veyra-track={p.id} style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%" }}>{p.children}</div>
    </TrackCtx.Provider>
  );
}
/** Fade / slide in and out over the enclosing Sequence. Pure function of the frame. */
export function Transition(p: { type?: "fade" | "slide-up" | "slide-left"; inFrames?: number; outFrames?: number; children?: React.ReactNode }) {
  const f = useFrame();
  const { off, dur, depth } = useContext(SeqCtx);
  const track = useContext(TrackCtx);
  const type = p.type ?? "fade", inF = p.inFrames ?? 0, outF = p.outFrames ?? 0;
  if (inF > 0) timelinePlan.set(`transition-in:${type}@${off}`, { id: `${type} in`, kind: "transition", from: off, duration: inF, depth, track, meta: type });
  if (outF > 0) timelinePlan.set(`transition-out:${type}@${off}`, { id: `${type} out`, kind: "transition", from: off + dur - outF, duration: outF, depth, track, meta: type });
  const a = inF > 0 ? Math.min(1, (f + 1) / inF) : 1, b = outF > 0 ? Math.min(1, (dur - f) / outF) : 1;
  const k = Math.min(a, b), slide = (1 - k) * 60;
  const transform = type === "slide-up" ? `translateY(${slide}px)` : type === "slide-left" ? `translateX(${-slide}px)` : undefined;
  return <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", opacity: type === "fade" ? k : Math.min(1, k * 2), transform }}>{p.children}</div>;
}
/** A named point on the timeline (frame is relative to the enclosing Sequence). */
export function Marker(p: { id: string; frame: number; label?: string }) {
  const { off, depth } = useContext(SeqCtx);
  timelinePlan.set(`marker:${p.id}`, { id: p.id, kind: "marker", from: off + p.frame, duration: 1, depth, meta: p.label });
  return null;
}
export function Text(p: { id?: string; editable?: Record<string, boolean>; text: string; fontSize?: number; color?: string; opacity?: number; x?: number; y?: number }) {
  return (
    <div data-veyra-id={p.id} style={{ position: "absolute", left: `${p.x ?? 50}%`, top: `${p.y ?? 50}%`, transform: "translate(-50%,-50%)",
      fontSize: p.fontSize ?? 64, color: p.color ?? "#fff", opacity: p.opacity ?? 1, fontFamily: "sans-serif", fontWeight: 600, whiteSpace: "nowrap" }}>{p.text}</div>
  );
}

/** Audio is not played in the renderer: it only registers a mix instruction (absolute start frame). */
export function Audio(p: { id?: string; editable?: Record<string, boolean>; src: string; volume?: number }) {
  const { off } = useClip("audio", p.src);
  audioPlan.set(`${p.src}@${off}`, { src: p.src, fromFrame: off, volume: p.volume ?? 1 });
  return null;
}

const mediaKey = (src: string) => src.split("/").pop()!.replace(/\.[^.]+$/, "");
const box = (p: { x?: number; y?: number; width?: number; height?: number; opacity?: number }): React.CSSProperties => ({
  position: "absolute", left: p.x ?? 0, top: p.y ?? 0, width: p.width, height: p.height, opacity: p.opacity ?? 1,
});
type Box = { id?: string; editable?: Record<string, boolean>; x?: number; y?: number; width?: number; height?: number; opacity?: number };

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
