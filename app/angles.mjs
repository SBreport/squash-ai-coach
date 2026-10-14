// Pure angle math, shared by app/index.html and tests/check.mjs.
// Points are {x, y} in pixel space (y grows downward, as in images).

export const KEYS = ['knee_l', 'knee_r', 'hip_l', 'hip_r', 'elbow_l', 'elbow_r', 'trunk_lean'];

export const LABELS = {
  knee_l: '무릎 L', knee_r: '무릎 R', hip_l: '엉덩이 L', hip_r: '엉덩이 R',
  elbow_l: '팔꿈치 L', elbow_r: '팔꿈치 R', trunk_lean: '상체 기울기',
};

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
  return out;
}
