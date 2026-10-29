// node tests/check.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { KEYS, angle, trunkLean, poseAngles, angle3, trunkLean3, poseAngles3, stanceRatio, frontSide, resolveMetric, checkpointValue, judge,
  detectEvents, medianSmooth, signalValue, fpsFromDeltas, strideFor } from '../app/angles.mjs';
import { layoutLabels, createTracker, cropRect, gridRects, cropScale, mapBack, mergePeople } from '../app/pose.mjs';
import { colorHist, histSim, personHist, assignTracks, findOverlaps, applySwaps, IDENTITY_DEFAULTS, HIST_LEN } from '../app/identity.mjs';
import { CUE_TONES, findTones, segmentSets } from '../app/audio.mjs';
import { render as renderTones } from './audio.mjs';
import { METRICS, summarizeSession, diffSessions, withDiffs, recoveryHr } from '../app/history.mjs';
import { COURT, T, COURT_POINTS, CAL_ORDER, CAL_REQUIRED, calGuideSvg, ghostGuideSvg, courtSvg, CORNERS, homography, applyH, invertH, calibrate, footPoint, footPoints, courtPos, tOccupancy,
  fillGaps, despike, outBackAvg, detectCall, detectIntervals, dropOff, summarizeIntervals, cornerOf, detectExcursions, cornerAvg, slowestCorner, totalSec, handsUp, detectHandsUp } from '../app/court.mjs';

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
for (const k of ['t_radius_m', 'away_m', 'min_away_sec', 'hands_up_min_sec', 'hands_up_knee_min']) assert.ok(typeof CF[k] === 'number' && CF[k] > 0, `court.${k}`);
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

// ---- calibration wizard order and the two guide pictures ----
assert.deepEqual([...CAL_ORDER].sort(), COURT_POINTS.map(p => p.id).sort(), 'CAL_ORDER = exactly the COURT_POINTS ids');
assert.equal(CAL_ORDER.length, 10); assert.equal(CAL_REQUIRED, 7);
assert.deepEqual(CAL_ORDER.slice(0, 7), ['t', 'short_left', 'short_right', 'box_left', 'box_right', 'front_left', 'front_right']); // numbers 1-7 as sent to the user
assert.deepEqual(CAL_ORDER.slice(7), ['back_left', 'back_right', 'half_back']);
{
  const g = calGuideSvg(1, { done: new Set(['t']), skipped: new Set(['short_left']), current: 'short_right' });
  assert.ok(g.includes('<animate'), 'current mark pulses');
  assert.equal((g.match(/<animate/g) || []).length, 1);
  assert.equal((g.match(/<path d="M/g) || []).length, 1, 'one check mark for the one done mark');
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10]) assert.ok(g.includes(`>${n}</text>`), `number ${n} drawn`); // 1 is replaced by the check
  assert.ok(!calGuideSvg(1).includes('<animate'), 'no current mark, no pulse');
  assert.ok(calGuideSvg(1).includes('>1</text>'));
  const gh = ghostGuideSvg(1);
  for (const n of [1, 2, 3, 4, 5, 6]) assert.ok(gh.includes(`>${n}</text>`), `ghost number ${n}`);
  assert.equal((gh.match(/stroke-dasharray/g) || []).length, 6, 'one dashed line T -> corner each');
  assert.ok(courtSvg(1).includes('앞벽') && gh.includes(courtSvg(1, .55)), 'both guides reuse the shared court drawing');
}

// ---- corners, T occupancy, excursions ----
assert.deepEqual(CORNERS.length, 6);
assert.equal(cornerOf([1, 1]), 'front_left');
assert.equal(cornerOf([5.6, 4.6]), 'side_right'); // IMG_1222: side touch short of the wall, drifting forward
assert.equal(cornerOf([4.5, 3.5]), 'front_right'); // 53 deg forward of sideways
assert.equal(cornerOf([5, 5.2]), 'side_right');   // side touch just in front of the short line
assert.equal(cornerOf([3.19, 1]), 'front_left');
assert.equal(cornerOf([3.2, 1]), 'front_right'); // the T line counts as right
assert.equal(cornerOf([1, 4.3]), 'side_left');   // 27 deg forward = side
assert.equal(cornerOf([1, 6.6]), 'side_left');   // 28 deg back = side
assert.equal(cornerOf([1, 7.5]), 'back_left');   // 43 deg back = back
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

// ---- start signal: hands up ----
{
  const lmk = (nose, lw, rw, vis = 1) => { const a = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: vis })); a[0].y = nose; a[15].y = lw; a[16].y = rw; return a; };
  assert.equal(handsUp(lmk(.4, .2, .3)), true);
  assert.equal(handsUp(lmk(.4, .2, .5)), false);   // only one hand up
  assert.equal(handsUp(lmk(.4, .6, .6)), false);
  assert.equal(handsUp(lmk(.4, .2, .3, 0.2)), null); // not visible
  const O = { hands_up_min_sec: 0.3 }, at = (t0, t1, up) => { const o = []; for (let t = t0; t < t1 - 1e-9; t += 1 / 30) o.push({ t: Math.round(t * 1000) / 1000, up }); return o; };
  // 2 s down, 0.5 s up, 1 s down, a 0.1 s blip, 2 s down, 1 s up (track ends)
  const sm = [...at(0, 2, false), ...at(2, 2.5, true), ...at(2.5, 3.5, false), ...at(3.5, 3.6, true), ...at(3.6, 5.6, false), ...at(5.6, 6.6, true)];
  const hu = detectHandsUp(sm, O);
  assert.equal(hu.length, 2);
  assert.ok(Math.abs(hu[0].start_sec - 2) < 1e-6 && Math.abs(hu[0].end_sec - 2.5) < 1e-6, JSON.stringify(hu[0])); // end = first frame with arms down
  assert.ok(hu[1].start_sec > 5.5 && hu[1].end_sec > hu[1].start_sec + 0.9, 'span that runs to the end of the track is kept');
  // undetected samples neither end nor start a span
  const holes = [...at(0, 1, false), ...at(1, 1.2, true), ...at(1.2, 1.4, null), ...at(1.4, 1.7, true), ...at(1.7, 2.5, false)];
  assert.equal(detectHandsUp(holes, O).length, 1);
  assert.deepEqual(detectHandsUp([], O), []);
  assert.deepEqual(detectHandsUp(at(0, 3, false), O), []);
}

// ---- plain-language text of every checkpoint (shown in the panel) ----
for (const c of cpFile.checkpoints) assert.ok(typeof c.plain === 'string' && c.plain.length > 5, `${c.id}: plain missing`);
assert.equal(cpFile.checkpoints.find(c => c.id === 'lunge_front_knee').plain, '앞으로 내딛은 다리의 무릎이 얼마나 굽었나. 코치 기준 약 90도');

// ---- history: summaries of exported bundles and the change versus the previous record ----
{
  const sdir = new URL('../sessions/2026-10-16-IMG_1224/', import.meta.url), rd = f => readFileSync(new URL(f, sdir), 'utf8');
  // the real bundle has no events.json / court.json: events come from angles.csv (the same 7 moments as above)
  const s = summarizeSession({ name: '2026-10-16-IMG_1224', meta: JSON.parse(rd('meta.json')), events: null, court: null, csv: rd('angles.csv') }, { auto_detect: AD });
  assert.equal(s.date, '2026-10-16'); assert.equal(s.label, 'IMG_1224'); assert.equal(s.n_events, 7);
  const frames = new Set([64, 308, 732, 848, 960, 1124, 1320]);
  const kn = real.filter(r => frames.has(r.frame)).map(r => r.v);   // raw knee_min at the detected frames
  assert.equal(kn.length, 7); near(s.knee_min_avg, kn.reduce((a, b) => a + b) / 7);
  assert.ok(s.knee_min_avg > 100 && s.knee_min_avg < 170 && s.stance_avg > 0.3 && s.stance_avg < 4, `fixture values ${s.knee_min_avg} ${s.stance_avg}`);
  assert.deepEqual([s.t_occ, s.ghost_total, s.slow_corner, s.hr_recovery], [null, null, null, null]); // no court.json -> no record
  // with events.json and court.json (as the app exports them)
  const full = summarizeSession({ name: '2026-10-20-ghost', meta: { label: 'ghost' }, events: [{ angles: { knee_l: 100, knee_r: 90, stance_ratio: 1.5 } }, { angles: { knee_l: 110, knee_r: null, stance_ratio: null } }],
    court: { t_occupancy_pct: 41.2, total_sec: 42.5, excursions: [{}, {}], slowest_corner: 'back_left', corner_avg: { back_left: { n: 3, avg_sec: 2.4 } }, hr: { a: 150, b: 120, recovery: 30 } } });
  assert.deepEqual([full.n_events, full.knee_min_avg, full.stance_avg, full.t_occ, full.ghost_total, full.slow_corner, full.slow_corner_name, full.hr_recovery], [2, 100, 1.5, 41.2, 42.5, 2.4, 'back_left', 30]);
  assert.equal(summarizeSession({ name: 'x', court: { hr: { a: 130, b: 110 } } }).hr_recovery, 20); // recovery computed when only a/b are stored
  assert.equal(summarizeSession({ name: 'x', events: [] }).knee_min_avg, null); // events.json with no detections
}
assert.equal(recoveryHr(150, 120), 30); assert.equal(recoveryHr('150', '120'), 30);
assert.equal(recoveryHr(150, null), null); assert.equal(recoveryHr('', 120), null); assert.equal(recoveryHr(undefined, undefined), null);
{
  const D = (p, c) => Object.fromEntries(diffSessions(p, c, { kneeTarget: { min: 75, max: 105 } }).map(d => [d.key, d]));
  const base = { knee_min_avg: 120, stance_avg: 2, t_occ: 30, ghost_total: 40, slow_corner: 3, hr_recovery: 20 };
  let d = D(base, { knee_min_avg: 110, stance_avg: 2.12, t_occ: 33.2, ghost_total: 38.5, slow_corner: 3.4, hr_recovery: 24 });
  assert.deepEqual([d.t_occ.text, d.t_occ.tone], ['+3.2%', 'good']);            // higher is better
  assert.deepEqual([d.ghost_total.text, d.ghost_total.tone], ['-1.5초', 'good']); // lower is better
  assert.deepEqual([d.slow_corner.text, d.slow_corner.tone], ['+0.40초', 'bad']);
  assert.deepEqual([d.hr_recovery.text, d.hr_recovery.tone], ['+4 bpm', 'good']);
  assert.deepEqual([d.stance_avg.text, d.stance_avg.tone], ['+0.12배', 'neutral']); // no direction
  assert.deepEqual([d.knee_min_avg.text, d.knee_min_avg.tone], ['-10.0°', 'good']); // 120 -> 110 is closer to 75..105
  d = D(base, { ...base, t_occ: 27, ghost_total: 44, hr_recovery: 15 });
  assert.deepEqual([d.t_occ.tone, d.ghost_total.tone, d.hr_recovery.tone], ['bad', 'bad', 'bad']);
  assert.equal(d.knee_min_avg.text, '변화 없음'); assert.equal(d.knee_min_avg.tone, 'neutral');
  // knee: target range is the goal, not "smaller is better"
  const knee = (p, c) => D({ knee_min_avg: p }, { knee_min_avg: c }).knee_min_avg;
  assert.equal(knee(70, 85).tone, 'good');   // below the range -> inside
  assert.equal(knee(100, 120).tone, 'bad');  // inside -> above
  assert.equal(knee(120, 130).tone, 'bad');
  assert.equal(knee(80, 100).tone, 'neutral'); // both inside the range
  assert.equal(knee(90, 60).tone, 'bad'); assert.equal(knee(90, 60).text, '-30.0°');
  // missing data
  d = D(base, { knee_min_avg: 110 });
  assert.deepEqual([d.t_occ.text, d.t_occ.tone, d.hr_recovery.text], ['기록 없음', 'none', '기록 없음']);
  d = D(null, base); assert.deepEqual([d.t_occ.text, d.t_occ.tone], ['첫 기록', 'none']);
  d = D({ t_occ: null }, { t_occ: 30 }); assert.equal(d.t_occ.text, '첫 기록');
  // withDiffs: sorted by date, each metric compared with the nearest EARLIER session that has it
  const list = withDiffs([{ name: '2026-10-22-c', date: '2026-10-22', t_occ: 35, ghost_total: 39 }, { name: '2026-10-15-a', date: '2026-10-15', t_occ: 30, ghost_total: null },
    { name: '2026-10-18-b', date: '2026-10-18', t_occ: null, ghost_total: 41 }]);
  assert.deepEqual(list.map(s => s.name), ['2026-10-15-a', '2026-10-18-b', '2026-10-22-c']);
  const g = (s, k) => s.diffs.find(x => x.key === k);
  assert.equal(g(list[0], 't_occ').text, '첫 기록');
  assert.equal(g(list[1], 't_occ').text, '기록 없음');
  assert.equal(g(list[2], 't_occ').text, '+5.0%');          // skips the middle session that has no value
  assert.equal(g(list[2], 'ghost_total').text, '-2.0초');   // compared with 41, not with the null first session
  assert.equal(g(list[1], 'ghost_total').text, '첫 기록');
  assert.deepEqual(METRICS.map(m => m.key), ['knee_min_avg', 'stance_avg', 't_occ', 'ghost_total', 'slow_corner', 'interval_reps', 'interval_reaction', 'interval_back', 'interval_dropoff', 'hr_recovery']);
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


// ---- person tracker: a few false second detections must not steal the lone player ----
{
  const P = x => { const lm = []; lm[23] = { x, y: 0.5 }; lm[24] = { x, y: 0.5 }; return { lm }; };
  const tr = createTracker(), slot = r => r[0] ? 0 : 1;
  for (let i = 0; i < 50; i++) tr.assign([P(0.3)]);                 // one player, slot 1
  tr.assign([P(0.3), P(0.8)]); tr.assign([P(0.3), P(0.8)]);         // 2 frames of a false second person at 0.8
  assert.equal(slot(tr.assign([P(0.75)])), 0, 'lone player after a gap stays in slot 1 even near the stale slot 2');
  const g = createTracker();                                         // real game: both players established
  for (let i = 0; i < 50; i++) g.assign([P(0.3), P(0.8)]);
  assert.equal(slot(g.assign([P(0.78)])), 1, 'game: lone detection near player 2 goes to slot 2');
}
// ---- identity: clothing colour histogram, track assignment, overlaps, swaps ----
const ID = cpFile.identity;
assert.ok(ID, 'checkpoints.json: identity missing');
for (const k of ['w_pos', 'w_col', 'overlap_dist', 'ema']) assert.ok(typeof ID[k] === 'number' && ID[k] >= 0, `identity.${k}`);
assert.ok(/AI/.test(ID.note), 'identity.note must say these are AI-set values');
{
  const px = (r, g, b, n = 50) => Array.from({ length: n }, () => [r, g, b, 255]).flat();
  const red = colorHist(px(200, 30, 30)), red2 = colorHist(px(210, 40, 35)), blue = colorHist(px(30, 40, 200)), black = colorHist(px(15, 15, 15)), gray = colorHist(px(128, 128, 128));
  assert.equal(red.length, HIST_LEN); near(red.reduce((a, b) => a + b, 0), 1);
  near(histSim(red, red), 1);
  assert.ok(histSim(red, red2) > 0.99, 'nearly the same red');
  assert.ok(histSim(red, blue) < 0.05, 'red vs blue');
  assert.ok(histSim(black, gray) < 0.05, 'black vs mid gray differ by brightness');
  assert.ok(histSim(black, red) < 0.05);
  const mix = colorHist([...px(200, 30, 30, 50), ...px(15, 15, 15, 50)]); // half red, half black
  near(histSim(mix, red), 0.5); near(histSim(mix, black), 0.5);
  assert.equal(colorHist([]), null); assert.equal(colorHist(px(1, 2, 3, 5), 4, 30), null); // too few pixels
  assert.equal(histSim(null, red), null);
  near(histSim(colorHist([200, 30, 30, 30, 40, 200], 3), colorHist(px(200, 30, 30, 1).slice(0, 3).concat(30, 40, 200), 3)), 1); // stride 3 (plain RGB)

  // personHist: red torso + black legs on a 100x100 image; landmarks on the body
  {
    const W = 100, H = 100, data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) data.set([240, 240, 240, 255], i * 4); // light wall
    const fill = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([...c, 255], (y * W + x) * 4); };
    fill(30, 20, 70, 50, [200, 30, 30]); fill(30, 50, 70, 80, [15, 15, 15]);
    const L = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
    Object.assign(L[11], { x: 0.68, y: 0.22 }); Object.assign(L[12], { x: 0.32, y: 0.22 }); Object.assign(L[23], { x: 0.6, y: 0.5 }); Object.assign(L[24], { x: 0.4, y: 0.5 });
    Object.assign(L[25], { x: 0.6, y: 0.78 }); Object.assign(L[26], { x: 0.4, y: 0.78 });
    const h = personHist({ data, width: W, height: H }, L);
    assert.ok(histSim(h, colorHist([...Array(60).fill([200, 30, 30]).flat(), ...Array(40).fill([15, 15, 15]).flat()], 3)) > 0.8, 'red torso + black legs, no wall');
    assert.equal(personHist({ data, width: W, height: H }, L.map((q, i) => i === 23 ? { ...q, visibility: 0.1 } : q)), null, 'a torso landmark is not visible');
    const noLegs = personHist({ data, width: W, height: H }, L.map((q, i) => i === 25 || i === 26 ? { ...q, visibility: 0.1 } : q));
    assert.ok(noLegs && histSim(noLegs, colorHist(Array(50).fill([200, 30, 30]).flat(), 3)) > 0.9, 'legs not visible: torso only');
    assert.equal(personHist({ data, width: W, height: H }, L.map(q => ({ ...q, x: q.x + 3 }))), null, 'off screen');
  }
}
{
  const Cs = [[0.9, 0.2, 0.2], [0.2, 0.2, 0.9], [0.2, 0.9, 0.2]].map(([r, g, b]) => colorHist(Array.from({ length: 40 }, () => [r * 255, g * 255, b * 255, 255]).flat()));
  const [RED, BLUE, GREEN] = Cs, SAME = RED;
  // path functions give each person's hip centre at time t; frame order of people is shuffled per frame (as in the real analysis)
  const mk = (n, dt, a, b, histA, histB, keep = () => true) => Array.from({ length: n }, (_, i) => {
    const t = i * dt, people = [];
    if (a && keep('a', i)) people.push({ c: a(t), hist: histA, who: 'A' });
    if (b && keep('b', i)) people.push({ c: b(t), hist: histB, who: 'B' });
    if (i % 3 === 1) people.reverse();
    return { t, people };
  });
  const who = (frames, r) => r.map((x, i) => x.me == null ? null : frames[i].people[x.me].who).join('');
  const O = { w_pos: ID.w_pos, w_col: ID.w_col, overlap_dist: ID.overlap_dist, ema: ID.ema };
  const seedA = (frames, t = 0) => ({ t, idx: frames[Math.round(t / 0.1)].people.findIndex(p => p.who === 'A') });
  // A (red) walks right to the middle and goes back, B (blue) walks left to the middle and goes back: both stand at the same spot for 4 frames
  const tri = (x0, x1) => t => [t < 3 ? x0 + (0.5 - x0) * t / 3 : t < 3.4 ? 0.5 : 0.5 + (x1 - 0.5) * (t - 3.4) / 3, 0.5];
  const bounce = mk(66, 0.1, tri(0.15, 0.15), tri(0.85, 0.85), RED, BLUE);
  assert.equal(who(bounce, assignTracks(bounce, seedA(bounce), O)), 'A'.repeat(66), 'colour keeps me through a bounce at the same spot');
  assert.equal(who(bounce, assignTracks(bounce, seedA(bounce), { ...O, w_col: 0 })).includes('B'), true, 'position alone swaps them at the bounce (so colour is needed)');
  // seed in the middle (after the bounce): the earlier part is assigned backwards
  const mid = assignTracks(bounce, seedA(bounce, 5), O);
  assert.equal(who(bounce, mid), 'A'.repeat(66), 'seed in the middle, backwards and forwards');
  assert.deepEqual([mid[0].opp != null, mid[65].opp != null], [true, true]);
  // same clothes: pass through each other at constant speed -> position + velocity keeps each one on its own line
  const cross = mk(40, 0.1, t => [0.1 + 0.2 * t, 0.5], t => [0.9 - 0.2 * t, 0.52], SAME, SAME);
  assert.equal(who(cross, assignTracks(cross, seedA(cross), O)), 'A'.repeat(40), 'same colour: straight crossing keeps identity by motion');
  // frames with only one person: me alone, opponent alone (opponent established), nobody
  const lone = mk(60, 0.1, t => [0.2 + 0.001 * t, 0.5], t => [0.8 - 0.001 * t, 0.5], RED, BLUE, (k, i) => !(k === 'a' && i >= 20 && i < 30) && !(k === 'b' && i >= 40 && i < 50) && !(i >= 55));
  const lr = assignTracks(lone, seedA(lone), O);
  assert.equal(who(lone, lr).slice(0, 20), 'A'.repeat(20));
  assert.equal(lr[25].me, null, 'only the opponent visible: I am not found'); assert.equal(lone[25].people[lr[25].opp].who, 'B');
  assert.equal(lone[45].people[lr[45].me].who, 'A'); assert.equal(lr[45].opp, null);
  assert.deepEqual([lr[57].me, lr[57].opp], [null, null]);
  assert.ok(lr.every(r => r.conf >= 0 && r.conf <= 1));
  // a one-person video with false second detections: the lone player is never given to the unestablished "opponent"
  const ghost = mk(60, 0.1, t => [0.3 + 0.004 * t, 0.5], t => [0.3 + 0.004 * t + 0.01, 0.5], RED, GREEN, (k, i) => k === 'a' || i === 10 || i === 11);
  const gr = assignTracks(ghost, { t: 0, idx: 0 }, O);
  assert.equal(who(ghost, gr), 'A'.repeat(60));
  assert.deepEqual(assignTracks([], { t: 0, idx: 0 }, O), []);
  // overlaps: people closer than overlap_dist, and 2 -> 1 -> 2 people
  const ov = findOverlaps(bounce, assignTracks(bounce, seedA(bounce), O), O);
  assert.equal(ov.length, 1, JSON.stringify(ov));
  assert.ok(ov[0].start_t <= 3.0 + 1e-9 && ov[0].end_t >= 3.4 - 1e-9 && ov[0].end_t - ov[0].start_t < 1.5, JSON.stringify(ov));
  const dip = mk(60, 0.1, t => [0.2, 0.5], t => [0.8, 0.5], RED, BLUE, (k, i) => !(k === 'b' && i >= 20 && i < 25));
  const ovd = findOverlaps(dip, assignTracks(dip, seedA(dip), O), O);
  assert.equal(ovd.length, 1); assert.ok(Math.abs(ovd[0].start_t - 2.0) < 1e-9 && Math.abs(ovd[0].end_t - 2.4) < 1e-9, JSON.stringify(ovd));
  const dip2 = mk(100, 0.1, t => [0.2, 0.5], t => [0.8, 0.5], RED, BLUE, (k, i) => !(k === 'b' && i >= 20 && i < 70)); // 5 s absence: someone left, not an overlap
  assert.equal(findOverlaps(dip2, assignTracks(dip2, seedA(dip2), O), O).length, 0);
  assert.deepEqual(findOverlaps(ghost, gr, O), [], 'one-person video: no overlaps');
  assert.deepEqual(findOverlaps([], [], O), []);
  const two = findOverlaps(mk(80, 0.1, t => [0.2, 0.5], t => [0.8, 0.5], RED, BLUE, (k, i) => !(k === 'b' && ((i >= 10 && i < 12) || (i >= 14 && i < 16)))), Array(80).fill({ me: 0, opp: 1, conf: 1 }), O);
  assert.equal(two.length, 1, 'overlaps closer than 1 s are merged');
  // swaps: from an overlap's end to the next overlap's start; inside overlaps and after the next one nothing changes
  const fr = Array.from({ length: 100 }, (_, i) => ({ t: i * 0.1, people: [{}, {}] })), base = fr.map(() => ({ me: 0, opp: 1, conf: 1 }));
  const ovs = [{ start_t: 2, end_t: 3 }, { start_t: 6, end_t: 7 }];
  const sw = applySwaps(fr, base, ovs, [3]);
  assert.deepEqual([sw[29].me, sw[30].me, sw[31].me, sw[59].me, sw[60].me, sw[75].me], [0, 0, 1, 1, 0, 0]);
  assert.equal(sw[31].opp, 0);
  assert.equal(base[31].me, 0, 'input is not changed');
  const both = applySwaps(fr, base, ovs, [3, 7]);
  assert.deepEqual([both[40].me, both[80].me], [1, 1]);
  assert.deepEqual(applySwaps(fr, base, ovs, []).map(r => r.me), base.map(r => r.me));
  assert.equal(IDENTITY_DEFAULTS.overlap_dist, 0.08);
}

// ghosting v1.9: lead-foot far point, gap filling, out/back split
{
  const [tx, ty] = T, OP = { t_radius_m: 1.0, away_m: 1.5, min_away_sec: 0.3 };
  // lead foot: the average of both feet is 0.4 m short of the front-left corner zone, the lead foot is in it
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 1 }));
  lm[29] = { x: 0.2, y: 0.5, visibility: 1 }; lm[30] = { x: 0.6, y: 0.5, visibility: 0.1 }; lm[28] = { x: 0.4, y: 0.6, visibility: 0.9 };
  assert.deepEqual(footPoints(lm, 100, 100), [[20, 50], [40, 60]]);
  lm[30].visibility = 0; lm[28].visibility = 0;
  assert.deepEqual(footPoints(lm, 100, 100), [[20, 50], null]); near(footPoint(lm, 100, 100)[0], 20);
  const mk = (t, p, f) => ({ t, p, f });
  // a lunge, 0.1 s samples: the touch time is the farthest MEAN position, the touch point the median lead-foot position around it
  const lunge = [mk(0, [tx, ty]), mk(0.5, [tx, ty]), mk(0.6, [2.2, 4.4], [[2.0, 4.0], [2.4, 4.8]]), mk(0.7, [1.6, 3.4], [[1.2, 3.0], [2.0, 3.8]]), mk(0.8, [1.0, 2.6], [[0.8, 2.2], [1.6, 3.8]]),
    mk(0.9, [1.0, 2.6], [[0.8, 2.2], [1.6, 4.0]]), mk(1.0, [1.0, 2.6], [[0.9, 2.4], [1.7, 4.2]]), mk(1.1, [1.8, 3.8]), mk(1.2, [2.4, 4.3]), mk(1.6, [tx, ty])];
  const e = detectExcursions(lunge, T, OP)[0];
  assert.equal(e.corner, 'front_left'); assert.equal(e.far_sec, 0.8); assert.deepEqual(e.far_m.map(x => Math.round(x * 10) / 10), [0.9, 2.4]);
  near(e.out_sec, 0.8 - 0.6); near(e.back_sec, 1.6 - 0.8); near(e.out_sec + e.back_sec, e.duration_sec);
  // one sample with a lifted foot projected 3 m too far: touch time stays at the mean-position maximum, the point ignores the spike
  const spike = lunge.map(q => q.t === 0.9 ? { ...q, f: [[3.0, 0.4], q.f[1]] } : q);
  const e2 = detectExcursions(spike, T, OP)[0];
  assert.equal(e2.far_sec, 0.8); assert.ok(e2.far_m[1] > 2 && e2.far_m[1] < 3, `touch point ${e2.far_m}`); assert.equal(e2.corner, 'front_left');
  // the spike alone (no smoothing of the point needed for the time): even a spike AT the best-mean sample cannot move the time
  const spike2 = lunge.map(q => q.t === 0.6 ? { ...q, f: [[3.2, 0.1], [3.2, 0.1]] } : q);
  assert.equal(detectExcursions(spike2, T, OP)[0].far_sec, 0.8);
  near(outBackAvg([e, { out_sec: 0.4, back_sec: 0.2 }]).out, 0.3); assert.equal(outBackAvg([]).out, null);
  // gaps: <= 0.5 s filled (and flagged), longer left empty, feet filled only where both ends have the foot
  const g = fillGaps([mk(0, [0, 0], [[0, 0], null]), mk(0.1, null), mk(0.2, null), mk(0.3, [3, 3], [[3, 3], [1, 1]]), mk(0.4, null), mk(1.0, [4, 4]), mk(1.1, null), mk(1.2, [5, 5])]);
  near(g[1].p[0], 1); near(g[2].p[1], 2); assert.ok(g[1].interp && g[2].interp);
  assert.deepEqual(g[1].f, [[1, 1], null]);
  assert.equal(g[4].p, null, '0.7 s hole stays empty'); assert.ok(!g[4].interp);
  near(g[6].p[0], 4.5);                                            // 0.2 s hole
  assert.equal(fillGaps([mk(0, [0, 0]), mk(0.25, null), mk(0.5, [1, 1])])[1].p[0], 0.5); // exactly 0.5 s: filled
  assert.equal(fillGaps([mk(0, [0, 0]), mk(0.3, null), mk(0.6, [1, 1])])[1].p, null);  // 0.6 s: not
  assert.equal(fillGaps([mk(0, null), mk(0.1, [1, 1])])[0].p, null, 'no fill before the first known sample');
  // despike: a one-sample jump is removed, a steady run (and a lone first/last sample) is not
  const sp = despike([mk(0, [1, 1]), mk(0.1, [1, 1.1], [[1, 1.1], [1, 1.1]]), mk(0.2, [1, 9], [[1, 9], [1, 1.2]]), mk(0.3, [1, 1.2], [[1, 1.2], [1, 1.2]]), mk(0.4, [1, 1.3], [[1, 1.3], null])]);
  near(sp[2].p[1], 1.2); near(sp[2].f[0][1], 1.2); near(sp[4].p[1], 1.3);
  const run = [0, 1, 2, 3, 4].map(i => mk(i / 10, [i, 0]));
  assert.deepEqual(despike(run).map(q => q.p[0]), [0, 1, 2, 3, 4]);
  // a 0.4 s hole in the middle of a visit no longer splits it into "no visit"
  const hole = [mk(0, [tx, ty]), mk(0.5, [tx, ty]), mk(0.6, [2.4, 4.4]), mk(0.7, null), mk(0.8, null), mk(0.9, null), mk(1.0, [0.8, 2.0]), mk(1.3, [2.4, 4.4]), mk(1.6, [tx, ty])];
  assert.equal(detectExcursions(hole, T, OP).length, 1);
}

// interval sets: tones (synthetic sound) + track (synthetic positions) -> per-call results
{
  const [tx, ty] = T, OPI = { t_radius_m: 1.0, away_m: 1.5, move_m: 0.3 };
  const path = wps => { const out = []; for (let t = 0; t <= wps[wps.length - 1][0] + 1e-9; t += 0.05) {
    let i = 0; while (i < wps.length - 2 && wps[i + 1][0] < t) i++;
    const [t0, x0, y0] = wps[i], [t1, x1, y1] = wps[i + 1], k = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
    out.push({ t: Math.round(t * 100) / 100, p: [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k] }); } return out; };
  const events = [{ t: 8, kind: 'set_start' }, { t: 10, kind: 'call', corner: 'front_left' }, { t: 13.5, kind: 'call', corner: 'back_right' }, { t: 17.5, kind: 'call', corner: 'side_left' },
    { t: 20.5, kind: 'call', corner: 'front_right' }, { t: 22.9, kind: 'call', corner: 'back_left' }, { t: 40, kind: 'set_end' },
    { t: 50, kind: 'set_start' }, { t: 52, kind: 'call', corner: 'side_left' }, { t: 60, kind: 'set_end' }];
  const sr = 44100, x = renderTones({ events, dur: 62 }, sr, { clean: true });
  const tones = findTones(x, sr), sets = segmentSets(tones);
  assert.equal(tones.length, events.length); assert.equal(sets.length, 2); assert.deepEqual(sets.map(s => s.calls.length), [5, 1]);
  const track = path([[0, tx, ty], [10.35, tx, ty], [11.5, 0.8, 1.0], [11.8, 0.8, 1.0], [13.0, tx, ty],        // call 1: reaction .35, touch 11.5-11.8, home 13.0
    [13.9, tx, ty], [15.2, 5.6, 9.0], [15.4, 5.6, 9.0], [17.0, tx, ty],                                         // call 2: reaction .4
    [20.9, tx, ty], [22.0, 5.9, 5.44], [22.3, 5.9, 5.44], [23.5, tx, ty],                                       // call 3 (17.5): no move = missed; call 4 front_right: goes to the side-right wall, still on the way back at call 5
    [24.0, tx, ty], [25.5, 0.8, 8.75], [25.8, 0.8, 8.75], [27.5, tx, ty], [51.7, tx, ty],                      // call 5: baseline = home at 23.5, reaction from the beep 22.9 to 24.0
    [52.4, tx, ty], [53.2, 0.4, 5.44], [53.4, 0.4, 5.44], [55, tx, ty], [62, tx, ty]]);
  const iv = detectIntervals(track, sets, T, OPI), c = iv[0].calls, w = (a, b, tol = 0.07) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
  assert.equal(iv.length, 2); assert.deepEqual(c.map(q => q.status), ['ok', 'ok', 'missed', 'ok', 'ok']);
  w(c[0].reaction_sec, 0.35 + 0.3 / 5.3 * 1.15); // detected when the player has moved 0.3 m
  assert.ok(c[0].reaction_sec > 0.35 && c[0].reaction_sec < 0.6, `reaction ${c[0].reaction_sec}`);
  assert.equal(c[0].touch_corner, 'front_left'); assert.ok(c[0].corner_ok); w(c[0].touch_sec, 11.5, 0.3);
  w(c[0].out_sec + c[0].back_sec + c[0].reaction_sec, c[0].rep_sec, 1e-6);
  assert.ok(c[0].returned); w(c[0].return_sec, 13.0 - 0.15, 0.3);                         // back inside the 1 m circle slightly before 13.0
  assert.ok(c[0].back_sec > c[0].out_sec - 0.2 && c[0].back_sec < 2.2);
  assert.ok(c[1].corner_ok && c[1].touch_corner === 'back_right');
  assert.equal(c[2].reaction_sec, undefined);                                              // missed: nothing else filled
  assert.equal(c[3].touch_corner, 'side_right'); assert.equal(c[3].corner_ok, false);      // wrong corner
  assert.equal(c[3].returned, false); assert.equal(c[3].return_sec, sets[0].calls[4].t_sec); w(c[3].rep_sec, 22.9 - 20.5, 0.03); // cut by the next call
  assert.ok(c[4].corner_ok && c[4].reaction_sec > 1.0, `still returning at the beep: reaction counted from the beep ${c[4].reaction_sec}`);
  assert.equal(iv[0].reps, 4); w(iv[0].corner_pct, 75, 1e-9); assert.equal(iv[0].n_calls, 5);
  assert.equal(iv[1].calls[0].touch_corner, 'side_left'); assert.ok(iv[1].calls[0].corner_ok);
  const sm = summarizeIntervals(iv);
  assert.deepEqual([sm.sets, sm.calls, sm.reps, sm.missed], [2, 6, 5, 1]);
  assert.ok(sm.reaction > 0 && sm.back > 0 && sm.drop_off_pct != null);
  // short: moved 0.5 m but never beyond away_m; no tones -> no sets
  const sh = detectCall(path([[0, tx, ty], [1, tx + 0.8, ty], [3, tx, ty]]), { t_sec: 0.2, corner: 'side_right' }, 3, T, OPI);
  assert.equal(sh.status, 'short'); assert.ok(sh.reaction_sec > 0);
  assert.deepEqual(segmentSets(findTones(renderTones({ events: [], dur: 5 }, sr, { clean: true }), sr)), []);
}

// drop-off: positive = slower later
{
  const set = reps => ({ calls: reps.map(r => ({ status: 'ok', rep_sec: r })) });
  near(dropOff([set([2, 2]), set([2, 2]), set([3, 3]), set([3, 3])]), 50);               // 4 sets: first 2 vs last 2
  near(dropOff([set([2]), set([4]), set([2]), set([3]), set([3])]), (3 - 3) / 3 * 100);   // sets 1-2 mean 3, sets 4-5 mean 3
  near(dropOff([set([2, 2]), set([1, 1])]), -50);                                         // 2 sets: first vs second (faster = negative)
  near(dropOff([set([2]), set([9]), set([3])]), 50);                                       // 3 sets: first vs last, middle left out
  near(dropOff([set([2, 2, 4, 4])]), 100);                                                 // 1 set: first half vs second half of the calls
  assert.equal(dropOff([]), null); assert.equal(dropOff([{ calls: [{ status: 'missed' }] }, { calls: [] }]), null);
  // missed calls do not count
  near(dropOff([{ calls: [{ status: 'ok', rep_sec: 2 }, { status: 'missed' }] }, { calls: [{ status: 'ok', rep_sec: 3 }] }]), 50);
  // history: interval sessions record interval metrics and no 18-visit ghosting numbers
  const s = summarizeSession({ name: '2026-10-30-iv', court: { excursions: [{}], total_sec: 99, slowest_corner: 'back_left', corner_avg: { back_left: { avg_sec: 2 } },
    intervals: { sets: [{}], summary: { reps: 24, reaction: 0.42, back: 1.1, drop_off_pct: 6.5 } } } });
  assert.deepEqual([s.interval_reps, s.interval_reaction, s.interval_back, s.interval_dropoff, s.ghost_total, s.slow_corner], [24, 0.42, 1.1, 6.5, null, null]);
  const d = diffSessions({ interval_reaction: 0.5, interval_dropoff: 5, interval_reps: 20 }, { interval_reaction: 0.4, interval_dropoff: 8, interval_reps: 24 });
  const tone = k => d.find(q => q.key === k).tone;
  assert.deepEqual([tone('interval_reaction'), tone('interval_dropoff'), tone('interval_reps')], ['good', 'bad', 'good']);
}

// recovery helpers: crop clamping, mapping back, merge dedup
{
  const mk = (x, y, v = 1) => Array.from({ length: 33 }, () => ({ x, y, visibility: v }));
  const edge = mk(0.02, 0.5); edge[0] = { x: 0.0, y: 0.4, visibility: 1 }; edge[1] = { x: 0.05, y: 0.6, visibility: 1 };
  const r = cropRect(edge, 1000, 500);
  assert.ok(r.x === 0 && r.x + r.w <= 1000 && r.y >= 0 && r.y + r.h <= 500 && r.w > 0 && r.h > 0, 'crop clamped to frame');
  assert.equal(cropRect(mk(0.5, 0.5), 1000, 500).w, Math.round(2 * 0.12 * 500 * 1.25), 'min size 12% of H');
  const back = mapBack([{ x: 0.5, y: 0.25, visibility: 0.9 }], { x: 200, y: 100, w: 400, h: 200 }, 1000, 500);
  near(back[0].x, 0.4); near(back[0].y, 0.30); assert.equal(back[0].visibility, 0.9);
  assert.equal(cropScale({ w: 300, h: 200 }, 512), 2.56); assert.equal(cropScale({ w: 900, h: 700 }, 512), 1);
  assert.equal(gridRects(1000, 500).length, 6);
  const a = { lm: mk(0.5, 0.5, 0.6) }, b = { lm: mk(0.52, 0.5, 0.9), rec: 1 }, c = { lm: mk(0.8, 0.5) };
  const m = mergePeople([a, b, c], 1000, 500);
  assert.deepEqual(m, [b, c], 'near copies merge keeping the more visible one');
  assert.equal(mergePeople([a, { lm: mk(0.57, 0.5) }], 1000, 500).length, 2, '7% apart = two people');
}

console.log(`check.mjs: ok (lead-foot/gap fill/out-back, interval calls + drop-off, recovery helpers, angles 2D/3D, checkpoints, auto detect, fps, overlay labels, court homography/wizard order/T/excursions, history/diff/recovery HR, identity colour/assign/overlaps/swaps, ${files.length} data files)`);
