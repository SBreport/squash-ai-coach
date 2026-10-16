// Who is "나" in a two-player video. Pure math, shared by app/index.html and tests/check.mjs.
// The analysis stores every detected person per frame without an order ({c, hist}); this module decides afterwards which one is
// me and which is the opponent, from position continuity plus clothing colour, and finds the stretches where the two overlap.
// c = hip centre, normalized [x, y]; hist = colour histogram (colorHist) or null.

export const H_BINS = 8, S_BINS = 3, V_BINS = 4, HIST_LEN = H_BINS * S_BINS * V_BINS;
const GRAY_S = 0.15; // below this saturation the hue is noise (black, white, grey): all such pixels share hue bin 0

// Normalized HSV histogram (H 8 x S 3 x V 4) of RGB pixels. data = flat [r, g, b, r, g, b, ...] (stride 3) or RGBA
// (stride 4, e.g. ImageData.data), values 0..255. null if there are fewer than `min` pixels.
export function colorHist(data, stride = 4, min = 1) {
  const h = new Float32Array(HIST_LEN);
  let n = 0;
  for (let i = 0; i + 2 < data.length; i += stride) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b), s = mx ? d / mx : 0;
    let hue = 0;
    if (d && s >= GRAY_S) { hue = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hue /= 6; }
    const hb = s < GRAY_S ? 0 : Math.min(H_BINS - 1, Math.floor(hue * H_BINS));
    const sb = s < GRAY_S ? 0 : Math.min(S_BINS - 1, Math.floor(s * S_BINS));
    const vb = Math.min(V_BINS - 1, Math.floor(mx * V_BINS));
    h[(hb * S_BINS + sb) * V_BINS + vb]++; n++;
  }
  if (n < min || !n) return null;
  for (let i = 0; i < HIST_LEN; i++) h[i] /= n;
  return h;
}

// Histogram intersection: 1 = identical, 0 = nothing in common. null if either is missing.
export function histSim(a, b) {
  if (!a || !b) return null;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i]);
  return s;
}

// Colour histogram of one person's clothes from a video frame: the torso (shoulders 11/12, hips 23/24, shrunk to 75% so the
// background at the edges stays out) and each upper leg whose knee is visible (hip -> knee 23-25, 24-26, a band 0.6 x half the hip
// width to each side). img = {data (RGBA), width, height} (e.g. a 320 px wide canvas's ImageData), lm = normalized landmarks.
// null if a torso landmark is not visible or fewer than `minPx` pixels fall into the regions (off screen, too small).
export function personHist(img, lm, minVis = 0.5, minPx = 40) {
  const ok = i => lm[i] && (lm[i].visibility ?? 1) >= minVis;
  if (![11, 12, 23, 24].every(ok)) return null;
  const legL = ok(25), legR = ok(26), { data, width: W, height: H } = img, P = i => [lm[i].x * W, lm[i].y * H];
  const [s1, s2, h2, h1, k1, k2] = [11, 12, 24, 23, 25, 26].map(P);
  const cx = (s1[0] + s2[0] + h1[0] + h2[0]) / 4, cy = (s1[1] + s2[1] + h1[1] + h2[1]) / 4;
  const quad = [s1, s2, h2, h1].map(([x, y]) => [cx + (x - cx) * 0.75, cy + (y - cy) * 0.75]);
  const hw = Math.hypot(h1[0] - h2[0], h1[1] - h2[1]) / 2 * 0.6;
  const cross = (a, b, x, y) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
  const inQuad = (x, y) => { const c = quad.map((q, i) => cross(q, quad[(i + 1) % 4], x, y)); return c.every(v => v >= 0) || c.every(v => v <= 0); };
  const inSeg = (a, b, x, y) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L)) : 0;
    return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) <= hw;
  };
  const pts = [...quad, h1, h2, ...(legL ? [k1] : []), ...(legR ? [k2] : [])], x0 = Math.max(0, Math.floor(Math.min(...pts.map(q => q[0])) - hw)), x1 = Math.min(W - 1, Math.ceil(Math.max(...pts.map(q => q[0])) + hw));
  const y0 = Math.max(0, Math.floor(Math.min(...pts.map(q => q[1])) - hw)), y1 = Math.min(H - 1, Math.ceil(Math.max(...pts.map(q => q[1])) + hw));
  const rgb = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
    if (inQuad(x + 0.5, y + 0.5) || (legL && inSeg(h1, k1, x + 0.5, y + 0.5)) || (legR && inSeg(h2, k2, x + 0.5, y + 0.5))) { const i = (y * W + x) * 4; rgb.push(data[i], data[i + 1], data[i + 2]); }
  return colorHist(rgb, 3, minPx);
}

export const IDENTITY_DEFAULTS = {
  w_pos: 1, w_col: 1, overlap_dist: 0.08, ema: 0.05,
  aspect: 16 / 9,        // video width / height: normalized x and y are different units
  conf_scale: 0.4,       // cost margin that counts as fully sure (conf 1)
  conf_low: 0.25,        // conf below this = overlap
  update_conf: 0.5,      // colour reference is only refreshed when conf is at least this
  max_gap_sec: 4,        // 2 -> 1 -> 2 people only counts as an overlap if the dip is shorter than this
  merge_gap_sec: 1,      // overlaps closer than this are one
  two_share: 0.25,       // fewer frames than this with 2 people = a one-person video: no overlaps, and a lone detection is always me
  gap_decay_sec: 1,      // position evidence weakens with the time since the track was last seen
};

// Position distance, normalized by the screen diagonal (aspect-corrected).
export function posDist(a, b, aspect) { return Math.hypot((a[0] - b[0]) * aspect, a[1] - b[1]) / Math.hypot(aspect, 1); }

// frames: [{t, people: [{c, hist}]}] sorted by t. seed: {t, idx} = the person `idx` of the frame nearest to t is me.
// Walks from the seed frame to both ends. Each step picks the cheapest one-to-one assignment of my track and the opponent track
// to the detected people: w_pos * distance to the predicted position + w_col * (1 - colour similarity to the track's reference
// colour). References move slowly (EMA) and only on sure frames (both people apart, clear cost margin).
// Returns [{me: idx|null, opp: idx|null, conf: 0..1}] per frame.
export function assignTracks(frames, seed, opts = {}) {
  const o = { ...IDENTITY_DEFAULTS, ...opts }, out = new Array(frames.length);
  if (!frames.length) return out;
  const si = frames.reduce((b, f, i) => Math.abs(f.t - seed.t) < Math.abs(frames[b].t - seed.t) ? i : b, 0);
  const sp = frames[si].people, other = sp.length > 1 ? (seed.idx === 0 ? 1 : 0) : null;
  out[si] = { me: sp[seed.idx] ? seed.idx : null, opp: other, conf: 1 };
  const clamp01 = x => Math.max(0, Math.min(1, x));
  // A one-person video (few frames with 2 people): the second detections are false (glass reflection, split skeleton), so a lone detection is never given to the opponent.
  // (A per-pass 'opponent seen often enough' rule failed: right after the seed both counts are small.)
  const loneToOpp = frames.filter(f => f.people.length >= 2).length / frames.length >= o.two_share;
  const track = p => ({ pos: p ? p.c : null, vel: [0, 0], ref: p?.hist || null, t: frames[si].t });
  for (const dir of [1, -1]) {
    const T = { me: track(sp[seed.idx]), opp: track(other != null ? sp[other] : null) };
    for (let k = si + dir; k >= 0 && k < frames.length; k += dir) {
      const { t, people: P } = frames[k], n = P.length;
      const cost = (tr, p) => {
        const gap = Math.abs(t - tr.t), w = o.w_pos / (1 + gap / o.gap_decay_sec), dt = Math.min(gap, 0.5);
        const pred = tr.pos && [tr.pos[0] + tr.vel[0] * dt, tr.pos[1] + tr.vel[1] * dt];
        const sim = tr.ref && p.hist ? histSim(tr.ref, p.hist) : null;
        return w * (pred ? posDist(pred, p.c, o.aspect) : 0.1) + o.w_col * (sim == null ? 0.5 : 1 - sim);
      };
      // every valid assignment: each track gets a different person or none; as many people as possible are used
      const opts2 = [];
      for (let a = -1; a < n; a++) for (let b = -1; b < n; b++) {
        if (a === b && a >= 0) continue;
        if ((a >= 0) + (b >= 0) !== Math.min(2, n)) continue;
        if (n === 1 && b >= 0 && !loneToOpp) continue;
        opts2.push({ a, b, c: (a >= 0 ? cost(T.me, P[a]) : 0) + (b >= 0 ? cost(T.opp, P[b]) : 0) });
      }
      opts2.sort((x, y) => x.c - y.c);
      const best = opts2[0], conf = opts2.length > 1 ? clamp01((opts2[1].c - best.c) / o.conf_scale) : 1;
      out[k] = { me: best.a >= 0 ? best.a : null, opp: best.b >= 0 ? best.b : null, conf };
      const apart = n === 2 && posDist(P[0].c, P[1].c, o.aspect) >= o.overlap_dist && conf >= o.update_conf;
      for (const [key, idx] of [['me', best.a], ['opp', best.b]]) {
        if (idx < 0) continue;
        const tr = T[key], p = P[idx], dt = Math.abs(t - tr.t);
        if (tr.pos && dt > 0 && dt < 1) tr.vel = tr.vel.map((v, i) => 0.5 * v + 0.5 * (p.c[i] - tr.pos[i]) / dt);
        else tr.vel = [0, 0];
        tr.pos = p.c; tr.t = t;
        if (apart && p.hist) tr.ref = tr.ref ? Float32Array.from(tr.ref, (x, i) => (1 - o.ema) * x + o.ema * p.hist[i]) : p.hist;
      }
    }
  }
  return out;
}

// Stretches where "who is who" is uncertain: two people closer than overlap_dist, 2 -> fewer -> 2 people within max_gap_sec, or
// a low-confidence assignment. A one-person video (few frames with 2 people) has none. Marked frames closer than merge_gap_sec are
// joined. Returns [{start_t, end_t}] by time.
export function findOverlaps(frames, res, opts = {}) {
  const o = { ...IDENTITY_DEFAULTS, ...opts }, n = frames.length;
  if (!n || frames.filter(f => f.people.length >= 2).length / n < o.two_share) return [];
  const mark = new Array(n).fill(false);
  frames.forEach((f, i) => {
    if (f.people.length >= 2 && posDist(f.people[0].c, f.people[1].c, o.aspect) < o.overlap_dist) mark[i] = true;
    if (res[i] && res[i].conf < o.conf_low) mark[i] = true;
  });
  for (let a = 0; a < n; a++) {
    if (frames[a].people.length >= 2) continue;
    let b = a; while (b + 1 < n && frames[b + 1].people.length < 2) b++;
    if (a > 0 && b < n - 1 && frames[b + 1].t - frames[a - 1].t <= o.max_gap_sec) for (let i = a; i <= b; i++) mark[i] = true;
    a = b;
  }
  const out = [];
  frames.forEach((f, i) => {
    if (!mark[i]) return;
    const last = out[out.length - 1];
    if (last && f.t - last.end_t <= o.merge_gap_sec) last.end_t = f.t; else out.push({ start_t: f.t, end_t: f.t });
  });
  return out;
}

// The user's corrections: `swaps` = end times (seconds, from an overlap's end_t) after which me and opponent are exchanged
// until the next overlap starts. Returns a new res array. Frames inside an overlap keep the automatic result.
export function applySwaps(frames, res, overlaps, swaps) {
  const out = res.map(r => ({ ...r })), eps = 1e-6;
  for (const sec of swaps) {
    const i = overlaps.findIndex(v => Math.abs(v.end_t - sec) < eps);
    const to = i >= 0 && overlaps[i + 1] ? overlaps[i + 1].start_t : Infinity;
    frames.forEach((f, k) => { if (f.t > sec + eps && f.t < to - eps && out[k]) [out[k].me, out[k].opp] = [out[k].opp, out[k].me]; });
  }
  return out;
}
