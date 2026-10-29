// Cue tones for ghosting sets (docs/cue.html plays them) and the code that finds them again in a video's sound track.
//
// Tone plan (CUE_TONES, the single source of truth; docs/cue.html duplicates the table, keep both in sync):
//   * call tone = 250 ms sine, one fixed pitch per corner, 6 pitches 1000..3200 Hz, 440 Hz apart (far enough apart to
//     survive AAC and to be told apart by a 32 ms Goertzel window; ball hits and shoe squeaks are broadband/impulsive
//     or sweep through, so they never stay 150+ ms on one pitch).
//   * SET-START = two 150 ms beeps at 3700 Hz with a 100 ms gap, SET-END = one long low tone, 700 Hz for 700 ms.
//   * every tone has a 10 ms fade in/out (no click).
// Functions:
//   decodeVideoAudio(file|blob) -> {sampleRate, samples (mono Float32Array)} or {samples: null, reason}   (browser only)
//   findTones(samples, sampleRate, plan?, opts?) -> [{t_sec (onset), kind 'call'|'set_start'|'set_end', corner|null, score}]
//     Goertzel bank over 32 ms Hann windows every 10 ms. A band is "on" in a hop when its amplitude is >= opts.ratio (10)
//     times the mean power of 4 spectral neighbours (+-120, +-200 Hz) and >= opts.min_amp (0.003 = -50 dBFS). A run of on-hops
//     (gaps of up to 2 hops bridged) counts as a tone when it lasts >= opts.min_frac (0.6) of the nominal duration; the onset
//     is the run's middle minus half the nominal duration. Overlapping runs from different bands: the higher score wins.
//     score = log10 of the mean on-hop power ratio (about 1 = just passed, 3-4 = clean).
//   segmentSets(tones) -> [{start_sec, end_sec, calls: [{t_sec, corner}]}]  (a set runs from a set_start to the next
//     set_end; a missing end falls back to the last call, then to the start; calls outside any set are dropped)

export const CUE_TONES = {
  calls: { front_left: 1000, front_right: 1440, side_left: 1880, side_right: 2320, back_left: 2760, back_right: 3200 },
  call_ms: 250,
  set_start: { hz: 3700, ms: 150, gap_ms: 100, n: 2 },
  set_end: { hz: 700, ms: 700 },
  fade_ms: 10,
};

const NEIGH = [-200, -120, 120, 200]; // Hz offsets of the "noise floor" probes

// ---- browser: decode the audio track of a video file ----
// ponytail: reads the whole file into memory (fine for phone clips of a few hundred MB); stream the audio out with ffmpeg.wasm if not.
export async function decodeVideoAudio(file) {
  try {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return { samples: null, reason: 'AudioContext 없음' };
    const ctx = new Ctx();
    try {
      const buf = await ctx.decodeAudioData(await file.arrayBuffer());
      const n = buf.length, mono = new Float32Array(n);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels;
      }
      return { sampleRate: buf.sampleRate, samples: mono };
    } finally { ctx.close?.(); }
  } catch (e) { return { samples: null, reason: `소리 해독 실패: ${e?.message || e}` }; }
}

// ---- pure: tone finder ----
function goertzel(buf, n, f, sr) { // -> power
  const c = 2 * Math.cos(2 * Math.PI * f / sr);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) { const s0 = buf[i] + c * s1 - s2; s2 = s1; s1 = s0; }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}

export function findTones(samples, sr, plan = CUE_TONES, o = {}) {
  const win = Math.round((o.win_ms ?? 32) / 1000 * sr), hop = Math.round((o.hop_ms ?? 10) / 1000 * sr);
  const ratio = o.ratio ?? 10, minAmp = o.min_amp ?? 0.003, frac = o.min_frac ?? 0.6, gapMax = 2;
  const nh = Math.floor((samples.length - win) / hop) + 1;
  if (nh < 1) return [];
  const bands = [
    ...Object.entries(plan.calls).map(([corner, hz]) => ({ kind: 'call', corner, hz, ms: plan.call_ms })),
    { kind: 'set_start', corner: null, hz: plan.set_start.hz, ms: plan.set_start.ms },
    { kind: 'set_end', corner: null, hz: plan.set_end.hz, ms: plan.set_end.ms },
  ];
  const hann = new Float32Array(win);
  let sumw = 0;
  for (let i = 0; i < win; i++) sumw += hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / win);
  const k = 4 / (sumw * sumw); // power -> amplitude^2
  const buf = new Float32Array(win);
  for (const b of bands) { b.on = new Uint8Array(nh); b.pw = new Float32Array(nh); }
  for (let h = 0; h < nh; h++) {
    const o0 = h * hop;
    for (let i = 0; i < win; i++) buf[i] = samples[o0 + i] * hann[i];
    for (const b of bands) {
      const a2 = goertzel(buf, win, b.hz, sr) * k;
      if (a2 < minAmp * minAmp) continue;
      let nz = 0;
      for (const d of NEIGH) nz += goertzel(buf, win, b.hz + d, sr) * k;
      nz = nz / NEIGH.length + 1e-12;
      if (a2 >= ratio * nz) { b.on[h] = 1; b.pw[h] = a2 / nz; }
    }
  }
  // runs per band
  const runs = [];
  for (const b of bands) {
    let h = 0;
    while (h < nh) {
      if (!b.on[h]) { h++; continue; }
      let first = h, last = h, gap = 0, cnt = 0, sum = 0;
      for (; h < nh && gap <= gapMax; h++) {
        if (b.on[h]) { last = h; gap = 0; cnt++; sum += b.pw[h]; } else gap++;
      }
      const span = (last - first + 1) * hop / sr;
      if (span < frac * b.ms / 1000) continue;
      const mid = ((first + last) * hop + win) / 2 / sr; // middle of the run (window centres)
      runs.push({ band: b, t: mid - b.ms / 2000, score: Math.log10(sum / cnt), len: span });
    }
  }
  // keep the best of runs that overlap in time across bands
  runs.sort((a, b) => a.t - b.t);
  const kept = [];
  for (const r of runs) {
    const prev = kept[kept.length - 1];
    if (prev && r.t < prev.t + prev.band.ms / 1000 && r.band !== prev.band) {
      if (r.score > prev.score) kept[kept.length - 1] = r;
    } else kept.push(r);
  }
  // set_start = two 3700 Hz beeps (n, gap); a lone one is noise
  const out = [];
  const starts = kept.filter(r => r.band.kind === 'set_start');
  const ss = plan.set_start, pairSpan = (ss.ms + ss.gap_ms) / 1000 * (ss.n - 1) + 0.15;
  const used = new Set();
  for (const r of starts) {
    if (used.has(r)) continue;
    const grp = starts.filter(q => q.t >= r.t && q.t <= r.t + pairSpan * (ss.n - 1));
    if (grp.length >= ss.n) { grp.forEach(q => used.add(q)); out.push({ t_sec: r.t, kind: 'set_start', corner: null, score: r.score }); }
  }
  for (const r of kept) if (r.band.kind !== 'set_start') out.push({ t_sec: r.t, kind: r.band.kind, corner: r.band.corner, score: r.score });
  return out.sort((a, b) => a.t_sec - b.t_sec);
}

export function segmentSets(tones) {
  const sets = [];
  let cur = null;
  for (const t of tones) {
    if (t.kind === 'set_start') {
      if (cur) { cur.end_sec = cur.calls.length ? cur.calls[cur.calls.length - 1].t_sec : cur.start_sec; sets.push(cur); }
      cur = { start_sec: t.t_sec, end_sec: null, calls: [] };
    } else if (!cur) continue;
    else if (t.kind === 'call') cur.calls.push({ t_sec: t.t_sec, corner: t.corner });
    else if (t.kind === 'set_end') { cur.end_sec = t.t_sec; sets.push(cur); cur = null; }
  }
  if (cur) { cur.end_sec = cur.calls.length ? cur.calls[cur.calls.length - 1].t_sec : cur.start_sec; sets.push(cur); }
  return sets;
}
