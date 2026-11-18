// Deterministic sample generator: one JSON with 15 clean clips and 100 injected
// defect cases. Independent of src/core.mjs (has its own matrix -> quaternion code).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOTIONS } from '../src/oracle-matrix.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] || resolve(HERE, '..', 'data', 'animation-cases.json'));

const DURATION = 2.0;
const KEYS = 25;
const SEED = 0x5eeda11;

function lcg(state) { let s = state >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }

function matrixToQuat(m) {
  const tr = m[0] + m[4] + m[8];
  let x, y, z, w;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = s / 4; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    w = (m[7] - m[5]) / s; x = s / 4; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = s / 4; z = (m[5] + m[7]) / s;
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = s / 4;
  }
  const n = Math.hypot(x, y, z, w);
  return [x/n, y/n, z/n, w/n];
}

function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3]; }

function cleanClip(motion, mode) {
  const times = [], values = [];
  for (let i = 0; i < KEYS; i++) {
    const t = DURATION * i / (KEYS - 1);
    times.push(t);
    values.push(matrixToQuat(motion.matrix(t)));
  }
  // Hemisphere-align keys before finite-differencing tangents.
  for (let i = 1; i < values.length; i++) if (dot(values[i-1], values[i]) < 0)
    values[i] = values[i].map(c => -c);
  let inTangents = null, outTangents = null;
  if (mode === 'CUBICSPLINE') {
    const h = 1e-6;
    inTangents = []; outTangents = [];
    for (let i = 0; i < KEYS; i++) {
      const t = times[i];
      let qp = matrixToQuat(motion.matrix(Math.min(DURATION, t + h)));
      let qm = matrixToQuat(motion.matrix(Math.max(0, t - h)));
      // Align the SAMPLED quaternions (q and -q are the same rotation) before
      // differencing; aligning the derivative afterwards is meaningless.
      if (dot(qp, values[i]) < 0) qp = qp.map(c => -c);
      if (dot(qm, values[i]) < 0) qm = qm.map(c => -c);
      const d = [(qp[0]-qm[0])/(2*h), (qp[1]-qm[1])/(2*h), (qp[2]-qm[2])/(2*h), (qp[3]-qm[3])/(2*h)];
      inTangents.push(d); outTangents.push(d.slice());
    }
  }
  return { name: `${motion.name}/${mode}`, duration: DURATION, interpolation: mode,
           times, values, inTangents, outTangents };
}

const CLASSES = ['quat-non-unit', 'quat-sign-flip', 'quat-zero', 'non-finite',
                 'time-not-increasing', 'duplicate-time', 'tangent-shape', 'tangent-units'];

function inject(clip, cls, key, rand) {
  const c = structuredClone(clip);
  switch (cls) {
    case 'quat-non-unit': c.values[key] = c.values[key].map(v => v * 1.2); break;
    case 'quat-sign-flip': c.values[key] = c.values[key].map(v => -v); break;
    case 'quat-zero': c.values[key] = [0, 0, 0, 0]; break;
    case 'non-finite': c.values[key][2] = NaN; break;
    case 'time-not-increasing': {
      const a = key, b = key + 1;
      const t = c.times[a]; c.times[a] = c.times[b]; c.times[b] = t;
      break;
    }
    case 'duplicate-time': c.times[key+1] = c.times[key]; c.values[key+1] = c.values[key].slice(); break;
    case 'tangent-shape': c.inTangents[KEYS-1] = c.inTangents[KEYS-1].slice(0, 3); break;
    case 'tangent-units': for (let i = 0; i < KEYS; i++) {
      c.inTangents[i] = c.inTangents[i].map(v => v * 0.1);
      c.outTangents[i] = c.outTangents[i].map(v => v * 0.1);
    } break;
    default: throw new Error('unknown class ' + cls);
  }
  return c;
}

const rand = lcg(SEED);
const clean = [], cases = [];
let id = 0;
for (const motion of MOTIONS) {
  for (const mode of ['LINEAR', 'STEP', 'CUBICSPLINE']) {
    const base = cleanClip(motion, mode);
    clean.push(base);
    for (const cls of CLASSES) {
      if (cls.startsWith('tangent-') && mode !== 'CUBICSPLINE') continue;
      const key = 4 + Math.floor(rand() * (KEYS - 9));
      const c = inject(base, cls, key, rand);
      c.name = `${motion.name}/${mode}/${cls}#${id}`;
      c.motion = motion.name;
      c.defect = cls;
      cases.push(c);
      id++;
    }
  }
}

const payload = {
  generator: 'tools/gen-sample.mjs', seed: SEED, duration: DURATION, keys: KEYS,
  cleanCount: clean.length, caseCount: cases.length, clean, cases,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 1) + '\n');
console.log(`wrote ${OUT}: ${clean.length} clean, ${cases.length} injected cases`);