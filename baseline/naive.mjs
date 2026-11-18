// Deliberately naive glTF rotation sampler: component-wise lerp without
// hemisphere alignment or renormalization, cubic Hermite with raw tangents.
// This is the baseline the repaired sampler is compared against.

function lerp(a, b, u) { return [a[0]+(b[0]-a[0])*u, a[1]+(b[1]-a[1])*u,
                                 a[2]+(b[2]-a[2])*u, a[3]+(b[3]-a[3])*u]; }

export function naiveEvaluate(clip, t) {
  const { times, values, interpolation } = clip;
  const n = times.length;
  if (!n) return null;
  if (n === 1) return values[0].slice();
  let lo = 0;
  // A naive viewer assumes sorted input and walks forward once.
  while (lo < n - 2 && times[lo+1] <= t) lo++;
  const t0 = times[lo], t1 = times[lo+1];
  const u = t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 0;
  if (interpolation === 'STEP') return values[lo].slice();
  if (interpolation === 'LINEAR') return lerp(values[lo], values[lo+1], u);
  const v0 = values[lo], v1 = values[lo+1];
  const m0 = clip.outTangents[lo] || [0,0,0,0];
  const m1 = clip.inTangents[lo+1] || [0,0,0,0];
  const u2 = u*u, u3 = u2*u;
  const h00 = 2*u3-3*u2+1, h10 = u3-2*u2+u, h01 = -2*u3+3*u2, h11 = u3-u2;
  const out = [0,0,0,0];
  for (let c = 0; c < 4; c++) out[c] = h00*v0[c] + h10*m0[c] + h01*v1[c] + h11*m1[c];
  return out;
}