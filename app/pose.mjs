// Pose loading, person tracking, drawing and shared settings for app/index.html and app/compare.html.
import { poseAngles, poseAngles3, frontSide, JOINTS } from './angles.mjs';

export const MP_VERSION = '1.1.0';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
export const COLORS = ['#00d8ff', '#ff9f1c'];
export const MODE_LABEL = { '2d': '2D 화면', '3d': '3D 추정' };

// runningMode: 'VIDEO' (detectForVideo, needs increasing timestamps) or 'IMAGE' (detect, stateless).
export async function loadPose(runningMode, numPoses = 2) {
  const { FilesetResolver, PoseLandmarker } = await import(`${CDN}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  const make = delegate => PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: new URL('./models/pose_landmarker_full.task', import.meta.url).href, delegate },
    runningMode, numPoses,
  });
  let landmarker;
  let delegate = 'GPU';
  try { landmarker = await make('GPU'); } catch { delegate = 'CPU'; landmarker = await make('CPU'); }
  return { landmarker, delegate, connections: PoseLandmarker.POSE_CONNECTIONS.filter(c => c.start >= 11 && c.end >= 11) };
}

// Recovery landmarkers (IMAGE mode, same model), one per numPoses, created on first use. Never switch numPoses with setOptions:
// MediaPipe rebuilds the graph on every setOptions (~250 ms per call measured on IMG_1232, 5 min -> 56 min analysis).
const imgLm = {};
export const getImageLandmarker = n => imgLm[n] ||= loadPose('IMAGE', n).then(r => r.landmarker);

// ---- missed-person recovery (pure helpers; measured with the Python port: 2 people in 29.9% -> 75.1% of game frames) ----
// Crop around a person's last landmarks: ~2.5x their bounding box (min 12% of the frame height), clamped. -> {x, y, w, h} px.
export function cropRect(lm, W, H) {
  const xs = lm.map(q => q.x * W), ys = lm.map(q => q.y * H), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, s = Math.max(x1 - x0, y1 - y0, 0.12 * H) * 1.25;
  const X0 = Math.round(Math.max(0, cx - s)), Y0 = Math.round(Math.max(0, cy - s)), X1 = Math.round(Math.min(W, cx + s)), Y1 = Math.round(Math.min(H, cy + s));
  return { x: X0, y: Y0, w: Math.max(1, X1 - X0), h: Math.max(1, Y1 - Y0) };
}
// 3x2 overlapping tiles, each 50% wide x 60% high.
export const gridRects = (W, H) => [0, 0.25, 0.5].flatMap(xa => [0, 0.4].map(ya => ({ x: Math.round(xa * W), y: Math.round(ya * H), w: Math.round(0.5 * W), h: Math.round(0.6 * H) })));
// Upscale factor so the short side of a crop reaches minShort (never shrinks).
export const cropScale = (r, minShort) => Math.max(1, minShort / Math.min(r.w, r.h));
// Landmarks found in a crop (normalized to the crop) -> normalized to the full frame.
export const mapBack = (lm, r, W, H) => lm.map(q => ({ ...q, x: (r.x + q.x * r.w) / W, y: (r.y + q.y * r.h) / H }));
// Same person = hip centres closer than 5% of the frame width; of two copies the more visible one stays. Order: first seen first.
export function mergePeople(list, W, H) {
  const hip = p => [(p.lm[23].x + p.lm[24].x) / 2 * W, (p.lm[23].y + p.lm[24].y) / 2 * H];
  const score = p => p.lm.reduce((a, q) => a + (q.visibility ?? 1), 0) / p.lm.length;
  const out = [];
  for (const p of list) {
    const h = hip(p), j = out.findIndex(q => Math.hypot(h[0] - hip(q)[0], h[1] - hip(q)[1]) < 0.05 * W);
    if (j < 0) out.push(p); else if (score(p) > score(out[j])) out[j] = p;
  }
  return out;
}

// MediaPipe result -> [{lm: normalized landmarks, wl: world landmarks|null}]
export const toPeople = r => (r.landmarks || []).map((lm, i) => ({ lm, wl: r.worldLandmarks?.[i] || null }));

// Angles of one person {lm, wl} in the given mode; {} if nobody. `front` ('l'|'r'|null) is always the 2D
// front-leg decision, even in 3D mode (only the values are 3D).
export function personAngles(p, mode, W, H) {
  if (!p) return {};
  const a = mode === '3d' ? (p.wl ? poseAngles3(p.wl, p.lm) : {}) : poseAngles(p.lm, W, H);
  a.front = frontSide(p.lm, W, H);
  return a;
}

// Keep person 1/2 stable across frames: match by hip center to the previous frame.
// ponytail: nearest-center matching only; breaks when players cross. Add re-id if that matters.
export function createTracker() {
  let prev = null, seen = [0, 0];
  const center = o => ({ x: (o.lm[23].x + o.lm[24].x) / 2, y: (o.lm[23].y + o.lm[24].y) / 2 });
  const d = (a, b) => (a && b) ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  return {
    reset() { prev = null; seen = [0, 0]; },
    assign(list) {
      let out = [list[0] || null, list[1] || null];
      if (prev) {
        const c = out.map(o => o && center(o));
        const keep = d(c[0], prev[0]) + d(c[1], prev[1]);
        const swap = d(c[0], prev[1]) + d(c[1], prev[0]);
        // A lone detection only moves to slot 2 if slot 2 is an established person. A few false second detections
        // (glass reflection, a split skeleton) used to leave a stale slot 2 that captured the real player after an
        // occlusion gap: 1-person ghosting video lost 7 of 18 visits (2026-10-16, IMG_1222).
        // ponytail: fixed 20% share; a real game where one player is rarely visible would need a smarter rule.
        const est = seen[1] >= 0.2 * seen[0];
        if (list.length === 1 && prev[1] && est && (!prev[0] || d(c[0], prev[1]) < d(c[0], prev[0]))) out = [null, out[0]];
        else if (list.length === 2 && swap < keep) out = [out[1], out[0]];
      }
      out.forEach((o, i) => { if (o) seen[i]++; });
      prev = out.map((o, i) => o ? center(o) : prev?.[i] || null);
      return out;
    },
  };
}

// opt.thin = thinner lines (the opponent), opt.label = small tag above the head (e.g. 나).
export function drawSkeleton(ctx, W, H, lm, color, selected, connections, opt = {}) {
  const lw = Math.max(4, H / 130) * (selected ? 1.3 : 1) * (opt.thin ? 0.55 : 1);
  ctx.lineCap = 'round';
  ctx.globalAlpha = selected ? 1 : 0.75;
  for (const { start, end } of connections) {
    ctx.beginPath(); ctx.moveTo(lm[start].x * W, lm[start].y * H); ctx.lineTo(lm[end].x * W, lm[end].y * H);
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = lw + 4; ctx.stroke(); // dark outline: readable on bright walls
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  for (let i = 11; i < lm.length; i++) { ctx.beginPath(); ctx.arc(lm[i].x * W, lm[i].y * H, lw * 0.9, 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1;
  if (opt.label) {
    const fs = Math.round(H / 28), x = lm[0].x * W, y = lm[0].y * H - fs * 1.4;
    ctx.font = `700 ${fs}px "Segoe UI", "Apple SD Gothic Neo", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(opt.label).width + fs * 0.7;
    ctx.fillStyle = color; ctx.fillRect(x - w / 2, y - fs * 0.65, w, fs * 1.3);
    ctx.fillStyle = '#000'; ctx.fillText(opt.label, x, y + 1);
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }
}

// Knee label boxes: pure layout so L and R labels never overlap. items: [{bx, by (knee, px), cx (body centre x, px),
// w, h (box size), r (arc radius)}]. Each box goes on the outside of its knee (away from the body centre, `cx`),
// clamped into the frame; if it still hits an earlier box it moves up or down to the nearest free spot.
// Returns [{x, y}] top-left corners, same order as items.
export function layoutLabels(items, W, H, gap = 4) {
  const placed = [], m = 4;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const hit = (a, b) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
  return items.map(it => {
    const x = clamp(it.bx >= it.cx ? it.bx + it.r * 1.2 : it.bx - it.r * 1.2 - it.w, m, W - it.w - m);
    const y0 = clamp(it.by - it.h / 2, m, H - it.h - m);
    const free = y => y >= m && y <= H - it.h - m && !placed.some(j => hit({ x, y, w: it.w, h: it.h }, j));
    const cand = [y0, ...placed.flatMap(j => [j.y + j.h + gap, j.y - it.h - gap])].filter(free);
    const y = cand.length ? cand.reduce((p, c) => Math.abs(c - y0) < Math.abs(p - y0) ? c : p) : y0;
    placed.push({ x, y, w: it.w, h: it.h });
    return { x, y };
  });
}

// Arcs at both knees + their angle labels. Arc geometry is always the 2D screen angle; the label shows degs[key]
// (2D or 3D value, null = nothing drawn). Labels sit outside the knee and are kept apart by layoutLabels.
export function drawKnees(ctx, W, H, lm, color, degs) {
  const r = H / 14, fs = Math.round(H / 16), pad = fs * 0.3, items = [];
  ctx.font = `700 ${fs}px "Segoe UI", sans-serif`;
  const cx = (lm[23].x + lm[24].x) / 2 * W;
  for (const key of ['knee_l', 'knee_r']) {
    const deg = degs[key];
    if (deg == null) continue;
    const [a, b, c] = JOINTS[key].map(i => ({ x: lm[i].x * W, y: lm[i].y * H }));
    const t1 = Math.atan2(a.y - b.y, a.x - b.x);
    let diff = Math.atan2(c.y - b.y, c.x - b.x) - t1;
    if (diff > Math.PI) diff -= 2 * Math.PI; if (diff < -Math.PI) diff += 2 * Math.PI;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.arc(b.x, b.y, r, t1, t1 + diff, diff < 0); ctx.closePath();
    ctx.fillStyle = 'rgba(255,212,0,.35)'; ctx.fill();
    ctx.beginPath(); ctx.arc(b.x, b.y, r, t1, t1 + diff, diff < 0);
    ctx.strokeStyle = '#ffd400'; ctx.lineWidth = Math.max(4, H / 150); ctx.stroke();
    const text = `${key.endsWith('_l') ? 'L' : 'R'} ${Math.round(deg)}°`;
    items.push({ text, bx: b.x, by: b.y, cx, w: ctx.measureText(text).width + 2 * pad, h: fs + 2 * pad, r });
  }
  layoutLabels(items, W, H).forEach(({ x, y }, i) => {
    const it = items[i];
    ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(x, y, it.w, it.h);
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, H / 360); ctx.strokeRect(x, y, it.w, it.h);
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'top'; ctx.fillText(it.text, x + pad, y + pad * 1.1);
  });
}

// Top-left tag so a screen recording or saved PNG always shows which angle mode produced the numbers.
export function drawBadge(ctx, H, text) {
  const fs = Math.round(H / 30), pad = fs * 0.35;
  ctx.font = `700 ${fs}px "Segoe UI", sans-serif`; ctx.textBaseline = 'top';
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(pad, pad, tw + 2 * pad, fs + 2 * pad);
  ctx.fillStyle = '#ffd400'; ctx.fillText(text, 2 * pad, 2 * pad * 0.9);
}

// Checkpoint box under the badge (top-left) so screen recordings and saved PNGs show the verdicts.
// rows: [{name, val, tgt, color}]; val is drawn bold in `color`, tgt (target text, may be '') dim after it.
// Font size follows the short side so portrait clips do not get a giant box. Long names are cut with an ellipsis.
// right = draw in the top-right corner (used when the player stands on the left half).
export function drawCheckpoints(ctx, W, H, title, rows, right = false) {
  const fs = Math.round(Math.min(W, H) / 51), pad = fs * 0.45, lh = fs * 1.4, dot = fs * 0.45;
  const font = (bold) => `${bold ? 700 : 400} ${fs}px "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  const w = (t, bold) => { ctx.font = font(bold); return ctx.measureText(t).width; };
  const cut = (t, max) => { while (t.length > 1 && w(t, true) > max) t = t.slice(0, -2) + '…'; return t; };
  const names = rows.map(r => cut(r.name, W * 0.3));
  const nameW = Math.max(w(title, true) - dot * 3, ...names.map(n => w(n, true)));
  const valW = Math.max(0, ...rows.map(r => w(r.val, true) + (r.tgt ? w(' / ' + r.tgt, false) : 0)));
  const boxW = pad * 2 + dot * 3 + nameW + fs + valW, boxH = pad * 2 + lh * (rows.length + 1);
  const m = H / 30 * 0.35, x0 = right ? W - boxW - m : m, y0 = H / 30 * 2.4;
  ctx.fillStyle = 'rgba(0,0,0,.62)'; ctx.fillRect(x0, y0, boxW, boxH);
  ctx.fillStyle = '#ffd400'; ctx.font = font(true); ctx.fillText(title, x0 + pad, y0 + pad + lh / 2);
  rows.forEach((r, i) => {
    const y = y0 + pad + lh * (i + 1.5);
    ctx.fillStyle = r.color; ctx.beginPath(); ctx.arc(x0 + pad + dot, y, dot, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = font(true); ctx.fillText(names[i], x0 + pad + dot * 3, y);
    const vx = x0 + pad + dot * 3 + nameW + fs;
    ctx.fillStyle = r.color; ctx.fillText(r.val, vx, y);
    if (r.tgt) { ctx.fillStyle = '#c9d1db'; ctx.font = font(false); ctx.fillText(' / ' + r.tgt, vx + w(r.val, true), y); }
  });
  ctx.textBaseline = 'alphabetic';
}

// Settings shared by both pages (per-viewer convenience; works without storage).
export function loadSetting(key, def) {
  try { return localStorage.getItem('sqc_' + key) || def; } catch { return def; }
}
export function saveSetting(key, val) {
  try { localStorage.setItem('sqc_' + key, val); } catch { /* ignore */ }
}
