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

// Pixel point under the player: for each foot the heel (29/30) if visible, else the ankle (27/28); mean of the feet
// that have one. null if no foot is visible. lm = normalized landmarks.
export function footPoint(lm, W, H, minVis = 0.5) {
  const ok = i => lm[i] && (lm[i].visibility ?? 1) >= minVis;
  const feet = [[29, 27], [30, 28]].map(([heel, ankle]) => ok(heel) ? heel : ok(ankle) ? ankle : null).filter(i => i != null);
  if (!feet.length) return null;
  return [feet.reduce((s, i) => s + lm[i].x, 0) / feet.length * W, feet.reduce((s, i) => s + lm[i].y, 0) / feet.length * H];
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

// Which of 6 ghosting zones a court point is in: nearest touch row by depth. Typical touch depths (AI-set, not a
// coach number): front corner ~1.0 m, side touch at the side wall ~short line (5.44), back corner ~8.75 m. Splitting at
// the midpoints keeps a side touch made just in front of the short line out of "front". Left = x < 3.20 (T line = right).
// ponytail: fixed depths; tune ROW_SPLIT if real ghosting footage puts touches elsewhere.
const ROW_SPLIT = [(1.0 + COURT.shortLine) / 2, (COURT.shortLine + 8.75) / 2]; // 3.22, 7.10
export function cornerOf(p) {
  const row = p[1] < ROW_SPLIT[0] ? 'front' : p[1] < ROW_SPLIT[1] ? 'side' : 'back';
  return `${row}_${p[0] < COURT.tX ? 'left' : 'right'}`;
}

// Corner visits ("ghosting"): the player is at T (within t_radius_m), goes farther than away_m, and comes back within
// t_radius_m. start = first sample outside t_radius_m after being at T, far = the sample farthest from T, return = first
// sample back inside t_radius_m. Visits shorter than min_away_sec (start -> return) are tracking noise and dropped; a visit
// that never returns, or a track that starts away from T, is not counted. Samples with no position are skipped.
// track: [{t, p}]; o: {t_radius_m, away_m, min_away_sec}.
// Returns [{start_sec, far_sec, return_sec, duration_sec, corner, far_m, far_dist_m}].
export function detectExcursions(track, t, o) {
  const out = [];
  let home = false, leave = null, cur = null;
  for (const s of track) {
    if (!s.p) continue;
    const d = dist(s.p, t);
    if (d <= o.t_radius_m) {
      if (cur && s.t - cur.start.t >= o.min_away_sec - 1e-9) out.push({
        start_sec: cur.start.t, far_sec: cur.far.t, return_sec: s.t, duration_sec: s.t - cur.start.t,
        corner: cornerOf(cur.far.p), far_m: cur.far.p, far_dist_m: cur.fd,
      });
      home = true; leave = null; cur = null;
    } else {
      if (home && !leave) leave = s;
      if (leave && !cur && d > o.away_m) cur = { start: leave, far: s, fd: d };
      if (cur && d > cur.fd) { cur.far = s; cur.fd = d; }
    }
  }
  return out;
}

// Per-corner count and mean duration of excursions -> {corner: {n, avg_sec|null}} for all 6 corners.
export function cornerAvg(ex) {
  return Object.fromEntries(CORNERS.map(c => {
    const d = ex.filter(e => e.corner === c).map(e => e.duration_sec);
    return [c, { n: d.length, avg_sec: d.length ? d.reduce((a, b) => a + b, 0) / d.length : null }];
  }));
}

// The slowest corner (largest mean duration) or null if there are no visits.
export const slowestCorner = avg => CORNERS.filter(c => avg[c].n).reduce((p, c) => p == null || avg[c].avg_sec > avg[p].avg_sec ? c : p, null);

// Seconds from the first departure to the last return, null if no visits.
export const totalSec = ex => ex.length ? ex[ex.length - 1].return_sec - ex[0].start_sec : null;

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

// Numbered dots for the points the user has clicked: clicks = [{id, px}].
export function drawCalPoints(ctx, H, clicks) {
  const r = Math.max(7, H / 90), fs = Math.round(r * 1.7);
  ctx.font = `700 ${fs}px "Segoe UI", sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  clicks.forEach((c, i) => {
    ctx.fillStyle = 'rgba(0,216,255,.85)'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(c.px[0], c.px[1], r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#000'; ctx.fillText(String(i + 1), c.px[0], c.px[1] + 1);
  });
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}
