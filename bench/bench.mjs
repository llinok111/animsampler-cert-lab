import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measure } from './measure.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLES = 7;
const runs = [];

// Cold start: first call includes module data load and JIT warmup.
const t0 = process.hrtime.bigint();
const cold = measure();
const coldMs = Number(process.hrtime.bigint() - t0) / 1e6;

for (let i = 0; i < SAMPLES; i++) {
  const s = process.hrtime.bigint();
  measure();
  runs.push(Number(process.hrtime.bigint() - s) / 1e6);
}

const sorted = runs.slice().sort((a, b) => a - b);
const mean = runs.reduce((a, b) => a + b, 0) / runs.length;
const stddev = Math.sqrt(runs.reduce((a, b) => a + (b - mean) ** 2, 0) / runs.length);
const at = p => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
const timing = {
  coldStartMs: coldMs, min: sorted[0], median: at(0.5), p95: at(0.95), max: sorted[sorted.length-1],
  mean, stddev, rsd: stddev / mean, samples: SAMPLES,
};

const c = cold.counts;
const result = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  corpus: { cleanClips: c.clean, injectedCases: c.cases, defectClasses: c.classes,
            oracleSamplesPerCase: c.samples, totalOracleSamples: c.totalSamples },
  defects: { detected: cold.detected, repairedValid: cold.repairedOk, idempotent: cold.idempotent,
             cleanFalsePositives: cold.cleanFalsePositives, perClass: cold.classStats },
  oracle: { implementation: 'independent 3x3 Rodrigues matrices (src/oracle-matrix.mjs)',
            repairedMaxDeg: cold.repairErrors.max, repairedMedianDeg: cold.repairErrors.median,
            repairedP95Deg: cold.repairErrors.p95, casesOverHalfDeg: cold.repairErrors.overHalfDeg },
  baseline: { implementation: 'baseline/naive.mjs component-lerp, no sign fix, raw tangents',
              mismatchRate: cold.baseline.mismatchRate, mismatchSamples: cold.baseline.mismatchSamples,
              degenerateSamples: cold.baseline.degenerateSamples,
              maxFiniteDeg: cold.baseline.maxFiniteDeg,
              medianCaseMaxDeg: cold.baseline.medianCaseMaxDeg },
  scaleInvariance: cold.scale,
  timing,
  note: 'Timing covers validate+repair+oracle-vs-core+baseline sampling on every case.',
};
writeFileSync(resolve(HERE, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ oracle: result.oracle, baseline: result.baseline,
  defects: { detected: result.defects.detected, repaired: result.defects.repairedValid },
  timing }, null, 2));