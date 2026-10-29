// Court geometry, homography, T occupancy and ghosting-excursion detection. Pure math (plus two canvas drawing
// helpers at the end); shared by app/index.html and tests/check.mjs.
//
// Court coordinates, metres: x = from the LEFT side wall to the right (0..6.40), y = from the FRONT wall to the back
// (0..9.75); "left/right" as seen when facing the front wall.

// Singles court per the WSF court specification. Line widths (5 cm) are ignored: every position is the line's centre.
export const COURT = {
  length: 9.75,        // front wall to back wall
  width: 6.40,         // side wall to side wall
  shortLine: 5.44,     // short line, distance from the front wall
  box: 1.60,           // service box, square, 1.60 m x 1.60 m, against the side wall behind the short line
  tX: 3.20,            // T = short line x half-court line (half-court line is the centre line behind the short line)
  tY: 5.44,
};
export const T = [COURT.tX, COURT.tY];
const BOX_BACK = COURT.shortLine + COURT.box; // 7.04, back line of the service boxes

// Floor marks the user clicks in the video: [id, name, [x, y] metres].
export const COURT_POINTS = [
  ['front_left', '앞벽-왼쪽 바닥 모서리', [0, 0]],
  ['front_right', '앞벽-오른쪽 바닥 모서리', [COURT.width, 0]],
  ['short_left', '숏라인-왼쪽 벽', [0, COURT.shortLine]],
  ['short_right', '숏라인-오른쪽 벽', [COURT.width, COURT.shortLine]],
  ['t', 'T (숏라인과 가운데선이 만나는 곳)', T],
  ['box_left', '왼쪽 서비스박스 뒤-안쪽 모서리', [COURT.box, BOX_BACK]],
  ['box_right', '오른쪽 서비스박스 뒤-안쪽 모서리', [COURT.width - COURT.box, BOX_BACK]],
  ['back_left', '뒷벽-왼쪽 바닥 모서리', [0, COURT.length]],
  ['back_right', '뒷벽-오른쪽 바닥 모서리', [COURT.width, COURT.length]],
  ['half_back', '가운데선-뒷벽', [COURT.tX, COURT.length]],
].map(([id, name, m]) => ({ id, name, m }));

// Order of the calibration wizard: the number shown on the guide picture, on the video and in the text is index + 1.
// 1-7 are normally visible from behind the back wall; 8-10 are optional (more points = better accuracy).
export const CAL_ORDER = ['t', 'short_left', 'short_right', 'box_left', 'box_right', 'front_left', 'front_right', 'back_left', 'back_right', 'half_back'];
export const CAL_REQUIRED = 7;

// Court lines as [[x1, y1], [x2, y2]] segments (metres).
export const COURT_LINES = [
  [[0, 0], [COURT.width, 0]], [[COURT.width, 0], [COURT.width, COURT.length]],
  [[COURT.width, COURT.length], [0, COURT.length]], [[0, COURT.length], [0, 0]],
  [[0, COURT.shortLine], [COURT.width, COURT.shortLine]],
  [[COURT.tX, COURT.tY], [COURT.tX, COURT.length]],
  [[0, BOX_BACK], [COURT.box, BOX_BACK]], [[COURT.box, COURT.shortLine], [COURT.box, BOX_BACK]],
  [[COURT.width, BOX_BACK], [COURT.width - COURT.box, BOX_BACK]], [[COURT.width - COURT.box, COURT.shortLine], [COURT.width - COURT.box, BOX_BACK]],
];

// ---- homography (pixels -> metres, or any plane -> plane) ----

const mul3 = (A, B) => Array.from({ length: 9 }, (_, i) => { const r = i / 3 | 0, c = i % 3; return A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; });
function inv3(M) {
  const [a, b, c, d, e, f, g, h, i] = M, det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!det || !Number.isFinite(det)) return null;
  return [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d].map(x => x / det);
}
export const invertH = inv3;

// Solve M x = r (n x n) by Gaussian elimination with partial pivoting; null if (nearly) singular.
function solve(M, r) {
  const n = r.length, A = M.map((row, i) => [...row, r[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(A[i][c]) > Math.abs(A[p][c])) p = i;
    if (Math.abs(A[p][c]) < 1e-9) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let i = c + 1; i < n; i++) { const k = A[i][c] / A[c][c]; for (let j = c; j <= n; j++) A[i][j] -= k * A[c][j]; }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = A[i][n]; for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
  return x;
}

// Hartley normalisation: centroid at the origin, mean distance sqrt(2). Returns {T, p} or null (all points equal).
function normalise(pts) {
  const n = pts.length, cx = pts.reduce((s, q) => s + q[0], 0) / n, cy = pts.reduce((s, q) => s + q[1], 0) / n;
  const md = pts.reduce((s, q) => s + Math.hypot(q[0] - cx, q[1] - cy), 0) / n;
  if (!md) return null;
  const s = Math.SQRT2 / md;
  return { T: [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1], p: pts.map(q => [s * (q[0] - cx), s * (q[1] - cy)]) };
}

// DLT homography H (9 numbers, row-major, H[8] = 1) with dst ~ H * src, from n >= 4 point pairs (src, dst: [[x, y], ...]).
// n > 4: least squares (normal equations). null if fewer than 4 pairs or the points are degenerate (e.g. collinear).
export function homography(src, dst) {
  const n = src.length;
  if (n < 4 || dst.length !== n) return null;
  const S = normalise(src), D = normalise(dst);
  if (!S || !D) return null;
  const A = [], b = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = S.p[i], [u, v] = D.p[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const MtM = Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, (_, j) => A.reduce((s, row) => s + row[i] * row[j], 0)));
  const Mtb = Array.from({ length: 8 }, (_, i) => A.reduce((s, row, k) => s + row[i] * b[k], 0));
  const h = solve(MtM, Mtb);
  const Di = h && inv3(D.T);
  if (!Di) return null;
  const H = mul3(mul3(Di, [...h, 1]), S.T);
  return H.every(Number.isFinite) && H[8] ? H.map(x => x / H[8]) : null;
}

// Map a point [x, y] through H; null if it lands on the horizon (w ~ 0).
// ponytail: no check that w keeps its sign, so points behind the camera map to nonsense; fine for floor points in view.
export function applyH(H, p) {
  if (!H || !p) return null;
  const w = H[6] * p[0] + H[7] * p[1] + H[8];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return null;
  return [(H[0] * p[0] + H[1] * p[1] + H[2]) / w, (H[3] * p[0] + H[4] * p[1] + H[5]) / w];
}

// Calibration from clicked points [{id, px: [x, y]}] (ids from COURT_POINTS, no duplicates) ->
// {H (px -> m), Hinv (m -> px), reproj_px (mean pixel distance after projecting each court point back), points} or null.
export function calibrate(clicks) {
  const pts = clicks.map(c => ({ ...COURT_POINTS.find(p => p.id === c.id), px: c.px })).filter(p => p.m);
  const H = homography(pts.map(p => p.px), pts.map(p => p.m)), Hinv = H && inv3(H);
  if (!Hinv) return null;
  const err = pts.map(p => { const q = applyH(Hinv, p.m); return q ? Math.hypot(q[0] - p.px[0], q[1] - p.px[1]) : Infinity; });
  return { H, Hinv, reproj_px: err.reduce((s, e) => s + e, 0) / err.length, points: pts.map(({ name, px, m }) => ({ name, px, m })) };
}

// ---- player position on the floor ----

// Pixel point under each foot [left, right] (landmarks 29/27 and 30/28): the heel if visible, else the ankle; null for a foot
// that is not visible. lm = normalized landmarks.
export function footPoints(lm, W, H, minVis = 0.5) {
  const ok = i => lm[i] && (lm[i].visibility ?? 1) >= minVis;
  return [[29, 27], [30, 28]].map(([heel, ankle]) => { const i = ok(heel) ? heel : ok(ankle) ? ankle : null; return i == null ? null : [lm[i].x * W, lm[i].y * H]; });
}
// Pixel point under the player: mean of the visible feet. null if no foot is visible.
export function footPoint(lm, W, H, minVis = 0.5) {
  const f = footPoints(lm, W, H, minVis).filter(Boolean);
  return f.length ? [f.reduce((s, q) => s + q[0], 0) / f.length, f.reduce((s, q) => s + q[1], 0) / f.length] : null;
}

// Pixel foot point -> court metres, or null if there is no calibration/foot or the spot is more than `margin` m
// outside the court (a bad detection or someone off court).
export function courtPos(H, foot, margin = 0.3) {
  const m = applyH(H, foot);
  if (!m || m[0] < -margin || m[0] > COURT.width + margin || m[1] < -margin || m[1] > COURT.length + margin) return null;
  return m;
}

// ---- T occupancy, corner visits ----

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

// track: [{t (sec), p: [x, y] metres | null}]. Share of samples with a valid position that lie within `radius` of T.
// ponytail: counts every sample of the analysed range, rest time between rallies included (no rally detection yet).
export function tOccupancy(track, radius) {
  const v = track.filter(s => s.p), inside = v.filter(s => dist(s.p, T) <= radius).length;
  return { pct: v.length ? inside / v.length * 100 : null, inside, valid: v.length, total: track.length };
}

export const CORNERS = ['front_left', 'front_right', 'side_left', 'side_right', 'back_left', 'back_right'];
export const CORNER_LABEL = { front_left: '앞 왼쪽', front_right: '앞 오른쪽', side_left: '옆 왼쪽', side_right: '옆 오른쪽', back_left: '뒤 왼쪽', back_right: '뒤 오른쪽' };

// Which of 6 ghosting zones a court point is in, by DIRECTION from T: more than SIDE_DEG forward of sideways = front,
// more than SIDE_DEG behind = back, else side. Depth bands failed on real footage (IMG_1222, 2026-10-16): side touches
// that stop short of the wall and drift a little forward were called "front". Left = x < 3.20 (T line counts as right).
// ponytail: fixed 30 deg (AI-set, not a coach number); tune if real touches land between rows.
const TOUCH_FRONT = 1.0, TOUCH_BACK = 8.75; // typical touch depths of the front and back corners (m from the front wall), guide picture
const SIDE_DEG = 30;
export function cornerOf(p) {
  const deg = Math.atan2(COURT.tY - p[1], Math.abs(p[0] - COURT.tX)) * 180 / Math.PI;
  const row = deg > SIDE_DEG ? 'front' : deg < -SIDE_DEG ? 'back' : 'side';
  return `${row}_${p[0] < COURT.tX ? 'left' : 'right'}`;
}

// Short position gaps: samples without a position between two samples that have one are filled by linear interpolation when
// the two known samples are at most maxSec apart (a longer hole stays empty). Interpolated samples carry `interp: true`; their
// per-foot points f are interpolated too when both ends have that foot. track: [{t, p, f?}] -> new array.
// ponytail: straight line between the two ends; a fast turn inside a 0.5 s hole is cut short (detectExcursions then sees a smaller far point).
export function fillGaps(track, maxSec = 0.5) {
  const out = track.map(s => ({ ...s }));
  let a = -1; // index of the last sample with a position
  for (let i = 0; i < out.length; i++) {
    if (!out[i].p) continue;
    if (a >= 0 && i - a > 1 && out[i].t - out[a].t <= maxSec + 1e-9) for (let j = a + 1; j < i; j++) {
      const k = (out[j].t - out[a].t) / (out[i].t - out[a].t), lerp = (u, v) => [u[0] + (v[0] - u[0]) * k, u[1] + (v[1] - u[1]) * k];
      out[j].p = lerp(out[a].p, out[i].p); out[j].interp = true;
      out[j].f = [0, 1].map(n => out[a].f?.[n] && out[i].f?.[n] ? lerp(out[a].f[n], out[i].f[n]) : null);
    }
    a = i;
  }
  return out;
}

// 3-sample median of each position (and each foot) over neighbours that all have one: a single-frame jump (a bad foot detection
// 4 m away, seen on IMG_1222) disappears, steady movement is unchanged. Used for the call analysis only. track: [{t, p, f?}] -> new array.
// ponytail: only 1-sample spikes are removed; a 2-sample glitch needs a wider window (and blurs real turns more).
export function despike(track) {
  const med = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  const m3 = (u, v, w) => u && v && w ? [med(u[0], v[0], w[0]), med(u[1], v[1], w[1])] : v;
  return track.map((s, i) => {
    const a = track[i - 1], c = track[i + 1];
    if (!a || !c || !s.p) return s;
    return { ...s, p: m3(a.p, s.p, c.p), f: s.f ? s.f.map((q, n) => m3(a.f?.[n], q, c.f?.[n])) : s.f };
  });
}

// The point that counts as the touch at a sample: the foot farthest from T (the lead foot in a lunge); s.p if there are no feet.
const reachOf = (s, t) => (s.f || []).filter(Boolean).reduce((b, q) => !b || dist(q, t) > dist(b, t) ? q : b, null) || s.p;
const median = a => { const v = [...a].sort((x, y) => x - y), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
// 5-point median of the mean position over the samples that have one (null where the sample has none).
const smoothP = a => a.map((_, i) => { const w = a.slice(Math.max(0, i - 2), i + 3).filter(q => q.p); return w.length ? [median(w.map(q => q.p[0])), median(w.map(q => q.p[1]))] : null; });

// Touch of one outward trip. samples: [{t, p, f?}] from leaving T to coming back. The touch TIME is when the 5-point-median mean
// position (what T occupancy uses) is farthest from T: a lifted foot in a lunge projects far beyond the floor spot for a frame or two
// and must not move the time. The touch POINT (and so the corner) = coordinate-wise median of the lead-foot (farthest foot) positions
// within +-0.2 s of that time. -> {t, pt, d (pt distance from T)}.
// ponytail: fixed 0.2 s window; with a very large analysis stride the window holds one sample and the median is that sample.
export function touchOf(samples, t, win = 0.2) {
  const sm = smoothP(samples);
  let bi = -1, bd = -1;
  sm.forEach((q, i) => { if (q && dist(q, t) > bd) { bd = dist(q, t); bi = i; } });
  if (bi < 0) return null;
  const t0 = samples[bi].t, pts = samples.filter(s => s.p && Math.abs(s.t - t0) <= win + 1e-9).map(s => reachOf(s, t));
  const pt = [median(pts.map(q => q[0])), median(pts.map(q => q[1]))];
  return { t: t0, pt, d: dist(pt, t) };
}

// Corner visits ("ghosting"): the player is at T (within t_radius_m), goes farther than away_m, and comes back within
// t_radius_m. start = first sample outside t_radius_m after being at T, far = the sample farthest from T, return = first
// sample back inside t_radius_m. Visits shorter than min_away_sec (start -> return) are tracking noise and dropped; a visit
// that never returns, or a track that starts away from T, is not counted. Samples with no position are skipped.
// Leaving/returning use the position p; the touch time/point come from touchOf (smoothed mean position for the time, lead foot for the point).
// track: [{t, p, f?}]; o: {t_radius_m, away_m, min_away_sec}.
// Returns [{start_sec, far_sec, return_sec, duration_sec, out_sec (start -> far), back_sec (far -> return), corner, far_m, far_dist_m}].
export function detectExcursions(track, t, o) {
  const out = [];
  let home = false, run = [], far = false;
  for (const s of track) {
    if (!s.p) continue;
    const d = dist(s.p, t);
    if (d <= o.t_radius_m) {
      if (home && far && s.t - run[0].t >= o.min_away_sec - 1e-9) {
        const k = touchOf(run, t), st = run[0].t;
        out.push({ start_sec: st, far_sec: k.t, return_sec: s.t, duration_sec: s.t - st, out_sec: k.t - st, back_sec: s.t - k.t, corner: cornerOf(k.pt), far_m: k.pt, far_dist_m: k.d });
      }
      home = true; run = []; far = false;
    } else if (home) { run.push(s); if (d > o.away_m) far = true; }
  }
  return out;
}

// ---- start signal: both hands up (hands up) ----

// One person's landmarks -> true when both wrists (15, 16) are above the nose (0) in the image (smaller y), false when not,
// null when a wrist or the nose is not visible. lm = normalized landmarks.
export function handsUp(lm, minVis = 0.5) {
  const ok = i => lm[i] && (lm[i].visibility ?? 1) >= minVis;
  if (!ok(0) || !ok(15) || !ok(16)) return null;
  return lm[15].y < lm[0].y && lm[16].y < lm[0].y;
}

// Spans where the hands stay up: samples [{t, up: true|false|null}] (null = not detected: skipped, neither starts nor ends a span).
// A span starts at the first up sample and ends at the first sample with the hands down (the moment the arms come down; the last
// sample's time if the track ends first). Spans shorter than o.hands_up_min_sec are dropped (a wave or a detection blip).
// Returns [{start_sec, end_sec}].
export function detectHandsUp(samples, o) {
  const out = [];
  let start = null, last = null;
  const close = end => { if (start != null && end - start >= o.hands_up_min_sec - 1e-9) out.push({ start_sec: start, end_sec: end }); start = null; };
  for (const s of samples) {
    if (s.up == null) continue;
    if (s.up) { if (start == null) start = s.t; last = s.t; } else close(s.t);
  }
  if (start != null) close(last);
  return out;
}

// Per-corner count and mean duration of excursions -> {corner: {n, avg_sec|null}} for all 6 corners.
export function cornerAvg(ex) {
  return Object.fromEntries(CORNERS.map(c => {
    const d = ex.filter(e => e.corner === c).map(e => e.duration_sec);
    return [c, { n: d.length, avg_sec: d.length ? d.reduce((a, b) => a + b, 0) / d.length : null }];
  }));
}

// Mean of the numbers in a list (null if empty).
const meanOf = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
// Mean out_sec / back_sec over visits -> {out, back} (null if no visits).
export const outBackAvg = ex => ({ out: meanOf(ex.map(e => e.out_sec)), back: meanOf(ex.map(e => e.back_sec)) });

// The slowest corner (largest mean duration) or null if there are no visits.
export const slowestCorner = avg => CORNERS.filter(c => avg[c].n).reduce((p, c) => p == null || avg[c].avg_sec > avg[p].avg_sec ? c : p, null);

// Seconds from the first departure to the last return, null if no visits.
export const totalSec = ex => ex.length ? ex[ex.length - 1].return_sec - ex[0].start_sec : null;

// ---- interval sets with cue tones (calls come from app/audio.mjs segmentSets) ----

// One call -> {t_sec, corner, status: 'ok'|'short'|'missed', reaction_sec, start_sec, touch_sec, return_sec, out_sec, back_sec, rep_sec, returned, touch_m, touch_corner, corner_ok}.
// Window = beep -> next call (or the set end). missed = the player never moved move_m from where they stood at the beep (the spot counts as moved to any later spot closer to T, so arriving home is not a start).
// start = first sample after the beep that is move_m away from that spot (see below); touch = touchOf (same rule as the visits) from the start on;
// return = first sample after the touch back within t_radius_m, or the next call if that comes first (returned = false).
// short = moved but never farther than away_m from T (no touch). rep_sec = beep -> return.
// track: [{t, p, f?}] (use fillGaps first); o: {t_radius_m, away_m, move_m}.
export function detectCall(track, call, tEnd, t, o) {
  const base = { t_sec: call.t_sec, corner: call.corner };
  const v = track.filter(s => s.p);
  const p0 = ([...v].reverse().find(s => s.t <= call.t_sec) || v.find(s => s.t > call.t_sec))?.p;
  const win = v.filter(s => s.t > call.t_sec && s.t <= tEnd);
  // baseline = the spot at the beep, moved to any later spot that is closer to T (a player still coming back from the last call
  // keeps arriving; that is not the start of a new move). start = first sample move_m away from the baseline.
  let b = p0, bd = p0 ? dist(p0, t) : 0, i0 = -1;
  if (p0) for (let i = 0; i < win.length; i++) {
    const d = dist(win[i].p, t);
    if (d < bd) { b = win[i].p; bd = d; } else if (dist(win[i].p, b) >= o.move_m) { i0 = i; break; }
  }
  if (i0 < 0) return { ...base, status: 'missed' };
  const start = win[i0];
  const trip = win.slice(i0), sm = smoothP(trip);
  let m = -1, ri = -1;
  for (let i = 0; i < trip.length; i++) {
    const dd = sm[i] ? dist(sm[i], t) : -1;
    if (dd > m) m = dd; else if (m > o.away_m && sm[i] && dd <= o.t_radius_m) { ri = i; break; }
  }
  const ret = ri >= 0 ? trip[ri] : null, k = touchOf(ret ? trip.slice(0, ri + 1) : trip, t);
  const r = { ...base, reaction_sec: start.t - call.t_sec, start_sec: start.t };
  if (!k || k.d <= o.away_m) return { ...r, status: 'short' };
  const retT = ret ? ret.t : tEnd;
  return { ...r, status: 'ok', touch_sec: k.t, return_sec: retT, out_sec: k.t - start.t, back_sec: retT - k.t, rep_sec: retT - call.t_sec,
    returned: !!ret, touch_m: k.pt, touch_corner: cornerOf(k.pt), corner_ok: cornerOf(k.pt) === call.corner };
}

// Sets from segmentSets -> same sets with per-call results and per-set statistics:
// {start_sec, end_sec, calls, n_calls, reps (status ok), reaction, out, back, rep (means; null if none), corner_pct (corner_ok share of reps)}.
export function detectIntervals(track, sets, t, o) {
  return sets.map(st => {
    const calls = st.calls.map((c, i) => detectCall(track, c, st.calls[i + 1]?.t_sec ?? st.end_sec, t, o));
    const ok = calls.filter(c => c.status === 'ok'), m = k => meanOf(ok.map(c => c[k]));
    return { start_sec: st.start_sec, end_sec: st.end_sec, calls, n_calls: calls.length, reps: ok.length,
      reaction: meanOf(calls.filter(c => c.reaction_sec != null).map(c => c.reaction_sec)), out: m('out_sec'), back: m('back_sec'), rep: m('rep_sec'),
      corner_pct: ok.length ? ok.filter(c => c.corner_ok).length / ok.length * 100 : null };
  });
}

// Slow-down over the sets in percent of the early time (positive = slower): (mean rep_sec late - early) / early x 100.
// 4+ sets: first 2 vs last 2 sets; 2-3 sets: first vs last floor(n/2) sets (a middle set is left out); 1 set: its first vs second half of the calls.
export function dropOff(sets) {
  const reps = ss => ss.flatMap(s => s.calls).filter(c => c.status === 'ok').map(c => c.rep_sec);
  const n = sets.length;
  let a, b;
  if (n >= 4) { a = reps(sets.slice(0, 2)); b = reps(sets.slice(-2)); }
  else if (n >= 2) { const h = n >> 1; a = reps(sets.slice(0, h)); b = reps(sets.slice(n - h)); }
  else if (n === 1) { const c = sets[0].calls, h = c.length >> 1; a = reps([{ calls: c.slice(0, h) }]); b = reps([{ calls: c.slice(c.length - h) }]); }
  else return null;
  const x = meanOf(a), y = meanOf(b);
  return x && y != null ? (y - x) / x * 100 : null;
}

// Whole-session summary of detectIntervals output: {sets, calls, reps, missed, reaction, back, out, rep, corner_pct, drop_off_pct}.
export function summarizeIntervals(sets) {
  const calls = sets.flatMap(s => s.calls), ok = calls.filter(c => c.status === 'ok');
  return { sets: sets.length, calls: calls.length, reps: ok.length, missed: calls.filter(c => c.status === 'missed').length,
    reaction: meanOf(calls.filter(c => c.reaction_sec != null).map(c => c.reaction_sec)), out: meanOf(ok.map(c => c.out_sec)), back: meanOf(ok.map(c => c.back_sec)), rep: meanOf(ok.map(c => c.rep_sec)),
    corner_pct: ok.length ? ok.filter(c => c.corner_ok).length / ok.length * 100 : null, drop_off_pct: dropOff(sets) };
}

// ---- drawing on the video overlay ----

// Court lines + T circle projected into the video (Hinv: metres -> pixels), translucent so the real floor stays visible.
export function drawCourtLines(ctx, H, Hinv, tRadius) {
  const lw = Math.max(2, H / 300), path = (pts, close) => {
    ctx.beginPath(); let pen = false;
    for (const p of pts) { const q = applyH(Hinv, p); if (!q) { pen = false; continue; } pen ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); pen = true; }
    if (close) ctx.closePath();
  };
  ctx.lineCap = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(255,70,50,.6)';
  for (const [a, b] of COURT_LINES) {
    path(Array.from({ length: 21 }, (_, i) => [a[0] + (b[0] - a[0]) * i / 20, a[1] + (b[1] - a[1]) * i / 20]), false); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,212,0,.75)';
  path(Array.from({ length: 48 }, (_, i) => [T[0] + tRadius * Math.cos(i / 48 * 2 * Math.PI), T[1] + tRadius * Math.sin(i / 48 * 2 * Math.PI)]), true); ctx.stroke();
}

// Numbered dots for the points the user has clicked: clicks = [{id, px}]; the number is the wizard number (CAL_ORDER).
export function drawCalPoints(ctx, H, clicks) {
  const r = Math.max(7, H / 90), fs = Math.round(r * 1.7);
  ctx.font = `700 ${fs}px "Segoe UI", sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  clicks.forEach(c => {
    ctx.fillStyle = 'rgba(0,216,255,.85)'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(c.px[0], c.px[1], r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#000'; ctx.fillText(String(CAL_ORDER.indexOf(c.id) + 1), c.px[0], c.px[1] + 1);
  });
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}

// ---- court pictures (SVG markup, top-down, front wall at the top; shared by the movement map and the two guides) ----

// Court floor, T circle, lines and the front/back wall labels. pad moves the back-wall label down (the guides draw big dots there).
export function courtSvg(tRadius, pad = 0) {
  return `<rect x="0" y="0" width="${COURT.width}" height="${COURT.length}" fill="#efe6cf"/>` +
    `<circle cx="${T[0]}" cy="${T[1]}" r="${tRadius}" fill="rgba(60,140,200,.22)" stroke="#3c8cc8" stroke-width=".04"/>` +
    COURT_LINES.map(([a, b]) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#c0392b" stroke-width=".06"/>`).join('') +
    `<text x="${T[0]}" y="-.12" font-size=".32" fill="#555" text-anchor="middle">앞벽</text><text x="${T[0]}" y="${COURT.length + .36 + pad}" font-size=".32" fill="#555" text-anchor="middle">뒷벽</text>`;
}

const dot = (p, r, fill, stroke, label, fs = r * 1.3, fg = '#000') =>
  `<circle cx="${p[0]}" cy="${p[1]}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width=".06"/>` +
  (label == null ? '' : `<text x="${p[0]}" y="${p[1] + fs * .36}" font-size="${fs}" font-weight="700" fill="${fg}" text-anchor="middle">${label}</text>`);

// Calibration guide: the 10 numbered marks. state = {done: Set(ids clicked), skipped: Set(ids), current: id | null}.
// current = big yellow pulsing dot, done = green check, skipped = gray, pending = white (8-10 paler: optional).
export function calGuideSvg(tRadius, { done = new Set(), skipped = new Set(), current = null } = {}) {
  const at = id => COURT_POINTS.find(p => p.id === id).m;
  let g = courtSvg(tRadius, .55), top = '';
  CAL_ORDER.forEach((id, i) => {
    const p = at(id), n = i + 1;
    if (id === current) top = `<circle cx="${p[0]}" cy="${p[1]}" r=".75" fill="#ffd400" stroke="#000" stroke-width=".07"><animate attributeName="r" values=".6;.95;.6" dur="1s" repeatCount="indefinite"/></circle>` +
      `<text x="${p[0]}" y="${p[1] + .3}" font-size=".85" font-weight="700" fill="#000" text-anchor="middle">${n}</text>`;
    else if (done.has(id)) g += dot(p, .45, '#2e9e5b', '#145c33') + `<path d="M${p[0] - .22} ${p[1]}l.15 .17l.3 -.36" fill="none" stroke="#fff" stroke-width=".1" stroke-linecap="round" stroke-linejoin="round"/>`;
    else if (skipped.has(id)) g += dot(p, .4, '#9aa4b2', '#5b6470', n, .5, '#fff');
    else g += `<g opacity="${i < CAL_REQUIRED ? 1 : .6}">${dot(p, .4, '#fff', '#222', n, .5)}</g>`;
  });
  return g + top;
}

// Ghosting guide: the 6 corners in test order (numbers from CORNERS) with a dashed line from T to each. Touch spots are the
// typical depths used by cornerOf (AI-set, not a coach number).
const TOUCH = { front_left: [.8, TOUCH_FRONT], front_right: [COURT.width - .8, TOUCH_FRONT], side_left: [.5, COURT.shortLine], side_right: [COURT.width - .5, COURT.shortLine],
  back_left: [.8, TOUCH_BACK], back_right: [COURT.width - .8, TOUCH_BACK] };
export function ghostGuideSvg(tRadius) {
  let g = courtSvg(tRadius, .55);
  g += CORNERS.map(c => `<line x1="${T[0]}" y1="${T[1]}" x2="${TOUCH[c][0]}" y2="${TOUCH[c][1]}" stroke="#3c8cc8" stroke-width=".09" stroke-dasharray=".3 .22"/>`).join('');
  g += CORNERS.map((c, i) => dot(TOUCH[c], .5, '#ffd400', '#000', i + 1, .6)).join('');
  return g + dot(T, .38, '#3c8cc8', '#fff', 'T', .45, '#fff');
}
