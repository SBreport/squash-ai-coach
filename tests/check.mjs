// node tests/check.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { KEYS, angle, trunkLean, poseAngles, angle3, trunkLean3, poseAngles3, stanceRatio, frontSide, resolveMetric, checkpointValue, judge,
  detectEvents, medianSmooth, signalValue, fpsFromDeltas, strideFor } from '../app/angles.mjs';

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

// ---- front/back leg + stance ratio ----
assert.equal(resolveMetric('knee_front', 'R', 'l'), 'knee_l');
assert.equal(resolveMetric('knee_back', 'R', 'l'), 'knee_r');
assert.equal(resolveMetric('hip_front', 'L', 'r'), 'hip_r');
assert.equal(resolveMetric('hip_back', 'L', 'r'), 'hip_l');
assert.equal(resolveMetric('knee_front', 'R', null), null); // cannot tell -> not measurable
assert.equal(checkpointValue({ metric: 'knee_front' }, { knee_l: 10, knee_r: 20, front: 'l' }, 'R'), 10);
assert.equal(checkpointValue({ metric: 'knee_back' }, { knee_l: 10, knee_r: 20, front: 'l' }, 'R'), 20);
assert.equal(checkpointValue({ metric: 'knee_front' }, { knee_l: 10, knee_r: 20, front: null }, 'R'), null);
// legs 0.4 long (hip y .4, knee .6, ankle .8); 1000x1000 so pixels = normalized * 1000
const fl = (yL, yR) => { const m = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  Object.assign(m[23], { x: 0.45, y: 0.4 }); Object.assign(m[24], { x: 0.55, y: 0.4 });
  Object.assign(m[25], { x: 0.45, y: 0.6 }); Object.assign(m[26], { x: 0.55, y: 0.6 });
  Object.assign(m[27], { x: 0.4, y: yL }); Object.assign(m[28], { x: 0.6, y: yR }); return m; };
assert.equal(frontSide(fl(0.7, 0.8), 1000, 1000), 'l');  // left ankle higher in image = farther = front
assert.equal(frontSide(fl(0.8, 0.7), 1000, 1000), 'r');
assert.equal(frontSide(fl(0.8, 0.81), 1000, 1000), null); // gap 10px < 5% of ~400px leg length
assert.equal(frontSide(fl(0.8, 0.7).map((q, i) => i === 27 ? { ...q, visibility: 0.1 } : q), 1000, 1000), null);
near(stanceRatio({ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 0, y: 0 }, { x: 30, y: 0 }), 2);
near(stanceRatio({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0.6 }, { x: 0, y: 0, z: 0 }, { x: 0.3, y: 0, z: 0 }), 2);
assert.equal(stanceRatio({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }), null);
// 2D must scale by w/h: ankles .1 apart in x, hips .05 apart in x on 2000x1000 -> still 2
const sl = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
Object.assign(sl[23], { x: 0.475 }); Object.assign(sl[24], { x: 0.525 }); Object.assign(sl[27], { x: 0.45 }); Object.assign(sl[28], { x: 0.55 });
near(poseAngles(sl, 2000, 1000).stance_ratio, 2);
assert.ok(KEYS.includes('stance_ratio'));

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
  if (c.type === 'angle') for (const h of ['R', 'L']) for (const f of ['l', 'r']) assert.ok(KEYS.includes(resolveMetric(c.metric, h, f)), `${c.id}: unknown metric ${c.metric}`);
}

// ---- auto detect ----
assert.deepEqual(medianSmooth([1, 1, 9, 1, 1], 5), [1, 1, 1, 1, 1]); // one-sample spike removed
assert.deepEqual(medianSmooth([1, null, 3], 3), [1, null, 3]); // null stays null, nulls in the window are ignored
assert.equal(signalValue('knee_min', { knee_l: 140, knee_r: 120 }), 120);
assert.equal(signalValue('knee_min', { knee_l: 140, knee_r: null }), 140);
assert.equal(signalValue('knee_min', {}), null);
const AD = cpFile.auto_detect;
assert.ok(AD, 'checkpoints.json: auto_detect missing');
for (const k of ['smooth', 'baseline_pct', 'min_drop', 'window_sec', 'min_gap_sec']) assert.equal(typeof AD[k], 'number', `auto_detect.${k}`);
assert.equal(AD.signal, 'knee_min');
assert.ok(/AI/.test(AD.note), 'auto_detect.note must say these are AI-set values');

// real footage (first session, 120 fps, stride 4): exactly these 7 knee-bend moments
const csv = readFileSync(new URL('../sessions/2026-10-16-IMG_1224/angles.csv', import.meta.url), 'utf8').trim().split('\n');
const head = csv[0].split(','), col = n => head.indexOf(n), num = x => x === '' ? null : Number(x);
const real = csv.slice(1).map(l => l.split(',')).filter(r => r[col('person')] === '1')
  .map(r => ({ frame: +r[col('frame')], time: +r[col('time_sec')], v: signalValue(AD.signal, { knee_l: num(r[col('knee_l')]), knee_r: num(r[col('knee_r')]) }) }));
assert.deepEqual(detectEvents(real, AD).map(e => e.frame), [64, 308, 732, 848, 960, 1124, 1320]);

// synthetic: 0.05 s per sample, flat 170. Smooth valleys at samples 20 (130) and 30 (140) are 0.5 s apart -> only the lower one;
// the valley at 60 (135) is far away -> kept; a dip to 162 (drop 8 < 15) and a one-sample spike down to 100 -> ignored.
// Median smoothing can shift a valley bottom by a sample, so frames are compared within one sample (4 frames).
const syn = Array.from({ length: 100 }, (_, i) => ({ frame: i * 4, time: i * 0.05, v: 170 }));
const valley = (c, bottom) => { for (let d = -4; d <= 4; d++) syn[c + d].v = Math.min(170, bottom + 2 * d * d); };
valley(20, 130); valley(30, 140); valley(60, 135); valley(80, 162); syn[90].v = 100;
const O = { signal: 'knee_min', smooth: 5, baseline_pct: 90, min_drop: 15, window_sec: 0.33, min_gap_sec: 0.7 };
const close = (got, want) => assert.ok(got.length === want.length && got.every((f, i) => Math.abs(f - want[i]) <= 4), `${got} vs ${want}`);
close(detectEvents(syn, O).map(e => e.frame), [80, 240]);
close(detectEvents(syn, { ...O, min_gap_sec: 0.3 }).map(e => e.frame), [80, 120, 240]); // gap shorter than 0.5 s: both kept
assert.deepEqual(detectEvents(syn.map(s => ({ ...s, v: null })), O), []);
assert.deepEqual(detectEvents([], O), []);

// ---- fps from frame-time gaps ----
const gaps = (fps, n = 40) => Array.from({ length: n }, (_, i) => (1 / fps) * (1 + 0.015 * Math.sin(i * 12.9898))); // up to 1.5% jitter
const withDrops = d => d.map((x, i) => i % 11 === 5 ? x * 2 : x); // some dropped frames (double gaps)
for (const f of [24, 25, 30, 48, 50, 60, 120, 240]) assert.equal(fpsFromDeltas(withDrops(gaps(f))), f, `fps ${f}`);
assert.equal(fpsFromDeltas(gaps(59.94)), 60);
assert.equal(fpsFromDeltas(gaps(119.88)), 120);
assert.equal(fpsFromDeltas(gaps(100)), 100); // not a common value: rounded, not snapped
assert.equal(fpsFromDeltas([0.01, 0.01]), null); // too few
assert.equal(fpsFromDeltas(Array.from({ length: 30 }, (_, i) => 0.005 * 1.3 ** (i % 10))), null); // scattered
assert.equal(fpsFromDeltas([]), null);
// ---- stride ----
assert.deepEqual([24, 30, 60, 120, 240, 1].map(strideFor), [1, 1, 2, 4, 8, 1]);

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

console.log(`check.mjs: ok (angles 2D/3D, checkpoints, auto detect, fps, ${files.length} data files)`);
