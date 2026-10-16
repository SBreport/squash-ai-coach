// Session history: one summary per exported bundle and the change versus the previous record. Pure; shared by
// app/index.html (tab "변화 기록") and tests/check.mjs.
import { detectEvents, signalValue } from './angles.mjs';

// better: 'lower' | 'higher' | 'target' (closer to the knee target range is better) | 'none' (no direction, gray)
export const METRICS = [
  { key: 'knee_min_avg', label: '무릎 굽힘 (평균 최저)', unit: '°', dec: 1, better: 'target' },
  { key: 'stance_avg', label: '평균 발 간격', unit: '배', dec: 2, better: 'none' },
  { key: 't_occ', label: 'T 점유율', unit: '%', dec: 1, better: 'higher' },
  { key: 'ghost_total', label: '고스팅 총시간', unit: '초', dec: 1, better: 'lower' },
  { key: 'slow_corner', label: '가장 느린 코너', unit: '초', dec: 2, better: 'lower' },
  { key: 'hr_recovery', label: '회복 심박', unit: ' bpm', dec: 0, better: 'higher' },
];

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const num = x => typeof x === 'number' && Number.isFinite(x) ? x : null;

export const fmtValue = (m, v) => v == null ? '기록 없음' : v.toFixed(m.dec) + m.unit;

// Recovery heart rate = A (right after the test) - B (1 minute later). null if either is missing.
export function recoveryHr(a, b) {
  const x = a === '' || a == null ? NaN : Number(a), y = b === '' || b == null ? NaN : Number(b);
  return Number.isFinite(x) && Number.isFinite(y) ? x - y : null;
}

// angles.csv text -> rows [{frame, time, person, knee_l, knee_r, stance_ratio}] (numbers or null).
export function parseAnglesCsv(text) {
  const lines = String(text || '').trim().split('\n');
  if (lines.length < 2) return [];
  const head = lines[0].split(','), col = n => head.indexOf(n), v = x => x === '' || x == null ? null : Number(x);
  return lines.slice(1).map(l => l.split(',')).filter(r => r[col('person')] !== '' && r[col('person')] != null).map(r => ({
    frame: Number(r[col('frame')]), time: Number(r[col('time_sec')]), person: Number(r[col('person')]),
    knee_l: v(r[col('knee_l')]), knee_r: v(r[col('knee_r')]), stance_ratio: v(r[col('stance_ratio')]),
  }));
}

// Knee-bend moments of a bundle without events.json: run the same detection on person 1 of angles.csv.
function eventsFromCsv(csv, ad) {
  if (!ad) return null;
  const rows = parseAnglesCsv(csv).filter(r => r.person === 1);
  if (!rows.length) return null;
  const found = detectEvents(rows.map(r => ({ frame: r.frame, time: r.time, v: signalValue(ad.signal, r) })), ad);
  return found.map((e, i) => ({ n: i + 1, frame: e.frame, time_sec: e.time, angles: rows.find(r => r.frame === e.frame) }));
}

// raw = {name, meta, events, court, csv} (parsed JSON or null; csv text or null) -> flat summary.
// opts.auto_detect = detection parameters used only when events.json is missing (meta.auto_detect wins).
export function summarizeSession(raw, opts = {}) {
  const { name = '', meta = null, court = null } = raw;
  const events = Array.isArray(raw.events) ? raw.events : eventsFromCsv(raw.csv, meta?.auto_detect || opts.auto_detect);
  const ks = (events || []).map(e => signalValue('knee_min', e.angles)).filter(x => x != null);
  const ss = (events || []).map(e => num(e.angles?.stance_ratio)).filter(x => x != null);
  const hr = court?.hr || meta?.hr || null;
  const avg = court?.corner_avg, slow = court?.slowest_corner;
  const date = /^(\d{4}-\d{2}-\d{2})/.exec(name)?.[1] || meta?.created_at?.slice(0, 10) || null;
  return {
    name, date, label: meta?.label || name, n_events: events ? events.length : null,
    knee_min_avg: mean(ks), stance_avg: mean(ss),
    t_occ: num(court?.t_occupancy_pct),
    ghost_total: court?.excursions?.length ? num(court.total_sec) : null, ghost_visits: court?.excursions?.length ?? null,
    slow_corner: slow && avg?.[slow] ? num(avg[slow].avg_sec) : null, slow_corner_name: slow || null,
    hr_recovery: hr ? (num(hr.recovery) ?? recoveryHr(hr.a, hr.b)) : null,
  };
}

const dist = (v, t) => v < t.min ? t.min - v : v > t.max ? v - t.max : 0;

// Change of every metric from prev to cur (summaries; prev may be null). Per metric:
// {key, label, value, prev, delta, text, tone}. text: "기록 없음" (cur missing), "첫 기록" (prev missing),
// "변화 없음", else a signed delta like "+3.2°" / "-1.5초". tone: good | bad | neutral | none.
// opts.kneeTarget = {min, max}: the knee counts as better when it gets closer to that range.
export function diffSessions(prev, cur, opts = {}) {
  const target = opts.kneeTarget || { min: 75, max: 105 };
  return METRICS.map(m => {
    const value = cur?.[m.key] ?? null, p = prev?.[m.key] ?? null, out = { key: m.key, label: m.label, value, prev: p, delta: null, text: '', tone: 'none' };
    if (value == null) return { ...out, text: '기록 없음' };
    if (p == null) return { ...out, text: '첫 기록' };
    const d = value - p, shown = Number(Math.abs(d).toFixed(m.dec));
    out.delta = d;
    if (shown === 0) return { ...out, text: '변화 없음', tone: 'neutral' };
    out.text = (d > 0 ? '+' : '-') + shown.toFixed(m.dec) + m.unit;
    const better = m.better === 'lower' ? -d : m.better === 'higher' ? d : m.better === 'target' ? dist(p, target) - dist(value, target) : 0;
    out.tone = m.better === 'none' ? 'neutral' : better > 0 ? 'good' : better < 0 ? 'bad' : 'neutral';
    return out;
  });
}

// Sorted (date, name) summaries with `diffs`: each metric is compared with the nearest earlier session that has it.
export function withDiffs(list, opts) {
  const s = [...list].sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.name.localeCompare(b.name));
  return s.map((cur, i) => {
    const prev = {};
    for (const m of METRICS) for (let j = i - 1; j >= 0; j--) if (s[j][m.key] != null) { prev[m.key] = s[j][m.key]; break; }
    return { ...cur, diffs: diffSessions(Object.keys(prev).length ? prev : null, cur, opts) };
  });
}
