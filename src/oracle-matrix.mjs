// Independent ground-truth geometry: 3x3 matrices built directly from
// Rodrigues' formula. Deliberately shares no constants or code with src/core.mjs.

export function mul3(a, b) {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    o[i*3+j] = a[i*3]*b[j] + a[i*3+1]*b[3+j] + a[i*3+2]*b[6+j];
  }
  return o;
}

export function axisAngle(axis, angle) {
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  const x = axis[0]/n, y = axis[1]/n, z = axis[2]/n;
  const c = Math.cos(angle), s = Math.sin(angle), C = 1 - c;
  return [
    c + x*x*C,     x*y*C - z*s, x*z*C + y*s,
    y*x*C + z*s,   c + y*y*C,   y*z*C - x*s,
    z*x*C - s*y,   z*y*C + x*s, c + z*z*C,
  ];
}

export const MOTIONS = [
  { name: 'spin-x',     matrix: t => axisAngle([1, 0, 0], 1.1*t + 0.35*t*t) },
  { name: 'spin-tilt',  matrix: t => axisAngle([0.3, 0.8, 0.5], 2.0*t) },
  { name: 'precess',    matrix: t => mul3(mul3(axisAngle([0,0,1], 1.3*t),
                                               axisAngle([1,0,0], 0.7 + 2.4*t)),
                                          axisAngle([0,1,0], 0.5*t)) },
  { name: 'tumble',     matrix: t => mul3(mul3(axisAngle([1,0,0], 0.9*t + 0.6),
                                               axisAngle([0,0,1], 0.8*t*t)),
                                          axisAngle([0,1,0], 1.7*t)) },
  { name: 'half-turn',  matrix: t => axisAngle([0, 1, 0], 0.4 + 3.2*t) },
];

export const MOTION_BY_NAME = Object.fromEntries(MOTIONS.map(m => [m.name, m]));