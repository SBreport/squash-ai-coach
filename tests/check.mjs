// node tests/check.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { KEYS, angle, trunkLean, poseAngles, angle3, trunkLean3, poseAngles3, stanceRatio, frontSide, resolveMetric, checkpointValue, judge,
  detectEvents, medianSmooth, signalValue, fpsFromDeltas, strideFor } from '../app/angles.mjs';
import { layoutLabels } from '../app/pose.mjs';
import { COURT, T, COURT_POINTS, CORNERS, homography, applyH, invertH, calibrate, footPoint, courtPos, tOccupancy,
  cornerOf, detectExcursions, cornerAvg, slowestCorner, totalSec } from '../app/court.mjs';

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

// ---- overlay_ids + court settings ----
assert.ok(Array.isArray(cpFile.overlay_ids) && cpFile.overlay_ids.length >= 1 && cpFile.overlay_ids.length <= 3, 'overlay_ids: 1..3 ids');
for (const id of cpFile.overlay_ids) {
  const c = cpFile.checkpoints.find(x => x.id === id);
  assert.ok(c, `overlay_ids: "${id}" is not in checkpoints`);
  assert.equal(c.type, 'angle', `overlay_ids: "${id}" is visual (not drawn on the video)`);
}
const CF = cpFile.court;
assert.ok(CF, 'checkpoints.json: court missing');
for (const k of ['t_radius_m', 'away_m', 'min_away_sec']) assert.ok(typeof CF[k] === 'number' && CF[k] > 0, `court.${k}`);
assert.ok(CF.away_m > CF.t_radius_m, 'court.away_m must be larger than t_radius_m');
assert.ok(/AI/.test(CF.note), 'court.note must say these are AI-set values');

// ---- layoutLabels: knee labels never overlap ----
const overlap = (a, b, it) => a.x < b.x + it.w && b.x < a.x + it.w && a.y < b.y + it.h && b.y < a.y + it.h;
{
  const it = { bx: 500, by: 400, cx: 520, w: 120, h: 60, r: 40 }; // both knees right at the same place
  const [a, b] = layoutLabels([it, { ...it, bx: 510 }], 1280, 720);
  assert.ok(!overlap(a, b, it), 'labels overlap');
  const [l, r] = layoutLabels([{ ...it, bx: 400, cx: 520 }, { ...it, bx: 640 }], 1280, 720); // knee left/right of the body
  assert.ok(l.x + it.w <= 400 && r.x >= 640, 'labels belong outside the knees');
  const [c, d] = layoutLabels([{ ...it, by: 700 }, { ...it, by: 705 }], 1280, 720); // bottom edge: must move up, stay in frame
  assert.ok(!overlap(c, d, it) && c.y + it.h <= 720 && d.y + it.h <= 720 && c.y >= 0 && d.y >= 0, 'labels not clamped/separated at the bottom');
  const [e] = layoutLabels([{ ...it, bx: 10, cx: 200 }], 1280, 720);
  assert.ok(e.x >= 0, 'label left of frame');
}

// ---- homography ----
// px quad -> unit square; interior points checked against a known projective map (metres -> pixels)
const H0 = [120, 10, 100, 15, 90, 80, 0.0004, 0.0009, 1]; // m -> px, mild perspective
const toPx = m => applyH(H0, m);
{
  const quad = [[0, 0], [1, 0], [1, 1], [0, 1]], px = quad.map(toPx);
  const H = homography(px, quad);
  px.forEach((p, i) => { const q = applyH(H, p); near(q[0], quad[i][0]); near(q[1], quad[i][1]); });
  for (const m of [[0.5, 0.5], [0.2, 0.9], [0.75, 0.1]]) { const q = applyH(H, toPx(m)); assert.ok(Math.hypot(q[0] - m[0], q[1] - m[1]) < 1e-9, `interior ${m}`); }
  const Hi = invertH(H), back = applyH(Hi, [0.3, 0.6]), px2 = toPx([0.3, 0.6]);
  assert.ok(Math.hypot(back[0] - px2[0], back[1] - px2[1]) < 1e-6, 'inverse maps metres back to pixels');
  // 5 points (all consistent) -> least squares gives the same map; one point 6 px off -> still close
  const five = [...quad, [0.5, 0.5]], p5 = five.map(toPx);
  const H5 = homography(p5, five), q5 = applyH(H5, toPx([0.2, 0.9]));
  assert.ok(Math.hypot(q5[0] - 0.2, q5[1] - 0.9) < 1e-9, '5-point exact');
  const noisy = p5.map((p, i) => i === 4 ? [p[0] + 6, p[1]] : p), Hn = homography(noisy, five), qn = applyH(Hn, toPx([0.2, 0.9]));
  assert.ok(qn && Math.hypot(qn[0] - 0.2, qn[1] - 0.9) < 0.05, 'noisy least squares stays near');
  // degenerate
  assert.equal(homography([[0, 0], [1, 1], [2, 2], [3, 3]], quad), null); // collinear
  assert.equal(homography([[0, 0], [1, 1], [2, 2], [5, 5]], [[0, 0], [1, 0], [2, 3], [4, 1]]), null);
  assert.equal(homography(px.slice(0, 3), quad.slice(0, 3)), null); // < 4
  assert.equal(homography([[1, 1], [1, 1], [1, 1], [1, 1]], quad), null); // identical points
}
// court calibration: project all 10 marks with a camera-like map, click 4 / 10 of them, recover positions
{
  const Hc = [60, 0, 400, 0, 30, 150, 0, 0.12, 1].map((x, i) => i === 7 ? 0.0005 : x); // m -> px (rough rear-camera look)
  const clicks = ids => ids.map(id => ({ id, px: applyH(Hc, COURT_POINTS.find(p => p.id === id).m) }));
  for (const ids of [['front_left', 'front_right', 'back_left', 'back_right'], COURT_POINTS.map(p => p.id)]) {
    const cal = calibrate(clicks(ids));
    assert.ok(cal && cal.reproj_px < 1e-6, `calibrate ${ids.length} points`);
    const m = courtPos(cal.H, applyH(Hc, [3.2, 5.44])); near(m[0], 3.2); near(m[1], 5.44);
    assert.equal(cal.points.length, ids.length);
  }
  const cal = calibrate(clicks(['front_left', 'front_right', 'back_left', 'back_right']));
  assert.equal(courtPos(cal.H, applyH(Hc, [3, -0.5])), null);  // 0.5 m in front of the front wall: outside the 0.3 m margin
  assert.ok(courtPos(cal.H, applyH(Hc, [3, -0.2])), 'inside the margin is kept');
  assert.equal(courtPos(cal.H, applyH(Hc, [7.0, 5])), null);
  assert.equal(courtPos(null, [1, 1]), null);
  assert.equal(calibrate(clicks(['front_left', 'front_right', 'short_left'])), null); // 3 points
  // foot point: heel preferred, ankle fallback, both feet averaged, nothing visible -> null
  const f = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  Object.assign(f[27], { x: 0.2, y: 0.8, visibility: 1 }); Object.assign(f[29], { x: 0.2, y: 0.9, visibility: 1 });
  Object.assign(f[28], { x: 0.4, y: 0.8, visibility: 1 });
  const fp = footPoint(f, 1000, 1000); near(fp[0], 300); near(fp[1], 850); // left heel (0.2,0.9) + right ankle (0.4,0.8)
  assert.equal(footPoint(f.map(q => ({ ...q, visibility: 0 })), 1000, 1000), null);
}

// ---- corners, T occupancy, excursions ----
assert.deepEqual(CORNERS.length, 6);
assert.equal(cornerOf([1, 1]), 'front_left');
assert.equal(cornerOf([5, 5.43]), 'front_right');
assert.equal(cornerOf([3.19, 1]), 'front_left');
assert.equal(cornerOf([3.2, 1]), 'front_right'); // the T line counts as right
assert.equal(cornerOf([1, 5.44]), 'side_left');  // short line itself = side
assert.equal(cornerOf([1, 7.04]), 'side_left');  // back line of the service boxes = side
assert.equal(cornerOf([1, 7.05]), 'back_left');
assert.equal(cornerOf([6, 6.2]), 'side_right');
assert.equal(cornerOf([6, 9.7]), 'back_right');
near(T[0], COURT.width / 2); near(T[1], 5.44);
{
  const OP = { t_radius_m: 1.0, away_m: 1.5, min_away_sec: 0.3 };
  // piecewise-linear path through [t, x, y] waypoints, 20 samples per second
  const path = wps => { const out = []; for (let t = 0; t <= wps[wps.length - 1][0] + 1e-9; t += 0.05) {
    let i = 0; while (i < wps.length - 2 && wps[i + 1][0] < t) i++;
    const [t0, x0, y0] = wps[i], [t1, x1, y1] = wps[i + 1], k = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
    out.push({ t: Math.round(t * 100) / 100, p: [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k] }); } return out; };
  const [tx, ty] = T;
  const tr = path([[0, tx, ty], [1, tx, ty], [2, 1.0, 1.5], [2.5, 1.0, 1.5], [3.5, tx, ty], [5, tx, ty], [6.2, 5.5, 9.0], [6.7, 5.5, 9.0], [7.9, tx, ty], [9, tx, ty]]);
  // noise that must be ignored: a wobble to 1.2 m from T (below away_m) and a one-sample spike to 2.5 m
  const wob = path([[9, tx, ty], [9.2, tx + 1.2, ty], [9.4, tx, ty], [10, tx, ty]]);
  const spike = path([[10, tx, ty], [10.05, tx + 2.5, ty], [10.1, tx, ty], [11, tx, ty]]);
  const track = [...tr, ...wob.slice(1), ...spike.slice(1)];
  const ex = detectExcursions(track, T, OP);
  assert.equal(ex.length, 2);
  assert.deepEqual(ex.map(e => e.corner), ['front_left', 'back_right']);
  const leg = (x, y) => Math.hypot(x - tx, y - ty);
  const d1 = leg(1.0, 1.5), d2 = leg(5.5, 9.0), within = (a, b) => Math.abs(a - b) < 0.1;
  assert.ok(within(ex[0].start_sec, 1 + 1 / d1), `start ${ex[0].start_sec}`);              // leaves the 1 m circle on the way out
  assert.ok(within(ex[0].return_sec, 3.5 - 1 / d1), `return ${ex[0].return_sec}`);
  assert.ok(within(ex[0].duration_sec, 2.5 - 2 / d1), `duration ${ex[0].duration_sec}`);
  assert.ok(ex[0].far_sec >= 2 - 1e-9 && ex[0].far_sec <= 2.5 + 1e-9);
  assert.ok(within(ex[1].duration_sec, 2.9 - 2 * 1.0 / d2 * 1.2), `duration2 ${ex[1].duration_sec}`);
  assert.ok(Math.abs(ex[0].far_dist_m - d1) < 1e-6);
  const avg = cornerAvg(ex);
  assert.deepEqual([avg.front_left.n, avg.back_right.n, avg.side_left.n], [1, 1, 0]);
  assert.equal(avg.side_left.avg_sec, null);
  assert.equal(slowestCorner(avg), 'back_right');
  assert.equal(slowestCorner(cornerAvg([])), null);
  near(totalSec(ex), ex[1].return_sec - ex[0].start_sec);
  assert.equal(totalSec([]), null);
  // a track that starts away from T is not a visit; a visit that never returns is not counted; nulls are skipped
  assert.equal(detectExcursions(path([[0, 1, 1], [1, 1, 1], [2, tx, ty], [3, tx, ty]]), T, OP).length, 0);
  assert.equal(detectExcursions(path([[0, tx, ty], [1, tx, ty], [2, 1, 1], [3, 1, 1]]), T, OP).length, 0);
  const holes = tr.map((s, i) => i % 7 === 3 ? { ...s, p: null } : s);
  assert.equal(detectExcursions(holes, T, OP).length, 2);
  assert.deepEqual(detectExcursions([], T, OP), []);
  // T occupancy: 20 samples at T, 10 at 3 m away, 5 undetected -> 20/30
  const occ = tOccupancy([...Array(20).fill({ t: 0, p: [tx + 0.5, ty] }), ...Array(10).fill({ t: 0, p: [tx, ty + 3] }), ...Array(5).fill({ t: 0, p: null })], 1.0);
  near(occ.pct, 20 / 30 * 100); assert.deepEqual([occ.inside, occ.valid, occ.total], [20, 30, 35]);
  assert.equal(tOccupancy([], 1).pct, null);
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

console.log(`check.mjs: ok (angles 2D/3D, checkpoints, auto detect, fps, overlay labels, court homography/T/excursions, ${files.length} data files)`);
