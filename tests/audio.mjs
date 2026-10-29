// node tests/audio.mjs — synthetic check of app/audio.mjs (tone finder + set segmentation).
// Synthetic scene: cue schedule as sines (peak 0.2 = -14 dBFS) + white noise (RMS 0.05, i.e. tone RMS is ~+9 dB over the
// whole-band noise RMS) + 60 random impulsive clicks (peak up to 0.6, 1-3 ms) + 25 broadband "squeak" chirps (amp 0.15,
// 80-300 ms sweeps of 1500-2500 Hz) + a 120 Hz rumble. Rendered at 44.1k and 48k.
// Real recordings are harder (AAC, speech); see the browser check in the hand-over notes.
import assert from 'node:assert/strict';
import { CUE_TONES, findTones, segmentSets } from '../app/audio.mjs';

const CORNERS = Object.keys(CUE_TONES.calls);
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// schedule: 2 sets of 30 s, calls every 2.5-3.5 s; returns {events, dur}
export function makeSchedule(seed = 1) {
  const r = rng(seed), ev = [];
  let t = 3, last = null;
  for (let s = 0; s < 2; s++) {
    ev.push({ t, kind: 'set_start' });
    t += 1.2;
    const end = t + 30;
    while (t < end) {
      let c; do { c = CORNERS[Math.floor(r() * 6)]; } while (c === last);
      last = c; ev.push({ t, kind: 'call', corner: c });
      t += 2.5 + r();
    }
    ev.push({ t, kind: 'set_end' });
    t += 8; // rest
  }
  return { events: ev, dur: t };
}

// add a sine burst with fades into x
function burst(x, sr, t0, hz, ms, amp) {
  const n = Math.round(ms / 1000 * sr), f = Math.round(CUE_TONES.fade_ms / 1000 * sr), o = Math.round(t0 * sr);
  for (let i = 0; i < n && o + i < x.length; i++) {
    const g = Math.min(1, i / f, (n - 1 - i) / f);
    x[o + i] += amp * g * Math.sin(2 * Math.PI * hz * i / sr);
  }
}

export function render(sched, sr, { amp = 0.2, noise = 0.05, clean = false, seed = 7 } = {}) {
  const x = new Float32Array(Math.ceil((sched.dur + 2) * sr)), r = rng(seed);
  for (const e of sched.events) {
    if (e.kind === 'call') burst(x, sr, e.t, CUE_TONES.calls[e.corner], CUE_TONES.call_ms, amp);
    else if (e.kind === 'set_end') burst(x, sr, e.t, CUE_TONES.set_end.hz, CUE_TONES.set_end.ms, amp);
    else for (let k = 0; k < CUE_TONES.set_start.n; k++) burst(x, sr, e.t + k * (CUE_TONES.set_start.ms + CUE_TONES.set_start.gap_ms) / 1000, CUE_TONES.set_start.hz, CUE_TONES.set_start.ms, amp);
  }
  if (clean) return x;
  for (let i = 0; i < x.length; i++) x[i] += noise * (r() + r() + r() + r() - 2) * 1.7 + 0.05 * Math.sin(2 * Math.PI * 120 * i / sr);
  for (let k = 0; k < 60; k++) { // clicks
    const o = Math.floor(r() * (x.length - 300)), n = Math.round((0.001 + 0.002 * r()) * sr), a = 0.6 * r();
    for (let i = 0; i < n; i++) x[o + i] += a * (r() * 2 - 1) * (1 - i / n);
  }
  for (let k = 0; k < 25; k++) { // squeak chirps
    const o = Math.floor(r() * (x.length - sr)), n = Math.round((0.08 + 0.22 * r()) * sr);
    const f0 = 800 + 3700 * r(), f1 = f0 + (r() < 0.5 ? -1 : 1) * (1500 + 1000 * r()); // a chirp that parks on one pitch is a tone, not a squeak
    let ph = 0;
    for (let i = 0; i < n; i++) { ph += 2 * Math.PI * (f0 + (f1 - f0) * i / n) / sr; x[o + i] += 0.15 * Math.sin(ph) * Math.sin(Math.PI * i / n) + 0.03 * (r() * 2 - 1); }
  }
  return x;
}

const RUN = import.meta.url === `file://${process.argv[1]}`;
for (const sr of RUN ? [44100, 48000] : []) {
  for (const seed of [1, 2, 3]) {
    const sched = makeSchedule(seed), x = render(sched, sr, { seed: seed + 10 });
    const tones = findTones(x, sr), tag = `sr=${sr} seed=${seed}`;
    assert.equal(tones.length, sched.events.length, `${tag}: found ${tones.length} of ${sched.events.length}`);
    let worst = 0;
    sched.events.forEach((e, i) => {
      const f = tones[i], d = Math.abs(f.t_sec - e.t);
      worst = Math.max(worst, d);
      assert.equal(f.kind, e.kind, `${tag}: #${i} kind`);
      if (e.kind === 'call') assert.equal(f.corner, e.corner, `${tag}: #${i} corner`);
      assert.ok(d <= 0.02, `${tag}: #${i} off by ${(d * 1000).toFixed(1)} ms`);
    });
    const sets = segmentSets(tones);
    assert.equal(sets.length, 2, `${tag}: sets`);
    console.log(`${tag}: ${tones.length} tones ok, worst onset error ${(worst * 1000).toFixed(1)} ms`);
  }
}
if (RUN) {
// noise only -> nothing
assert.deepEqual(findTones(render({ events: [], dur: 20 }, 44100), 44100), []);

// segmentSets: sets, missing end, stray calls before the first start
const T = (t_sec, kind, corner = null) => ({ t_sec, kind, corner, score: 3 });
const s = segmentSets([T(1, 'call', 'back_left'), T(2, 'set_start'), T(3, 'call', 'front_left'), T(6, 'call', 'side_right'), T(8, 'set_end'),
  T(20, 'set_start'), T(22, 'call', 'back_right')]);
assert.deepEqual(s, [
  { start_sec: 2, end_sec: 8, calls: [{ t_sec: 3, corner: 'front_left' }, { t_sec: 6, corner: 'side_right' }] },
  { start_sec: 20, end_sec: 22, calls: [{ t_sec: 22, corner: 'back_right' }] }]);
assert.deepEqual(segmentSets([]), []);
console.log('segmentSets ok');
}
