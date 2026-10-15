// Pose loading, person tracking, drawing and shared settings for app/index.html and app/compare.html.
import { poseAngles, poseAngles3, frontSide, JOINTS } from './angles.mjs';

export const MP_VERSION = '1.1.0';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
export const COLORS = ['#00d8ff', '#ff9f1c'];
export const MODE_LABEL = { '2d': '2D 화면', '3d': '3D 추정' };

// runningMode: 'VIDEO' (detectForVideo, needs increasing timestamps) or 'IMAGE' (detect, stateless).
export async function loadPose(runningMode) {
  const { FilesetResolver, PoseLandmarker } = await import(`${CDN}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  const make = delegate => PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: new URL('./models/pose_landmarker_full.task', import.meta.url).href, delegate },
    runningMode, numPoses: 2,
  });
  let landmarker;
  try { landmarker = await make('GPU'); } catch { landmarker = await make('CPU'); }
  return { landmarker, connections: PoseLandmarker.POSE_CONNECTIONS.filter(c => c.start >= 11 && c.end >= 11) };
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
  let prev = null;
  const center = o => ({ x: (o.lm[23].x + o.lm[24].x) / 2, y: (o.lm[23].y + o.lm[24].y) / 2 });
  const d = (a, b) => (a && b) ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  return {
    reset() { prev = null; },
    assign(list) {
      let out = [list[0] || null, list[1] || null];
      if (prev) {
        const c = out.map(o => o && center(o));
        const keep = d(c[0], prev[0]) + d(c[1], prev[1]);
        const swap = d(c[0], prev[1]) + d(c[1], prev[0]);
        if (list.length === 1 && prev[1] && (!prev[0] || d(c[0], prev[1]) < d(c[0], prev[0]))) out = [null, out[0]];
        else if (list.length === 2 && swap < keep) out = [out[1], out[0]];
      }
      prev = out.map((o, i) => o ? center(o) : prev?.[i] || null);
      return out;
    },
  };
}

export function drawSkeleton(ctx, W, H, lm, color, selected, connections) {
  const lw = Math.max(4, H / 130) * (selected ? 1.3 : 1);
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
}

// Arc + label at the knee. Arc geometry is always the 2D screen angle; the label shows `deg` (2D or 3D value).
export function drawKnee(ctx, W, H, lm, key, color, deg) {
  if (deg == null) return;
  const [a, b, c] = JOINTS[key].map(i => ({ x: lm[i].x * W, y: lm[i].y * H }));
  const r = H / 14, t1 = Math.atan2(a.y - b.y, a.x - b.x);
  let diff = Math.atan2(c.y - b.y, c.x - b.x) - t1;
  if (diff > Math.PI) diff -= 2 * Math.PI; if (diff < -Math.PI) diff += 2 * Math.PI;
  ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.arc(b.x, b.y, r, t1, t1 + diff, diff < 0); ctx.closePath();
  ctx.fillStyle = 'rgba(255,212,0,.35)'; ctx.fill();
  ctx.beginPath(); ctx.arc(b.x, b.y, r, t1, t1 + diff, diff < 0);
  ctx.strokeStyle = '#ffd400'; ctx.lineWidth = Math.max(4, H / 150); ctx.stroke();
  // label on the outside of the knee (opposite the angle's bisector)
  const mid = t1 + diff / 2 + Math.PI, fs = Math.round(H / 16);
  const text = `${key.endsWith('_l') ? 'L' : 'R'} ${Math.round(deg)}°`;
  ctx.font = `700 ${fs}px "Segoe UI", sans-serif`;
  const tw = ctx.measureText(text).width, pad = fs * 0.3;
  let x = b.x + Math.cos(mid) * r * 1.5 - tw / 2, y = b.y + Math.sin(mid) * r * 1.5 - fs / 2;
  x = Math.max(4, Math.min(x, W - tw - 2 * pad - 4)); y = Math.max(4, Math.min(y, H - fs - 2 * pad - 4));
  ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(x, y, tw + 2 * pad, fs + 2 * pad);
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, H / 360); ctx.strokeRect(x, y, tw + 2 * pad, fs + 2 * pad);
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'top'; ctx.fillText(text, x + pad, y + pad * 1.1);
}

// Top-left tag so a screen recording or saved PNG always shows which angle mode produced the numbers.
export function drawBadge(ctx, H, text) {
  const fs = Math.round(H / 30), pad = fs * 0.35;
  ctx.font = `700 ${fs}px "Segoe UI", sans-serif`; ctx.textBaseline = 'top';
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(pad, pad, tw + 2 * pad, fs + 2 * pad);
  ctx.fillStyle = '#ffd400'; ctx.fillText(text, 2 * pad, 2 * pad * 0.9);
}

// Settings shared by both pages (per-viewer convenience; works without storage).
export function loadSetting(key, def) {
  try { return localStorage.getItem('sqc_' + key) || def; } catch { return def; }
}
export function saveSetting(key, val) {
  try { localStorage.setItem('sqc_' + key, val); } catch { /* ignore */ }
}
