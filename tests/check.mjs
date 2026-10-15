// node tests/check.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { KEYS, angle, trunkLean, poseAngles, angle3, trunkLean3, poseAngles3, resolveMetric, checkpointValue, judge } from '../app/angles.mjs';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

near(angle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }), 90);
near(angle({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }), 180);
near(angle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }), 45);
assert.equal(angle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }), null);

near(trunkLean({ x: 5, y: 10 }, { x: 5, y: 0 }), 0);   // shoulder straight above hip
near(trunkLean({ x: 0, y: 10 }, { x: 10, y: 0 }), 45); // leaning forward 45
near(trunkLean({ x: 10, y: 10 }, { x: 0, y: 0 }), 45); // leaning the other way

// poseAngles must scale normalized coords by width/height: on 2000x1000 the knee below is 135 deg
// (unscaled normalized coords would give ~153).
const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
Object.assign(lm[24], { x: 0.5, y: 0.4 }); Object.assign(lm[26], { x: 0.5, y: 0.6 }); Object.assign(lm[28], { x: 0.6, y: 0.8 });
near(poseAngles(lm, 2000, 1000).knee_r, 135);
lm[28].visibility = 0.1;
assert.equal(poseAngles(lm, 2000, 1000).knee_r, null); // low-visibility ankle -> empty

// ---- 3D ----
near(angle3({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), 90);
near(angle3({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }), 180);
assert.equal(angle3({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), null);
near(trunkLean3({ x: 0, y: 0, z: 0 }, { x: 0, y: -0.5, z: 0 }), 0);  // y vertical (either sign)
near(trunkLean3({ x: 0, y: 0, z: 0 }, { x: 0.3, y: -0.3, z: 0 }), 45);
near(trunkLean3({ x: 0, y: 0, z: 0 }, { x: 0, y: -0.3, z: 0.3 }), 45); // depth lean counts in 3D
// world knee (right): hip above, ankle forward -> 90 deg; visibility is read from the normalized landmarks
const wl = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
Object.assign(wl[24], { x: 0, y: -0.4, z: 0 }); Object.assign(wl[26], { x: 0, y: 0, z: 0 }); Object.assign(wl[28], { x: 0, y: 0, z: 0.4 });
lm[28].visibility = 1;
near(poseAngles3(wl, lm).knee_r, 90);
lm[28].visibility = 0.1;
assert.equal(poseAngles3(wl, lm).knee_r, null); // low visibility gates 3D too
lm[28].visibility = 1;
assert.equal(poseAngles3(wl, lm).knee_l, null); // all-zero left leg: zero-length segments -> null

// ---- racket-hand aliases ----
assert.equal(resolveMetric('knee_racket', 'R'), 'knee_r');
assert.equal(resolveMetric('knee_racket', 'L'), 'knee_l');
assert.equal(resolveMetric('elbow_other', 'R'), 'elbow_l');
assert.equal(resolveMetric('hip_other', 'L'), 'hip_r');
assert.equal(resolveMetric('trunk_lean', 'L'), 'trunk_lean'); // non-alias passes through
assert.equal(checkpointValue({ metric: 'knee_racket' }, { knee_l: 10, knee_r: 20 }, 'R'), 20);
assert.equal(checkpointValue({ metric: 'knee_racket' }, { knee_l: 10, knee_r: 20 }, 'L'), 10);
assert.equal(checkpointValue({ metric: null }, { knee_l: 10 }, 'R'), null);
assert.equal(checkpointValue({ metric: 'knee_racket' }, {}, 'R'), null);

// ---- judge ----
assert.equal(judge(90, { min: 80, max: 100 }), 'pass');
assert.equal(judge(80, { min: 80, max: 100 }), 'pass'); // bounds inclusive
assert.equal(judge(79.9, { min: 80, max: 100 }), 'fail');
assert.equal(judge(101, { min: 80, max: 100 }), 'fail');
assert.equal(judge(50, { max: 60 }), 'pass');
assert.equal(judge(70, { max: 60 }), 'fail');
assert.equal(judge(90, null), 'ref');
assert.equal(judge(null, { min: 80, max: 100 }), 'na');
assert.equal(judge(null, null), 'na');

// ---- checkpoints.json ----
const cpFile = JSON.parse(readFileSync(new URL('../app/checkpoints.json', import.meta.url), 'utf8'));
assert.ok(cpFile.version && ['R', 'L'].includes(cpFile.handedness_default), 'checkpoints.json: version/handedness_default');
assert.ok(Array.isArray(cpFile.checkpoints) && cpFile.checkpoints.length > 0);
const ids = new Set();
for (const c of cpFile.checkpoints) {
  for (const k of ['id', 'group', 'name', 'type', 'metric', 'target', 'source']) assert.ok(k in c, `checkpoint ${c.id}: missing "${k}"`);
  assert.ok(!ids.has(c.id), `duplicate checkpoint id ${c.id}`); ids.add(c.id);
  assert.ok(['angle', 'visual'].includes(c.type), `${c.id}: bad type`);
  for (const k of ['channel', 'title', 'url', 'timestamp']) assert.ok(k in c.source, `${c.id}: source missing "${k}"`);
  if (c.target !== null) assert.ok(['min', 'max'].some(k => typeof c.target[k] === 'number'), `${c.id}: target needs min and/or max`);
  if (c.type === 'angle') for (const h of ['R', 'L']) assert.ok(KEYS.includes(resolveMetric(c.metric, h)), `${c.id}: unknown metric ${c.metric}`);
}

const dir = new URL('../docs/data/', import.meta.url);
const need = {
  'project.json': ['title', 'question', 'start_date', 'tournament_date', 'rule', 'youtube_playlist', 'metrics'],
  'sessions.json': ['date', 'type', 'duration_min', 'rpe', 'hr_avg', 'hr_max', 'note', 'pain', 'external_advice'],
  'metrics.json': ['date', 'metric', 'value', 'note'],
  'prescriptions.json': ['week', 'start', 'end', 'focus', 'load_cap', 'game_task', 'sessions'],
  'reports.json': ['week', 'date', 'diagnoses', 'fix_this_week', 'last_week_effect', 'ai_mistakes'],
};
const files = readdirSync(dir).filter(f => f.endsWith('.json'));
for (const f of Object.keys(need)) assert.ok(files.includes(f), `missing docs/data/${f}`);
for (const f of files) {
  const data = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  const keys = need[f];
  if (!keys) continue;
  for (const row of f === 'project.json' ? [data] : (assert.ok(Array.isArray(data), `${f} must be an array`), data))
    for (const k of keys) assert.ok(k in row, `${f}: missing key "${k}"`);
}
const project = JSON.parse(readFileSync(new URL('project.json', dir), 'utf8'));
assert.equal(project.metrics.length, 5);
for (const m of project.metrics) for (const k of ['id', 'name', 'unit', 'better']) assert.ok(k in m, `metric missing ${k}`);

console.log(`check.mjs: ok (angles 2D/3D, checkpoints, ${files.length} data files)`);
