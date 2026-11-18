// Independent reference sampler for the CLEAN (un-injected) track. It is used
// only to measure repair fidelity: did repair preserve the intended animation?
// No code or constants are shared with src/core.mjs.

function conj(q) { return [-q[0], -q[1], -q[2], q[3]]; }
function mul(a, b) {
  return [
    a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
    a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
    a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
    a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2],
  ];
}
function unit(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return n > 0 ? [q[0]/n, q[1]/n, q[2]/n, q[3]/n] : [0, 0, 0, 1];
}

// Rotation from q0 to q1 via the relative quaternion, not via the sine-weight
// formula used by core. Shortest arc is chosen from |w|.
function refSlerp(q0, q1, u) {
  let rel = mul(conj(q0), unit(q1));
  if (rel[3] < 0) rel = rel.map(c => -c);
  const w = Math.min(1, Math.max(-1, rel[3]));
  const angle = 2 * Math.acos(w);
  const s = Math.hypot(rel[0], rel[1], rel[2]);
  if (s < 1e-12) return unit(q0);
  const axis = [rel[0]/s, rel[1]/s, rel[2]/s];
  const ha = angle * u / 2, sh = Math.sin(ha);
  return unit(mul(q0, [axis[0]*sh, axis[1]*sh, axis[2]*sh, Math.cos(ha)]));
}

export function referenceEvaluate(clip, t) {
  const { times, values, interpolation } = clip;
  const n = times.length;
  if (t <= times[0]) return values[0].slice();
  if (t >= times[n-1]) return values[n-1].slice();
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m; else hi = m; }
  if (interpolation === 'STEP') return values[lo].slice();
  const h = times[hi] - times[lo];
  const u = h > 0 ? (t - times[lo]) / h : 0;
  if (interpolation === 'LINEAR') return refSlerp(values[lo], values[hi], u);
  const m0 = clip.outTangents[lo], m1 = clip.inTangents[hi];
  const u2 = u*u, u3 = u2*u;
  const a = 2*u3 - 3*u2 + 1, b = u3 - 2*u2 + u, c = -2*u3 + 3*u2, d = u3 - u2;
  return unit([0,1,2,3].map(k => a*values[lo][k] + b*h*m0[k] + c*values[hi][k] + d*h*m1[k]));
}