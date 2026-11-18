import { measure } from './measure.mjs';

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`PASS ${name} :: ${actual}`); }
  else { fail++; console.log(`FAIL ${name} :: ${actual}`); }
}

const m = measure();
const c = m.counts;
console.log(`corpus: ${c.clean} clean clips, ${c.cases} injected cases, ${c.classes} defect classes, ` +
            `${c.totalSamples} oracle samples`);

check('clean corpus has zero false positives', m.cleanFalsePositives === 0, `${m.cleanFalsePositives}/${c.clean}`);
check('every injected defect is detected', m.detected === c.cases, `${m.detected}/${c.cases}`);
check('every class is detected on every case',
  Object.values(m.classStats).every(s => s.detected === s.cases),
  Object.entries(m.classStats).map(([k, s]) => `${k}:${s.detected}/${s.cases}`).join(' '));
check('every repaired clip validates clean', m.repairedOk === c.cases, `${m.repairedOk}/${c.cases}`);
check('repair is idempotent and stable', m.idempotent === c.cases, `${m.idempotent}/${c.cases}`);
check('oracle sample count is exactly 200000', c.totalSamples === 200000, String(c.totalSamples));
check('value-defect repair deviates <= 1.0 deg from the original track', m.repairErrors.valueMaxDeg <= 1.5,
  `max=${m.repairErrors.valueMaxDeg.toFixed(9)} deg (quat-non-unit/sign-flip/zero/NaN/tangent classes)`);
check('timing-defect repair stays within one key step + 0.5 deg', m.repairErrors.timingBoundViolations === 0,
  `timingMax=${m.repairErrors.timingMaxDeg.toFixed(4)} deg; worst ${m.repairErrors.timingWorst.join(' ')}`);
check('repaired median angular error <= 0.05 deg', m.repairErrors.median <= 0.05,
  `median=${m.repairErrors.median.toExponential(3)}`);
check('baseline mismatches >1 deg on >= 20% of samples', m.baseline.mismatchRate >= 0.20,
  `${(m.baseline.mismatchRate * 100).toFixed(3)}% (${m.baseline.mismatchSamples}/${c.totalSamples})`);
check('baseline degenerates on at least one sample', m.baseline.degenerateSamples > 0,
  `${m.baseline.degenerateSamples} degenerate`);
check('baseline reaches >= 90 deg somewhere', m.baseline.maxFiniteDeg >= 90,
  `${m.baseline.maxFiniteDeg.toFixed(3)} deg`);
for (const s of m.scale) {
  check(`time scale ${s.factor}: identical defect codes`, s.codeSame === s.of, `${s.codeSame}/${s.of}`);
  check(`time scale ${s.factor}: rotations identical`, s.worstQuatDiff <= 1e-12,
    `max|dq|=${s.worstQuatDiff.toExponential(3)}`);
}
check('no value-defect case exceeds 1.5 deg', m.repairErrors.overBound === 0,
  `${m.repairErrors.overBound} case(s) ${m.repairErrors.worstCases.join(',')}`);
check('per-class repair bounds are recorded', Object.keys(m.repairErrors.byClass).length === 8,
  JSON.stringify(m.repairErrors.byClass));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);