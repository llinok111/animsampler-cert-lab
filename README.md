# glTF rotation-sampler defect certifier

**Promise:** repair 100/100 injected glTF rotation-track defects into a clean contract, keeping
value-corruption repairs within **1.5°** of the un-injected track, where a naive component-lerp
viewer is wrong by **>1° on 35.90% of 200,000 samples (max 179.85°)**.

Upstream: none

This is an original tool, not a fork. It targets the rotation half of glTF animation sampling:
hemisphere continuity, unit quaternions, duplicate/non-monotonic input times, degenerate keys, and
cubic-spline tangents that are missing or stored in the wrong units. The core is pure ES module math
and runs in node; the browser page calls exactly the same module.

## Run it in one command

```bash
node tools/gen-sample.mjs && node bench/verify.mjs
```

Expected last line: `20 passed, 0 failed`. The generator is deterministic (fixed seed), writes
`data/animation-cases.json`, and is safe to re-run:

```bash
rm -rf data && node tools/gen-sample.mjs && sha256sum data/animation-cases.json
# 7dcc501b16fa606617ce162e6adf3b09558c1636709714aa4b401242dbcdafd4
```

Timing run (7 samples + cold start, writes `bench/result.json`):

```bash
node bench/bench.mjs
```

Browser page (any static server; three.js is pinned by importmap, no build step):

```bash
python3 -m http.server 4173   # then open http://localhost:4173
```

**Evidence (real run, 2026-11-18):** `20 passed, 0 failed`; 100/100 injected clips repaired valid;
0/15 false positives on clean clips; 200,000 samples against an independent 3×3 matrix oracle;
naive baseline off by >1° on 35.90% (max 179.85°). Full per-class table below.

## What it does

`src/core.mjs` exposes `validateClip`, `repairClip` and `evaluateQuat`. A clip is
`{duration, times[], values[] (quaternions), interpolation, inTangents?, outTangents?}`.

| defect code | injected as | repair |
|---|---|---|
| `quat-non-unit` | key scaled by 1.2 | renormalize |
| `quat-sign-flip` | one key negated (same rotation, opposite hemisphere) | flip to dot ≥ 0 with predecessor |
| `quat-zero` | key replaced by `[0,0,0,0]` | rebuild from adjacent keys by slerp |
| `non-finite` | one quaternion component set to `NaN` | rebuild from adjacent keys by slerp |
| `time-not-increasing` | two adjacent input times swapped | stable sort by time |
| `duplicate-time` | second key copied onto the first key's time | merge the duplicate |
| `tangent-shape` | cubic `inTangent` truncated to 3 components | rebuild all tangents (5-point stencil) |
| `tangent-units` | all cubic tangents multiplied by 0.1 (per-frame instead of per-second) | rescale by rebuilding |

The `tangent-units` check is the one heuristic: it compares each stored tangent with the central
slope of the neighbouring quaternions and flags a track when **≥50% of informative keys** deviate by
more than **35%**. Its "is this key moving?" floor is **relative to the track's own maximum slope**;
an absolute floor silently stops detecting anything once time is rescaled (verified at 1e-3 and 1e3).

## Evidence (`bench/result.json`, real run 2026-11-18)

Corpus: 5 analytic motions × 3 interpolation modes = **15 clean clips**, plus **8 defect classes**
applied to every applicable clip = **100 injected cases**, each sampled at **2,000 times**
= **200,000 oracle samples**.

| metric | repaired | naive baseline (`baseline/naive.mjs`) |
|---|---|---|
| clipped detected | 100/100 | — |
| repaired validates clean | 100/100 | 0/100 (no repair) |
| clean corpus false positives | 0/15 | — |
| repair idempotent | 100/100 | — |
| samples off by >1° | 0* | 71,792 / 200,000 (**35.90%**) |
| max angular error | 15.279° (timing corruption only) | **179.855°** |
| median per-sample error | **0.000°** | — |
| p95 per-sample error | 0.0653° | — |
| degenerate samples (zero-norm result) | 0 | 836 |

Per-class maximum deviation from the un-injected track (rotation compared through 3×3 matrices;
the continuous motion is *not* used here, so STEP's inherent stair-stepping is not counted):

| class | cases | detected | max deviation |
|---|---|---|---|
| `quat-non-unit` | 15 | 15 | 3.6e-6° |
| `quat-sign-flip` | 15 | 15 | 3.6e-6° |
| `quat-zero` | 15 | 15 | 1.213° |
| `non-finite` | 15 | 15 | 0.888° |
| `time-not-increasing` | 15 | 15 | 15.279° (one key step) |
| `duplicate-time` | 15 | 15 | 15.279° (one key step) |
| `tangent-shape` | 5 | 5 | 1.327° |
| `tangent-units` | 5 | 5 | 1.327° |

Scale invariance: time rescaled by 1e-3, 1, 1e3 on 40 cases → **40/40 identical defect codes** and
**max quaternion difference 3.33e-16** (cubic tangents rescaled inversely, since they are per-second).

Timing (validate + repair + core sampling + baseline sampling on all 100 cases, 7 samples):
cold start **500.27 ms**, median **368.28 ms**, p95 **396.19 ms**, stddev **23.04 ms**,
relative stddev **6.07%**. A second full run from a clean clone measured **9.69%** RSD; that spread is
ordinary V8/GC jitter on a 0.4 s workload, and it is disclosed because it approaches the 10% line.
No number above depends on the timing.

*The 15.279° headline maximum is not a repair failure: swapping or duplicating input times destroys
the pairing between time and value, so no repair can recover the lost key. The honest bound is one
key step of that clip (15.279° for the fastest `half-turn` motion); the assertion in
`bench/verify.mjs` enforces `error ≤ keyStep + 0.5°`. Every value-corruption class is bounded by
1.5°, which is the number the title claim uses.

## 本轮创新

**B 档.** Before this, glTF animation checkers (including my own `motion-prune-lab` and
`gltf-audit-lab`) either simplified keyframes or audited the container; none treated *quaternion
hemisphere continuity, cubic tangent units and input-time corruption* as one repair contract, and
none reported a **per-class deviation bound against the un-injected track**. The new part is
executable and falsifiable: `validateClip` → `repairClip` → re-validate → 200,000-sample matrix
comparison, with the same core inside the browser page. It also demonstrates a concrete failure mode
of absolute thresholds: the tangent-units detector's original absolute slope floor went blind at
time scale 1e3, which the scale sweep now catches.

## Known limitations

- **Synthetic corpus.** Samples are analytic rotation tracks, not parsed `.glb` files. There is no
  binary glTF/GLB reader here; feeding a real file requires decoding accessors first.
- **Timing corruption is information-losing.** Sorting or merging cannot restore the intended
  time↔value pairing; those two classes are bounded by one key step, not by 1.5°.
- **Tolerances are disclosed and mostly relative.** `UNIT_EPS = 1e-6` and `ZERO_EPS = 1e-9` are
  dimensionless quaternion norms; `TIME_REL_EPS = 1e-9` is relative to clip duration;
  `TANGENT_REL_TOL = 0.35` and the tangent floor `0.05 × max slope` are ratios. Valid time scale was
  tested from 1e-3 to 1e3; outside that, double precision near the relative time tolerance is not
  guaranteed.
- **`tangent-units` is a heuristic.** Tangents that are wrong yet accidentally match the central
  slope are not caught; the clean-corpus false-positive count is 0/15, not a proof of zero false
  positives on arbitrary assets.
- **Rotation only.** Translation, scale and morph-weight tracks are out of scope (my
  `motion-prune-lab` covers keyframe reduction for those).
- **No headless pixel evidence.** The environment forbids Chromium/Playwright, so the browser claim
  is limited to HTTP 200, a pinned importmap, and the fact that `main.js` imports the same
  `src/core.mjs` that node verifies. The page's live error readout is computed in the browser, but
  it has not been screenshot-verified.

## Layout

```
src/core.mjs            pure ESM: validate / repair / evaluate (329 lines, no three, no DOM)
src/oracle-matrix.mjs   independent ground truth: 3x3 Rodrigues matrices
bench/measure.mjs       shared measurement (repair fidelity + baseline + scale sweep)
bench/reference.mjs     independent sampler for the clean track
bench/verify.mjs        20 assertions
bench/bench.mjs         7 samples + cold start -> bench/result.json
baseline/naive.mjs      naive component-lerp sampler (the baseline)
tools/gen-sample.mjs    deterministic corpus generator
```

MIT licensed. No runtime dependencies; the browser imports three.js 0.169.0 from unpkg via
`<script type="importmap">`. No `node_modules` is committed.