// node tests/check.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { angle, trunkLean, poseAngles } from '../app/angles.mjs';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

near(angle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }), 90);
near(angle({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }), 180);
near(angle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }), 45);
assert.equal(angle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }), null);

near(trunkLean({ x: 5, y: 10 }, { x: 5, y: 0 }), 0);   // shoulder straight above hip
near(trunkLean({ x: 0, y: 10 }, { x: 10, y: 0 }), 45); // leaning forward 45
near(trunkLean({ x: 10, y: 10 }, { x: 0, y: 0 }), 45); // leaning the other way

// poseAngles must scale normalized coords by width/height: on 2000x1000 the knee below is 135 deg
// (unscaled normalized coords would give ~153).
const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
Object.assign(lm[24], { x: 0.5, y: 0.4 }); Object.assign(lm[26], { x: 0.5, y: 0.6 }); Object.assign(lm[28], { x: 0.6, y: 0.8 });
near(poseAngles(lm, 2000, 1000).knee_r, 135);
lm[28].visibility = 0.1;
assert.equal(poseAngles(lm, 2000, 1000).knee_r, null); // low-visibility ankle -> empty

const dir = new URL('../docs/data/', import.meta.url);
const need = {
  'project.json': ['title', 'question', 'start_date', 'tournament_date', 'rule', 'youtube_playlist', 'metrics'],
  'sessions.json': ['date', 'type', 'duration_min', 'rpe', 'hr_avg', 'hr_max', 'note', 'pain', 'external_advice'],
  'metrics.json': ['date', 'metric', 'value', 'note'],
  'prescriptions.json': ['week', 'start', 'end', 'focus', 'load_cap', 'game_task', 'sessions'],
  'reports.json': ['week', 'date', 'diagnoses', 'fix_this_week', 'last_week_effect', 'ai_mistakes'],
};
const files = readdirSync(dir).filter(f => f.endsWith('.json'));
for (const f of Object.keys(need)) assert.ok(files.includes(f), `missing docs/data/${f}`);
for (const f of files) {
  const data = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  const keys = need[f];
  if (!keys) continue;
  for (const row of f === 'project.json' ? [data] : (assert.ok(Array.isArray(data), `${f} must be an array`), data))
    for (const k of keys) assert.ok(k in row, `${f}: missing key "${k}"`);
}
const project = JSON.parse(readFileSync(new URL('project.json', dir), 'utf8'));
assert.equal(project.metrics.length, 5);
for (const m of project.metrics) for (const k of ['id', 'name', 'unit', 'better']) assert.ok(k in m, `metric missing ${k}`);

console.log(`check.mjs: ok (angles + ${files.length} data files)`);
