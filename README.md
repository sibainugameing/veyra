# Veyra: Phase 0 prototype
TSX -> esbuild -> React in Electron Chromium -> PNG per frame -> FFmpeg -> mp4. Rust CLI drives it.

## Architecture (as in the plan)
Rust core (`crates/`) owns project, timeline, media, render orchestration and the JSON command API.
Electron is a thin shell (GUI + the Chromium frame renderer). Node is used only for esbuild bundling.

    veyra-project  config, path-confined file access     veyra-media   FFmpeg: frames, audio mix, cache key
    veyra-timeline timeline model + validate             veyra-render  build -> cache -> Chromium -> mux
    veyra-core     command API (JSON)                    veyra-cli     `veyra` binary (JSON lines)

## Run
    npm install && cargo build --release
    ./target/release/veyra render            # headless Linux: VEYRA_WRAPPER="xvfb-run -a" VEYRA_NO_SANDBOX=1
    ./target/release/veyra validate | inspect | timeline
    ./target/release/veyra api '{"cmd":"file.read","path":"src/main.tsx"}'
    npm run desktop                          # GUI
    cargo test                               # unit tests
    ./scripts/determinism.sh

## Phase 0 checklist (Appendix B)
- [x] 1-3 TSX -> per-frame React -> Chromium capture (implemented, untested)
- [x] 4 Rust core drives render, cache, mux; built and tested (6 unit tests + e2e)
- [x] 5 A/V sync verified in sandbox: Audio at frame 30 -> tone at 1.00-2.00s, A/V both 3.0s
- [x] 1-3,6 verified in sandbox (Electron 33 + xvfb): 90 frames, 1280x720, two runs bit-identical
- [x] Phase 1a: Image, Shape, Video (frame-accurate via pre-extracted frames; verified: video frame 40 shows t=1.333s)
- [x] Phase 1b (verified in sandbox): timeline model -> .veyra/timeline.json; build-level render cache (9.1s -> 0.9s on hit, invalidated by asset change); `npm run veyra -- validate` (missing assets, bad ranges)
- [x] Phase 2a (verified via xvfb screenshots): Electron + React desktop app (`npm run desktop`): Explorer, Monaco editor, live preview (iframe runtime over postMessage), timeline, inspector (read-only), mp4 export with progress. Edit -> save -> rebuild -> preview reload confirmed. In containers add `--no-sandbox`.
- [ ] 7 Electron <-> Rust JSON IPC (progress is printed as JSON lines; not yet consumed)
- [ ] 8 4GB memory test, 9 preview/output diff, 10 license audit
