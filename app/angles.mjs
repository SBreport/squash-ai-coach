// Pure angle math, shared by app/index.html and tests/check.mjs.
// Points are {x, y} in pixel space (y grows downward, as in images).

export const KEYS = ['knee_l', 'knee_r', 'hip_l', 'hip_r', 'elbow_l', 'elbow_r', 'trunk_lean', 'stance_ratio'];

export const LABELS = {
  knee_l: '무릎 L', knee_r: '무릎 R', hip_l: '엉덩이 L', hip_r: '엉덩이 R',
  elbow_l: '팔꿈치 L', elbow_r: '팔꿈치 R', trunk_lean: '상체 기울기', stance_ratio: '스탠스 비율',
};

// stance_ratio is a unitless ratio (2 decimals); everything else is degrees (1 decimal).
export const metricUnit = key => key === 'stance_ratio' ? '' : '°';
export const metricDecimals = key => key === 'stance_ratio' ? 2 : 1;
export const fmtMetric = (key, v) => v == null ? '-' : v.toFixed(metricDecimals(key)) + metricUnit(key);
export const roundMetric = (key, v) => v == null ? null : Number(v.toFixed(metricDecimals(key)));

// MediaPipe pose landmark indices [a, vertex, c]
export const JOINTS = {
  knee_l: [23, 25, 27], knee_r: [24, 26, 28],
  hip_l: [11, 23, 25], hip_r: [12, 24, 26],
  elbow_l: [11, 13, 15], elbow_r: [12, 14, 16],
};

// Angle ABC at vertex b, degrees 0..180. null if a segment has zero length.
export function angle(a, b, c) {
  const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
  const d = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (!d) return null;
  const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / d));
  return Math.acos(cos) * 180 / Math.PI;
}

// Lean of the hip->shoulder segment from vertical, degrees (0 = upright).
export function trunkLean(hip, shoulder) {
  const dx = shoulder.x - hip.x, dy = hip.y - shoulder.y;
  if (!dx && !dy) return null;
  return Math.abs(Math.atan2(dx, dy)) * 180 / Math.PI;
}

// Normalized MediaPipe landmarks -> {knee_l: deg|null, ...}.
// Must scale by w/h first: normalized x and y use different units.
// ponytail: fixed visibility cutoff 0.5; expose a control if real footage needs tuning.
export function poseAngles(lm, w, h, minVis = 0.5) {
  const p = i => ({ x: lm[i].x * w, y: lm[i].y * h });
  const seen = idx => idx.every(i => lm[i] && (lm[i].visibility ?? 1) >= minVis);
  const out = {};
  for (const [k, idx] of Object.entries(JOINTS)) out[k] = seen(idx) ? angle(...idx.map(p)) : null;
  const mid = (i, j) => ({ x: (p(i).x + p(j).x) / 2, y: (p(i).y + p(j).y) / 2 });
  out.trunk_lean = seen([11, 12, 23, 24]) ? trunkLean(mid(23, 24), mid(11, 12)) : null;
  out.stance_ratio = seen([23, 24, 27, 28]) ? stanceRatio(p(27), p(28), p(23), p(24)) : null;
  return out;
}

// Distance between ankles / distance between hips (unitless; works for {x,y} pixels and {x,y,z} metres).
// null if the hips coincide.
export function stanceRatio(ankleL, ankleR, hipL, hipR) {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
  const hips = dist(hipL, hipR);
  return hips ? dist(ankleL, ankleR) / hips : null;
}

// Which leg is the front (wall-side) leg: 'l' | 'r' | null (cannot tell). Uses normalized landmarks `lm`
// scaled to pixels. The ankle with the smaller image y is farther from the camera, i.e. toward the front wall.
// ponytail: assumes the camera is behind the player and above the floor (back-wall or rear-corner shot);
// breaks for side-on or front shots. If the ankle y gap is under 5% of leg length (feet level) -> null.
export function frontSide(lm, w, h, minVis = 0.5) {
  if (![23, 24, 25, 26, 27, 28].every(i => lm[i] && (lm[i].visibility ?? 1) >= minVis)) return null;
  const p = i => ({ x: lm[i].x * w, y: lm[i].y * h });
  const leg = (a, b, c) => Math.hypot(p(a).x - p(b).x, p(a).y - p(b).y) + Math.hypot(p(b).x - p(c).x, p(b).y - p(c).y);
  const legLen = (leg(23, 25, 27) + leg(24, 26, 28)) / 2, dy = p(27).y - p(28).y;
  if (!legLen || Math.abs(dy) < 0.05 * legLen) return null;
  return dy < 0 ? 'l' : 'r';
}

// ---- 3D (MediaPipe worldLandmarks: metres, hip-centred, y axis vertical) ----

// Angle ABC at vertex b for {x,y,z} points, degrees 0..180. null if a segment has zero length.
export function angle3(a, b, c) {
  const u = [a.x - b.x, a.y - b.y, a.z - b.z], v = [c.x - b.x, c.y - b.y, c.z - b.z];
  const d = Math.hypot(...u) * Math.hypot(...v);
  if (!d) return null;
  const cos = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / d));
  return Math.acos(cos) * 180 / Math.PI;
}

// Lean of hip->shoulder from the vertical (y) axis, degrees 0..90 (0 = upright). Sign-agnostic on y.
// ponytail: |dy| folds an upside-down torso onto the upright reading; irrelevant for squash play.
export function trunkLean3(hip, shoulder) {
  const dy = Math.abs(shoulder.y - hip.y), h = Math.hypot(shoulder.x - hip.x, shoulder.z - hip.z);
  if (!dy && !h) return null;
  return Math.atan2(h, dy) * 180 / Math.PI;
}

// worldLandmarks -> same shape as poseAngles. Visibility is read from the normalized landmarks `vis`
// (worldLandmarks visibility is not guaranteed to be filled in).
export function poseAngles3(wl, vis = wl, minVis = 0.5) {
  const seen = idx => idx.every(i => wl[i] && vis[i] && (vis[i].visibility ?? 1) >= minVis);
  const mid = (i, j) => ({ x: (wl[i].x + wl[j].x) / 2, y: (wl[i].y + wl[j].y) / 2, z: (wl[i].z + wl[j].z) / 2 });
  const out = {};
  for (const [k, idx] of Object.entries(JOINTS)) out[k] = seen(idx) ? angle3(...idx.map(i => wl[i])) : null;
  out.trunk_lean = seen([11, 12, 23, 24]) ? trunkLean3(mid(23, 24), mid(11, 12)) : null;
  out.stance_ratio = seen([23, 24, 27, 28]) ? stanceRatio(wl[27], wl[28], wl[23], wl[24]) : null;
  return out;
}

// ---- checkpoints ----

// Aliases -> concrete key. racket/other (knee, hip, elbow) depend on the racket hand ('R' or 'L');
// front/back (knee, hip) depend on `front` ('l' | 'r' | null, see frontSide) and give null when it is unknown.
export function resolveMetric(metric, hand = 'R', front = null) {
  let m = /^(knee|hip|elbow)_(racket|other)$/.exec(metric || '');
  if (m) {
    const r = hand === 'L' ? 'l' : 'r', o = r === 'r' ? 'l' : 'r';
    return `${m[1]}_${m[2] === 'racket' ? r : o}`;
  }
  m = /^(knee|hip)_(front|back)$/.exec(metric || '');
  if (m) return front ? `${m[1]}_${m[2] === 'front' ? front : front === 'l' ? 'r' : 'l'}` : null;
  return metric;
}

// Value of a checkpoint from an angles object ({knee_l:.., front:'l'}); null if not measured.
export function checkpointValue(cp, angles, hand = 'R') {
  const key = cp.metric && resolveMetric(cp.metric, hand, angles?.front);
  return (key && angles?.[key]) ?? null;
}

// 'na' = not measurable, 'ref' = no target (value only), else 'pass' | 'fail'. target {min?, max?} or null.
export function judge(value, target) {
  if (value == null) return 'na';
  if (!target) return 'ref';
  return value >= (target.min ?? -Infinity) && value <= (target.max ?? Infinity) ? 'pass' : 'fail';
}
