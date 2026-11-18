// Shared measurement used by both verify.mjs (assertions) and bench.mjs (numbers).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateClip, repairClip, evaluateQuat, qToMatrix, matrixAngleDeg, fingerprint, qNorm,
} from '../src/core.mjs';
import { MOTION_BY_NAME } from '../src/oracle-matrix.mjs';
import { naiveEvaluate } from '../baseline/naive.mjs';
import { referenceEvaluate } from './reference.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DATA_PATH = resolve(HERE, '..', 'data', 'animation-cases.json');
const SAMPLE_COUNT = 2000;

function quatAsMatrix(q) {
  const n = qNorm(q);
  if (!(n > 1e-12) || !Number.isFinite(n)) return null;
  const u = [q[0]/n, q[1]/n, q[2]/n, q[3]/n];
  return qToMatrix(u);
}

function percentiles(arr) {
  const a = arr.slice().sort((x, y) => x - y);
  const at = p => a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))];
  return { min: a[0], median: at(0.5), p95: at(0.95), max: a[a.length-1] };
}

export function loadData() { return JSON.parse(readFileSync(DATA_PATH, 'utf8')); }

export function measure(data = loadData(), { samples = SAMPLE_COUNT } = {}) {
  const cleanByMotion = new Map(data.clean.map(c => [c.name, c]));
  const perCase = [];
  const classStats = {};
  const analytic = { LINEAR: [], STEP: [], CUBICSPLINE: [] };
  let detected = 0, repairedOk = 0, idempotent = 0;
  let totalSamples = 0, baselineMismatch = 0, baselineDegenerate = 0;
  const repairedErrors = [], baselineErrors = [];

  for (const c of data.cases) {
    const defects = validateClip(c);
    const expected = defects.find(d => d.code === c.defect);
    if (expected) detected++;
    classStats[c.defect] = classStats[c.defect] || { cases: 0, detected: 0, maxErrDeg: 0 };
    classStats[c.defect].cases++;
    if (expected) classStats[c.defect].detected++;

    const { clip: r } = repairClip(c);
    const after = validateClip(r);
    if (after.length === 0) repairedOk++;
    const { clip: rr } = repairClip(r);
    if (fingerprint(r) === fingerprint(rr) && validateClip(rr).length === 0) idempotent++;

    const clean = cleanByMotion.get(`${c.motion}/${c.interpolation}`);
    let maxErr = 0, sumErr = 0, bMismatch = 0, bDegenerate = 0, bMaxFinite = 0;
    for (let i = 0; i < samples; i++) {
      const t = (data.duration * i) / (samples - 1);
      // Repair fidelity: compare against the un-injected track, not against the
      // continuous motion (which would count STEP's inherent stair-stepping).
      const ref = referenceEvaluate(clean, t);
      const truth = quatAsMatrix(ref);
      const q = evaluateQuat(r, t);
      const R = q ? quatAsMatrix(q) : null;
      const err = R ? matrixAngleDeg(R, truth) : 180;
      if (!Number.isFinite(err)) throw new Error(`non-finite repair error on ${c.name} at t=${t}`);
      maxErr = Math.max(maxErr, err); sumErr += err;
      repairedErrors.push(err);

      const bq = naiveEvaluate(c, t);
      const B = bq ? quatAsMatrix(bq) : null;
      if (!B) { bMismatch++; bDegenerate++; baselineMismatch++; baselineDegenerate++; }
      else {
        const be = matrixAngleDeg(B, truth);
        if (Number.isFinite(be)) { bMaxFinite = Math.max(bMaxFinite, be); }
        if (!Number.isFinite(be) || be > 1) { bMismatch++; baselineMismatch++; }
      }
      totalSamples++;
    }
    let keyStep = 0;
    for (let i = 1; i < clean.values.length; i++)
      keyStep = Math.max(keyStep, matrixAngleDeg(quatAsMatrix(clean.values[i-1]), quatAsMatrix(clean.values[i])));
    classStats[c.defect].maxErrDeg = Math.max(classStats[c.defect].maxErrDeg, maxErr);
    perCase.push({ name: c.name, defect: c.defect, maxErr, meanErr: sumErr / samples, keyStepDeg: keyStep,
                   baselineMismatch: bMismatch, baselineDegenerate: bDegenerate,
                   baselineMaxFiniteDeg: bMaxFinite });
    if (bMaxFinite > 0) baselineErrors.push(bMaxFinite);
  }

  const timingClasses = new Set(['time-not-increasing', 'duplicate-time']);
  const valueCases = perCase.filter(p => !timingClasses.has(p.defect));
  const timingCases = perCase.filter(p => timingClasses.has(p.defect));
  const valueMax = Math.max(...valueCases.map(p => p.maxErr));
  const timingMax = Math.max(...timingCases.map(p => p.maxErr));
  const timingViolations = timingCases.filter(p => p.maxErr > p.keyStepDeg + 0.5);
  const VALUE_BOUND = 1.5;
  const bad = valueCases.filter(p => p.maxErr > VALUE_BOUND).map(p => `${p.name}:${p.maxErr.toFixed(4)}`);
  const rep = percentiles(repairedErrors);

  // Scale invariance: time is the only dimension with units; scaling it must not
  // change defect classification or the sampled rotation.
  const scaleReport = [];
  for (const factor of [1e-3, 1, 1e3]) {
    let codeSame = 0, worst = 0;
    for (const c of data.cases.slice(0, 40)) {
      const scaled = structuredClone(c);
      scaled.times = scaled.times.map(t => t * factor);
      scaled.duration = c.duration * factor;
      // Tangents are per second: when input time is rescaled the tangents must
      // scale inversely or the cubic curve (and the defect) genuinely changes.
      if (scaled.inTangents) scaled.inTangents = scaled.inTangents.map(a => a.map(v => v / factor));
      if (scaled.outTangents) scaled.outTangents = scaled.outTangents.map(a => a.map(v => v / factor));
      const baseCodes = validateClip(c).map(d => d.code).sort().join(',');
      const scaledCodes = validateClip(scaled).map(d => d.code).sort().join(',');
      if (baseCodes === scaledCodes) codeSame++;
      const { clip: r } = repairClip(c);
      const { clip: rs } = repairClip(scaled);
      for (let i = 0; i <= 20; i++) {
        const t = (c.duration * i) / 20;
        const a = evaluateQuat(r, t), b = evaluateQuat(rs, t * factor);
        if (!a || !b) { worst = Infinity; continue; }
        const d = Math.min(
          Math.max(...a.map((v, k) => Math.abs(v - b[k]))),
          Math.max(...a.map((v, k) => Math.abs(v + b[k]))));
        worst = Math.max(worst, d);
      }
    }
    scaleReport.push({ factor, codeSame, of: 40, worstQuatDiff: worst });
  }

  // Separate, report-only: how far the CLEAN track is from the continuous
  // analytic motion under each interpolation mode (discretization, not repair).
  for (const clean of data.clean) {
    const motion = MOTION_BY_NAME[clean.name.split('/')[0]];
    let mx = 0;
    for (let i = 0; i <= 500; i++) {
      const t = (data.duration * i) / 500;
      mx = Math.max(mx, matrixAngleDeg(quatAsMatrix(referenceEvaluate(clean, t)), motion.matrix(t)));
    }
    analytic[clean.interpolation].push(mx);
  }
  const analyticSummary = {};
  for (const [mode, vals] of Object.entries(analytic)) {
    const ps = percentiles(vals);
    analyticSummary[mode] = { medianCleanMaxDeg: ps.median, worstCleanMaxDeg: ps.max, clips: vals.length };
  }

  return {
    counts: { clean: data.clean.length, cases: data.cases.length,
              classes: Object.keys(classStats).length, samples, totalSamples },
    cleanFalsePositives: data.clean.filter(c => validateClip(c).length > 0).length,
    detected, repairedOk, idempotent,
    classStats,
    repairErrors: { ...rep, valueBoundDeg: VALUE_BOUND, overBound: bad.length, worstCases: bad.slice(0, 5),
      valueMaxDeg: valueMax, timingMaxDeg: timingMax,
      timingBoundViolations: timingViolations.length,
      timingWorst: timingCases.sort((a,b)=>b.maxErr-a.maxErr).slice(0,3).map(p=>`${p.name}:${p.maxErr.toFixed(3)}<=${p.keyStepDeg.toFixed(3)}`),
      byClass: Object.fromEntries(Object.entries(classStats).map(([k,v]) => [k, v.maxErrDeg])) },
    baseline: { mismatchSamples: baselineMismatch, degenerateSamples: baselineDegenerate,
                mismatchRate: baselineMismatch / totalSamples,
                maxFiniteDeg: Math.max(...baselineErrors, 0),
                medianCaseMaxDeg: percentiles(baselineErrors).median },
    scale: scaleReport,
    analytic: analyticSummary,
    perCase,
  };
}