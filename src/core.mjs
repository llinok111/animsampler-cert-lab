// Pure glTF rotation-track core: no three, no DOM, no I/O.
// Tolerances are relative or dimensionless, so behavior is scale-invariant in time.
const UNIT_EPS = 1e-6;      // |q|-1, dimensionless
const ZERO_EPS = 1e-9;      // ||q|| below this = degenerate key
const TIME_REL_EPS = 1e-9;  // times compared relative to track duration
const TANGENT_REL_TOL = 0.35;
const TANGENT_MIN_SLOPE = 0.05; // relative floor: fraction of the track's max slope

export const TOLERANCES = { UNIT_EPS, ZERO_EPS, TIME_REL_EPS, TANGENT_REL_TOL };

export function qDot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3]; }
export function qNorm(a) { return Math.hypot(a[0], a[1], a[2], a[3]); }
export function qScale(a, s) { return [a[0]*s, a[1]*s, a[2]*s, a[3]*s]; }
export function qNeg(a) { return [-a[0], -a[1], -a[2], -a[3]]; }

export function qNormalize(a) {
  const n = qNorm(a);
  if (!(n > ZERO_EPS) || !Number.isFinite(n)) return null;
  return [a[0]/n, a[1]/n, a[2]/n, a[3]/n];
}

// Spherical interpolation with hemisphere alignment. This is the only place
// the core decides a quaternion's sign, and it always picks dot >= 0.
export function qSlerp(a, b, u) {
  let d = qDot(a, b);
  let bb = b;
  if (d < 0) { d = -d; bb = qNeg(b); }
  if (d > 0.9995) {
    const r = [a[0] + (bb[0]-a[0])*u, a[1] + (bb[1]-a[1])*u,
               a[2] + (bb[2]-a[2])*u, a[3] + (bb[3]-a[3])*u];
    return qNormalize(r);
  }
  const th = Math.acos(Math.min(1, d));
  const s = Math.sin(th);
  const w0 = Math.sin((1-u)*th)/s, w1 = Math.sin(u*th)/s;
  return qNormalize([a[0]*w0+bb[0]*w1, a[1]*w0+bb[1]*w1,
                     a[2]*w0+bb[2]*w1, a[3]*w0+bb[3]*w1]);
}

export function qToMatrix(q) {
  const [x, y, z, w] = q;
  return [
    1-2*(y*y+z*z), 2*(x*y-z*w),   2*(x*z+y*w),
    2*(x*y+z*w),   1-2*(x*x+z*z), 2*(y*z-x*w),
    2*(x*z-y*w),   2*(y*z+x*w),   1-2*(x*x+y*y),
  ];
}

export function matrixAngleDeg(a, b) {
  let tr = 0;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) tr += a[i*3+j] * b[i*3+j];
  const c = Math.max(-1, Math.min(1, (tr - 1) / 2));
  return Math.acos(c) * 180 / Math.PI;
}

function timeEps(duration) { return TIME_REL_EPS * Math.max(1e-12, Math.abs(duration)); }

function neighborRepair(times, values, bad) {
  const n = times.length;
  const out = values.map(v => (v && Number.isFinite(qNorm(v)) ? v.slice() : null));
  for (const k of bad) {
    let lo = k - 1, hi = k + 1;
    while (lo >= 0 && !out[lo]) lo--;
    while (hi < n && !out[hi]) hi++;
    if (lo >= 0 && hi < n && times[hi] > times[lo]) {
      const u = (times[k] - times[lo]) / (times[hi] - times[lo]);
      out[k] = qSlerp(out[lo], out[hi], Math.max(0, Math.min(1, u)));
    } else if (lo >= 0) out[k] = out[lo].slice();
    else if (hi < n) out[k] = out[hi].slice();
    else out[k] = [0, 0, 0, 1];
  }
  return out;
}

// Detect defects. Returns [{code, index, detail}] in a stable order.
export function validateClip(clip) {
  const defects = [];
  const { times, values, interpolation } = clip;
  const duration = clip.duration;
  const te = timeEps(duration);
  if (!Array.isArray(times) || !Array.isArray(values) || times.length !== values.length) {
    defects.push({ code: 'shape-mismatch', index: -1, detail: 'times/values length differ' });
    return defects;
  }
  if (times.length < 2) defects.push({ code: 'track-too-short', index: 0, detail: `keys=${times.length}` });

  for (let i = 0; i < times.length; i++) {
    if (!Number.isFinite(times[i]) || !values[i] || values[i].length !== 4 ||
        values[i].some(c => !Number.isFinite(c))) {
      defects.push({ code: 'non-finite', index: i, detail: 'time or quaternion component is not finite' });
      continue;
    }
    const n = qNorm(values[i]);
    if (n < ZERO_EPS) defects.push({ code: 'quat-zero', index: i, detail: `norm=${n.toExponential(2)}` });
    else if (Math.abs(n - 1) > UNIT_EPS)
      defects.push({ code: 'quat-non-unit', index: i, detail: `norm=${n.toFixed(9)}` });
  }

  // Duplicate / non-increasing times (skip indices already non-finite).
  for (let i = 1; i < times.length; i++) {
    if (!Number.isFinite(times[i]) || !Number.isFinite(times[i-1])) continue;
    const dt = times[i] - times[i-1];
    if (Math.abs(dt) <= te) defects.push({ code: 'duplicate-time', index: i, detail: `dt=${dt}` });
    else if (dt < 0) defects.push({ code: 'time-not-increasing', index: i, detail: `dt=${dt.toFixed(6)}` });
  }

  if (times.length && Number.isFinite(times[0]) && times[0] < -te)
    defects.push({ code: 'time-not-increasing', index: 0, detail: `t0=${times[0]}` });

  // Sign discontinuity: q and -q are the same rotation but opposite hemispheres;
  // blending without alignment walks the long way.
  if (values.length > 1) {
    for (let i = 1; i < values.length; i++) {
      const a = values[i-1], b = values[i];
      if (!a || !b || a.some(c => !Number.isFinite(c)) || b.some(c => !Number.isFinite(c))) continue;
      if (qDot(a, b) < 0) defects.push({ code: 'quat-sign-flip', index: i, detail: `dot=${qDot(a,b).toFixed(6)}` });
    }
  }

  if (interpolation === 'CUBICSPLINE') {
    const okVec = (arr) => Array.isArray(arr) && arr.every(v =>
      Array.isArray(v) && v.length === 4 && v.every(c => Number.isFinite(c)));
    const okShape = okVec(clip.inTangents) && okVec(clip.outTangents) &&
      clip.inTangents.length === values.length && clip.outTangents.length === values.length;
    if (!okShape) {
      defects.push({ code: 'tangent-shape', index: -1, detail: 'cubic spline tangents do not match key count' });
    } else {
      // glTF tangents are per second. Estimate the central slope and flag a
      // track whose tangents are consistently too small by the key spacing.
      const aligned = values.map(v => (v ? v.slice() : null));
      for (let i = 1; i < aligned.length; i++) {
        if (aligned[i] && aligned[i-1] && qDot(aligned[i-1], aligned[i]) < 0) aligned[i] = qNeg(aligned[i]);
      }
      // Slope magnitudes have units of 1/second, so the "is this key moving?"
      // floor must be relative to this track's own maximum slope. An absolute
      // floor would make the detector blind when time is rescaled.
      const rows = [];
      let maxSlope = 0;
      for (let i = 1; i < times.length - 1; i++) {
        const h = times[i+1] - times[i-1];
        if (!(h > 0)) continue;
        const m = clip.outTangents[i];
        const v0 = aligned[i-1], v1 = aligned[i+1];
        if (!m || !v0 || !v1) continue;
        let slope = 0, mag = 0;
        for (let c = 0; c < 4; c++) {
          const sl = (v1[c] - v0[c]) / h;
          slope += sl*sl; mag += m[c]*m[c];
        }
        const sm = Math.sqrt(slope);
        rows.push({ sm, mag: Math.sqrt(mag) });
        if (sm > maxSlope) maxSlope = sm;
      }
      const floor = TANGENT_MIN_SLOPE * maxSlope;
      let informative = 0, off = 0;
      for (const row of rows) {
        if (row.sm < floor || row.sm === 0) continue;
        informative++;
        if (Math.abs(row.mag - row.sm) / row.sm > TANGENT_REL_TOL) off++;
      }
      if (informative >= 3 && off / informative >= 0.5)
        defects.push({ code: 'tangent-units', index: -1, detail: `off=${off}/${informative}` });
    }
  }
  return defects;
}

function rebuildTangents(times, values) {
  const n = values.length;
  const inT = new Array(n), outT = new Array(n);
  const at = (i, c) => values[i][c];
  for (let i = 0; i < n; i++) {
    let d = [0, 0, 0, 0];
    if (n >= 5 && i === 0) {
      const h = times[1] - times[0];
      if (h > 0) d = [0,1,2,3].map(c => (-25*at(0,c) + 48*at(1,c) - 36*at(2,c) + 16*at(3,c) - 3*at(4,c)) / (12*h));
    } else if (n >= 5 && i === 1) {
      const h = times[1] - times[0];
      if (h > 0) d = [0,1,2,3].map(c => (-3*at(0,c) - 10*at(1,c) + 18*at(2,c) - 6*at(3,c) + at(4,c)) / (12*h));
    } else if (n >= 5 && i === n-1) {
      const h = times[n-1] - times[n-2];
      if (h > 0) d = [0,1,2,3].map(c => (25*at(n-1,c) - 48*at(n-2,c) + 36*at(n-3,c) - 16*at(n-4,c) + 3*at(n-5,c)) / (12*h));
    } else if (n >= 5 && i === n-2) {
      const h = times[n-1] - times[n-2];
      if (h > 0) d = [0,1,2,3].map(c => (3*at(n-1,c) + 10*at(n-2,c) - 18*at(n-3,c) + 6*at(n-4,c) - at(n-5,c)) / (12*h));
    } else if (n >= 5) {
      const h = (times[i+1] - times[i-1]) / 2;
      if (h > 0) d = [0,1,2,3].map(c => (-at(i+2,c) + 8*at(i+1,c) - 8*at(i-1,c) + at(i-2,c)) / (12*h));
    } else {
      let a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      const h = times[b] - times[a];
      if (h > 0) d = [0,1,2,3].map(c => (values[b][c] - values[a][c]) / h);
    }
    inT[i] = d.slice(); outT[i] = d.slice();
  }
  return { inTangents: inT, outTangents: outT };
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function fingerprint(clip) {
  const q = 1e9;
  const t = clip.times.map(v => Math.round(v * q));
  const v = clip.values.map(a => a.map(c => Math.round(c * q)));
  return fnv1a(JSON.stringify([clip.duration, t, v, clip.interpolation,
    clip.inTangents ? clip.inTangents.map(a => a.map(c => Math.round(c*q))) : null]));
}

// Repair returns a new clip plus a human-readable action ledger.
export function repairClip(clip) {
  const actions = [];
  const te = timeEps(clip.duration);
  const mode = clip.interpolation;
  let times = clip.times.slice();
  let values = clip.values.map(v => (v ? v.slice() : null));

  const bad = [];
  for (let i = 0; i < times.length; i++) {
    if (!Number.isFinite(times[i]) || !values[i] || values[i].length !== 4 ||
        values[i].some(c => !Number.isFinite(c)) || qNorm(values[i]) < ZERO_EPS) bad.push(i);
  }
  if (bad.length) { values = neighborRepair(times, values, bad); actions.push(`rebuilt ${bad.length} degenerate/NaN key(s) from neighbours`); }

  // Drop keys whose time is not finite, then sort stable by time.
  const idx = times.map((t, i) => i).filter(i => Number.isFinite(times[i]));
  if (idx.length !== times.length) actions.push(`dropped ${times.length - idx.length} non-finite time key(s)`);
  idx.sort((a, b) => times[a] - times[b] || a - b);
  let ts = idx.map(i => times[i]), vs = idx.map(i => values[i]);
  if (ts.length < 2) {
    const q = vs[0] || [0,0,0,1];
    ts = [0, Math.max(clip.duration, 1)]; vs = [q, q];
    actions.push('expanded a short track to two constant keys');
  }

  // Merge duplicate times (keep the first value) after sorting.
  const keptT = [ts[0]], keptV = [vs[0]];
  for (let i = 1; i < ts.length; i++) {
    if (Math.abs(ts[i] - keptT[keptT.length-1]) <= te) { actions.push(`merged duplicate time at ${ts[i]}`); continue; }
    keptT.push(ts[i]); keptV.push(vs[i]);
  }
  ts = keptT; vs = keptV;
  if (ts[0] < 0) { ts = ts.map(t => Math.max(0, t)); actions.push('clamped negative times to zero'); }
  // Collapse keys that became duplicates after clamping.
  const ct = [ts[0]], cv = [vs[0]];
  for (let i = 1; i < ts.length; i++) {
    if (Math.abs(ts[i] - ct[ct.length-1]) <= te) continue;
    ct.push(ts[i]); cv.push(vs[i]);
  }
  ts = ct; vs = cv;

  vs = vs.map(v => qNormalize(v) || [0,0,0,1]);
  actions.push('normalized quaternions');

  // Hemisphere continuity for every mode; STEP still needs it for blending.
  for (let i = 1; i < vs.length; i++) {
    if (qDot(vs[i-1], vs[i]) < 0) { vs[i] = qNeg(vs[i]); actions.push(`flipped sign at key ${i}`); }
  }

  let inT = clip.inTangents ? clip.inTangents.map(a => (a ? a.slice() : null)) : null;
  let outT = clip.outTangents ? clip.outTangents.map(a => (a ? a.slice() : null)) : null;
  if (mode === 'CUBICSPLINE') {
    const shapeOk = inT && outT && inT.length === vs.length && outT.length === vs.length &&
      inT.every(a => a && a.length === 4 && a.every(Number.isFinite)) &&
      outT.every(a => a && a.length === 4 && a.every(c => Number.isFinite(c)));
    if (!shapeOk) {
      const rb = rebuildTangents(ts, vs);
      inT = rb.inTangents; outT = rb.outTangents;
      actions.push('rebuilt cubic tangents from central differences');
    }
  } else { inT = null; outT = null; }

  const repaired = {
    name: clip.name, duration: clip.duration, interpolation: mode,
    times: ts, values: vs, inTangents: inT, outTangents: outT,
  };
  // Re-check tangent units on the repaired track and rebuild once if needed.
  if (mode === 'CUBICSPLINE') {
    const again = validateClip(repaired).filter(d => d.code === 'tangent-units');
    if (again.length) {
      const rb = rebuildTangents(ts, vs);
      repaired.inTangents = rb.inTangents; repaired.outTangents = rb.outTangents;
      actions.push('rescaled cubic tangents to per-second units');
    }
  }
  if (ts.length && ts[ts.length-1] < clip.duration - te) {
    const last = vs[vs.length-1];
    repaired.times = ts.concat([clip.duration]);
    repaired.values = vs.concat([last.slice()]);
    if (mode === 'CUBICSPLINE') {
      repaired.inTangents = inT.concat([[0,0,0,0]]);
      repaired.outTangents = outT.concat([[0,0,0,0]]);
    }
    actions.push('appended a constant key at the declared duration');
  }
  return { clip: repaired, actions };
}

// Evaluate a *valid* rotation track at time t. Clamps outside the input range.
export function evaluateQuat(clip, t) {
  const { times, values, interpolation } = clip;
  const n = times.length;
  if (!(n > 0) || !Number.isFinite(t)) return null;
  if (n === 1) return values[0].slice();
  if (t <= times[0]) return values[0].slice();
  if (t >= times[n-1]) return values[n-1].slice();
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
  const t0 = times[lo], t1 = times[hi];
  const h = t1 - t0;
  const u = h > 0 ? (t - t0) / h : 0;
  if (interpolation === 'STEP') return values[lo].slice();
  if (interpolation === 'LINEAR') return qSlerp(values[lo], values[hi], u);
  const v0 = values[lo], v1 = values[hi];
  const m0 = (clip.outTangents && clip.outTangents[lo]) || [0,0,0,0];
  const m1 = (clip.inTangents && clip.inTangents[hi]) || [0,0,0,0];
  const u2 = u*u, u3 = u2*u;
  const h00 = 2*u3 - 3*u2 + 1, h10 = u3 - 2*u2 + u;
  const h01 = -2*u3 + 3*u2, h11 = u3 - u2;
  const out = [0,0,0,0];
  for (let c = 0; c < 4; c++) out[c] = h00*v0[c] + h10*h*m0[c] + h01*v1[c] + h11*h*m1[c];
  return qNormalize(out) || v0.slice();
}