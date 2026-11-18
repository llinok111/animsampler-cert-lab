// Rendering and interaction only. Every number below comes from src/core.mjs,
// the same module bench/verify.mjs exercises in node.
import * as THREE from 'three';
import { validateClip, repairClip, evaluateQuat, qToMatrix, matrixAngleDeg } from './src/core.mjs';
import { referenceEvaluate } from './bench/reference.mjs';
import { naiveEvaluate } from './baseline/naive.mjs';

const el = id => document.getElementById(id);
const data = await (await fetch('./data/animation-cases.json')).json();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.querySelector('main').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 100);
camera.position.set(3.2, 2.1, 4.2);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x1a2233, 1.4));
const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(3, 5, 4); scene.add(key);

const geo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
const repairedMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x4cc2ff, metalness: 0.2, roughness: 0.35 }));
const baselineMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff9e64, wireframe: true }));
scene.add(repairedMesh, baselineMesh);
const axes = new THREE.AxesHelper(1.3); scene.add(axes);

let current = null, repaired = null, clean = null;

function apply(obj, q) {
  if (!q) { obj.visible = false; return; }
  obj.visible = true;
  const R = qToMatrix(q);
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(
    R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1));
}

function tick() {
  requestAnimationFrame(tick);
  if (current) {
    const t = Number(el('time').value);
    el('timeval').textContent = t.toFixed(3);
    const q = evaluateQuat(repaired, t);
    apply(repairedMesh, q);
    apply(baselineMesh, naiveEvaluate(current, t));
    const ref = referenceEvaluate(clean, t);
    const err = q ? matrixAngleDeg(qToMatrix(q), qToMatrix(ref)) : 180;
    el('err').textContent = err.toFixed(4) + '°';
    el('err').className = 'metric ' + (err < 1.5 ? 'ok' : 'bad');
    const bq = naiveEvaluate(current, t);
    if (!bq || bq.every(v => v === 0)) { el('berr').textContent = 'degenerate'; el('berr').className = 'metric bad'; }
    else {
      const n = Math.hypot(bq[0], bq[1], bq[2], bq[3]);
      const bu = n > 0 ? bq.map(v => v / n) : bq;
      const be = matrixAngleDeg(qToMatrix(bu), qToMatrix(ref));
      el('berr').textContent = be.toFixed(2) + '°';
      el('berr').className = 'metric ' + (be > 1 ? 'bad' : 'ok');
    }
  }
  renderer.render(scene, camera);
}

function selectCase(name) {
  current = data.cases.find(c => c.name === name);
  clean = data.clean.find(c => c.name === `${current.motion}/${current.interpolation}`);
  const res = repairClip(current);
  repaired = res.clip;
  el('defects').textContent = validateClip(current).map(d => `${d.code} @${d.index}`).join('\n') || 'none';
  el('actions').textContent = res.actions.join('\n');
  el('status').textContent = `${current.name} · ${current.interpolation} · repaired validates: ` +
    (validateClip(repaired).length === 0 ? 'yes' : 'NO');
  el('time').value = '0';
}

for (const c of data.cases) {
  const o = document.createElement('option');
  o.value = c.name; o.textContent = c.name;
  el('case').appendChild(o);
}
el('case').addEventListener('change', e => selectCase(e.target.value));
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
selectCase(data.cases[0].name);
tick();