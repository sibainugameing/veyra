import test from "node:test"; import assert from "node:assert/strict";
import { build } from "esbuild";
await build({ entryPoints: ["packages/core/src/index.tsx"], bundle: true, format: "esm", platform: "node", external: ["react"], jsx: "automatic", outfile: ".veyra/test/core.mjs", logLevel: "error" });
const V = await import("../.veyra/test/core.mjs");
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);

test("parseFps: ints, fractions, reduction, rejects floats", () => {
  assert.deepEqual(V.parseFps(30), { num: 30, den: 1 });
  assert.deepEqual(V.parseFps("30000/1001"), { num: 30000, den: 1001 });
  assert.deepEqual(V.parseFps("60/2"), { num: 30, den: 1 });
  assert.throws(() => V.parseFps(29.97), /fraction|string/); assert.throws(() => V.parseFps("0/1")); assert.throws(() => V.parseFps(-5));
});
test("interpolate: easing, clamp/extend, validation", () => {
  near(V.interpolate(15, [0, 30], [0, 1], { easing: V.Easing.linear }), 0.5);
  near(V.interpolate(15, [0, 30], [0, 1]), 0.5); near(V.interpolate(-10, [0, 30], [5, 9]), 5); near(V.interpolate(40, [0, 30], [5, 9]), 9);
  near(V.interpolate(60, [0, 30], [0, 1], { easing: V.Easing.linear, extrapolateRight: "extend" }), 2);
  assert.throws(() => V.interpolate(1, [0, 0], [0, 1])); assert.throws(() => V.interpolate(1, [0, 1], [0]));
});
test("Easing.bezier matches linear for (0,0,1,1) and is monotone for ease-out", () => {
  near(V.Easing.bezier(0, 0, 1, 1)(0.3), 0.3, 1e-4);
  const e = V.Easing.bezier(0, 0, 0.2, 1); let p = 0; for (let t = 0; t <= 1; t += 0.05) { const v = e(t); assert.ok(v >= p - 1e-9); p = v; }
});
test("keyframes: segments, clamp, per-segment easing", () => {
  const k = [{ at: 0, value: 0, easing: V.Easing.linear }, { at: 10, value: 100 }, { at: 20, value: 0 }];
  near(V.keyframes(-5, k), 0); near(V.keyframes(5, k), 50); near(V.keyframes(10, k), 100); near(V.keyframes(15, k), 50); near(V.keyframes(99, k), 0);
  assert.throws(() => V.keyframes(1, [{ at: 5, value: 0 }, { at: 5, value: 1 }]));
});
test("spring: starts at 0, settles at 1; under/critical/over-damped behave", () => {
  const sp = (frame, config, extra = {}) => V.spring({ frame, fps: 30, config, ...extra });
  near(sp(0, {}), 0); near(sp(600, {}), 1, 1e-3);
  assert.ok(Math.max(...Array.from({ length: 120 }, (_, f) => sp(f, { damping: 5 }))) > 1.05, "underdamped overshoots");
  const over = Array.from({ length: 300 }, (_, f) => sp(f, { damping: 40 })); assert.ok(Math.max(...over) <= 1 + 1e-9, "overdamped never overshoots");
  for (let f = 1; f < over.length; f++) assert.ok(over[f] >= over[f - 1] - 1e-9, "overdamped monotone");
  assert.ok(Math.max(...Array.from({ length: 300 }, (_, f) => sp(f, { damping: 20 }))) <= 1 + 1e-6, "critical never overshoots");
});
test("spring: durationInFrames settles within N frames; delay; from/to; rational fps", () => {
  const f = n => V.spring({ frame: n, fps: 30, from: 0, to: 300, durationInFrames: 45 });
  near(f(0), 0); assert.ok(Math.abs(f(45) - 300) < 3.1 && Math.abs(f(120) - 300) < 3.1); assert.ok(f(10) < 280);
  near(V.spring({ frame: 5, fps: 30, delay: 10 }), 0); near(V.spring({ frame: 100, fps: { num: 30000, den: 1001 }, from: 5, to: 9 }), 9, 1e-2);
});
test("combinators", () => {
  assert.equal(V.loop(7, 5), 2); assert.equal(V.loop(-1, 5), 4); assert.equal(V.pingPong(7, 5), 3); assert.equal(V.pingPong(12, 5), 2);
  assert.equal(V.timeScale(10, 2, 4), 12); assert.equal(V.reverse(0, 30), 29); assert.equal(V.stagger(3, 4), 12); assert.deepEqual(V.chain([30, 20, 40]), [0, 30, 50]);
});
