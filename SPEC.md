# squash-ai-coach — SPEC v1.2 (MVP, due 2026-10-19)

v1.2: one-pass workflow (open -> full analysis -> export). On-video checkpoint box, automatic knee-bend detection (section 1c), fps auto-detect and automatic stride, empty-bundle warning, label follows the file, `front` column in angles.csv, `events.json`, `data/` for local videos.
v1.1: checkpoint panel + checkpoints.json (section 1a), 2D/3D angle mode, compare screen app/compare.html (section 1b), shared module app/pose.mjs, stance_ratio metric.

Project: amateur squash player, no human coaching, trains with AI for 38 days before a tournament on 2026-11-22. Everything is published on YouTube + this repo's dashboard. Brief lives in the SecondBrain vault: `1_production/스쿼시 AI 코치/01 프로젝트 브리프.md`.

UI language: Korean. No emoji anywhere (UI, code, commits). No build step, no framework, no npm install required to run.

## Repo layout

```
squash-ai-coach/
  SPEC.md
  README.md            (Korean; how to run, what each folder is)
  start.bat            (ASCII only! starts local server, opens app)
  app/index.html       analysis app (single page, inline or sibling .js/.css)
  app/compare.html     two-video comparison screen
  app/pose.mjs         shared: pose loading, person tracking, drawing, settings
  app/angles.mjs       pure math: 2D/3D angles, racket/front-leg aliases, judge
  app/checkpoints.json checkpoint definitions (schema in 1a)
  app/models/          pose model file (downloaded once, committed if license allows)
  docs/index.html      public dashboard (GitHub Pages serves /docs)
  docs/data/*.json     dashboard data (schemas below)
  docs/media/          images used by dashboard (comparison images, captures)
  sessions/<YYYY-MM-DD>-<label>/   analysis bundles exported by the app
  data/                local videos (gitignored; never committed)
  tests/check.mjs      one node assert-based check (node tests/check.mjs)
  .gitignore           *.mp4 *.mov *.MOV *.m4v  (videos never go in repo; they go to YouTube)
```

## 1. Analysis app (app/index.html) — MVP scope

Runs locally at `http://localhost:8780/app/` via `start.bat` (`python -m http.server 8780` from repo root; Python exists on PATH). Must be usable on Windows Chrome/Edge.

Pose: MediaPipe Tasks Vision `PoseLandmarker` loaded from jsDelivr with an exact pinned version (check the real latest stable with `npm view @mediapipe/tasks-vision version`; pin it). Model: `pose_landmarker_full.task` (Google storage URL; download into `app/models/` and load locally). `runningMode: "VIDEO"`, `numPoses: 2` (game videos have two players).

Features:
1. Open local video file (file input + drag-and-drop). Show it with a canvas overlay at native aspect ratio. Opening a file always replaces the export label with that file's name (without extension).
2. Play/pause (Space). Frame step with Left/Right arrows (1 frame = 1/fps; fps field, default 60). Shift+arrow = 10 frames. Show `프레임 N / total · fps · mm:ss.ms`.
3. Skeleton overlay on the current frame for each detected person (person 1 / person 2 different colors). Show live angles for selected person: knee L/R, hip L/R, elbow L/R, trunk lean from vertical. Angle at the knee drawn as an arc + label on the video (this is the on-camera "wow" shot — make it legible at 1080p screen recording).
4. "전체 분석" button: walk through the whole video with a stride (default every 2nd frame, configurable), detect pose, store per-frame angles. Progress bar + cancel. Then show a line chart (inline SVG or canvas, no library) of a chosen angle over time with a cursor synced to the current frame; click on chart seeks video.
5. "이 프레임 담기" (key C): capture current frame + skeleton as PNG, with current angles and an optional one-line note.
6. "분석 묶음 내보내기": write into a folder the user picks (File System Access API `showDirectoryPicker`, suggest `sessions/`), creating `<YYYY-MM-DD>-<label>/` with:
   - `meta.json` {video_name, label, fps, stride, width, height, duration_sec, frames_total, created_at, mediapipe_version, checkpoints_version, handedness, angle_mode, auto_detect}. `auto_detect` = the parameter object from checkpoints.json used for this bundle. `angle_mode` is the mode of `angles.csv` (the mode of the last full analysis; current mode if none ran)
   - `angles.csv` header: `frame,time_sec,person,knee_l,knee_r,hip_l,hip_r,elbow_l,elbow_r,trunk_lean,stance_ratio,front` (degrees 1 decimal; stance_ratio unitless 2 decimals; empty if not detected; `front` = front-leg decision per frame, `l`, `r` or empty)
   - `events.json` [{n, frame, time_sec, front, angles:{...}, checkpoints:[{id, value, status}]}] — the automatic detections of section 1c (`[]` if none)
   - `captures.json` [{frame, time_sec, person, note, auto, angle_mode, angles:{...}, checkpoints:[{id, value, status}], image:"frames/f000342.png"}]. `status`: angle type `pass|fail|na|ref` (na = not measurable, ref = no target), visual type `pass|fail|skip|unset`
   - `frames/f000342.png` ...
   `auto: true` marks captures taken by automatic detection (image `frames/f000342-auto.png`). If no full analysis exists, export asks `각도 데이터가 비어 있습니다. 전체 분석 없이 내보낼까요?` first.
   Fallback if the API is unavailable: download each file.
7. If the video cannot be decoded (iPhone HEVC), show a Korean message with the fix: `ffmpeg -i in.mov -c:v libx264 -crf 18 -an out.mp4` (ffmpeg is installed on this PC).

Out of scope now (do NOT build): rally tagging screen, court heatmap / T occupancy, AI panel. Leave no stubs for them.

Angle math: put pure functions (angle between three points, trunk lean) in a small module usable from both the page and `tests/check.mjs`.

### 1a. v1.1 additions to the analysis app

Angle mode: header select "각도: 2D 화면 / 3D 추정". 3D uses MediaPipe `worldLandmarks` (metres, y vertical): `angle3`, `trunkLean3`, `poseAngles3` in `angles.mjs`. In 3D mode the skeleton overlay stays 2D; the angle numbers (side table, on-video knee label), chart, CSV and checkpoint verdicts use 3D values. The current mode is always shown (header chip and a badge drawn on the overlay, so recordings and saved PNGs carry it). Full analysis uses the mode at start (mode select is locked during analysis), records it in `meta.json.angle_mode`; if the mode is changed afterwards the chart says which mode it shows. Mode and racket hand persist in `localStorage` (`sqc_mode`, `sqc_hand`) and are shared with compare.html.

Metrics (`KEYS`): knee_l, knee_r, hip_l, hip_r, elbow_l, elbow_r, trunk_lean, and `stance_ratio` = ankle distance / hip distance (unitless, 2 decimals; 2D after pixel scaling, 3D in world units; chart axis 0..3).

Checkpoint panel (side panel): group select (generated from `group` values in `app/checkpoints.json`; "전체" first). Per item for the current frame and selected person: value, target range, status chip (통과 / 미달 / 측정 불가 = joint not detected or side undecidable; 기준선 비교 when `target` is null), confidence, and a source link (opens `source.url` in a new tab as-is). `type: "visual"` items have no automatic verdict; the user toggles 통과 / 미달 / 해당없음 per frame. "이 프레임 담기" stores `checkpoints` for the visible group.

`app/checkpoints.json` schema (top-level `auto_detect` object: see 1c):
```json
{"version":"v0","handedness_default":"R","auto_detect":{},"checkpoints":[
 {"id":"","group":"","name":"","type":"angle|visual","metric":"","target":{"min":80,"max":100},"view":"",
  "confidence":"상|중|하","note":"","source":{"channel":"","title":"","url":"","timestamp":""}}
]}
```
- `metric`: a `KEYS` entry, or an alias. Racket-side aliases `knee_racket|knee_other|hip_racket|hip_other|elbow_racket|elbow_other` map to L/R by the "라켓 손" setting (racket = R for right-handed). Front/back-leg aliases `knee_front|knee_back|hip_front|hip_back` follow the lunge, not the hand: the front leg is the one whose ankle (landmarks 27/28) has the smaller image y (farther from the camera = toward the front wall). Assumes the camera is behind the player and above the floor (back-wall or rear-corner shot). If the ankle y gap is under 5% of leg length the side cannot be decided and the item reads 측정 불가. In 3D mode the front/back decision is still the 2D rule; only the angle value is 3D.
- `target`: `{min?, max?}` (inclusive) or `null` = show the value only (baseline comparison, no verdict). `type: "visual"` uses `metric: null`, `target: null`.
- Pure functions in `angles.mjs`: `resolveMetric`, `frontSide`, `checkpointValue`, `judge`.

### 1b. Compare screen (app/compare.html)

Purpose: coach demo clip vs my video, and week 1 vs week 4. Both are "open two local files". Linked from index.html and back.

Two panels (stacked on narrow screens). Each: open/drop a video, skeleton overlay for one selected person, knee angle arcs, own fps field, independent frame stepping (click a panel to focus it, then arrow keys / Shift+arrow / Space). Detection uses one `PoseLandmarker` in IMAGE mode (stateless) for both panels.

"동기 이동": when on, steps and playback move both panels. Time based (clips may differ in fps): other panel time = this panel time + offset. Each panel has "여기를 맞춤점으로"; when both anchors are set, offset = anchor B - anchor A; otherwise the offset is the current time difference at the moment sync is turned on.

Below the panels: angle table, same metrics side by side with B-A difference, for the selected person in each panel in the current mode. "비교 이미지 저장": one PNG, both frames (skeleton included) side by side at a common height plus the table rendered at the bottom with mode and racket hand; file name `compare-YYYYMMDD-HHMMSS.png`. Meant to be moved by hand into `docs/media/`.

Shared code lives in `app/pose.mjs` (loading, person tracking, drawing, settings); index.html and compare.html both import it.

### 1c. v1.2 additions to the analysis app

Target workflow: **open file -> 전체 분석 (one click) -> export**. Nothing else is required.

**On-video checkpoint box.** Top-left of the overlay, under the mode badge: translucent box with the checkpoints of the group chosen in the side panel ("전체" = all): name (long names cut with an ellipsis), value, target, colored by status (pass green, fail red, not measurable gray, baseline-compare white; `visual` items show their toggle state). Font size follows the short side of the video (about 21 px on 720p) so it reads in a 1080p screen recording. Drawn under the skeleton and knee labels. Checkbox "영상에 표시" (default on); the box is part of the overlay, so "이 프레임 담기" PNGs carry it too. The side panel stays for source links and the visual toggles.

**fps auto-detect.** On file open: muted, `playbackRate = 0.25`, play about 2 s (stop at 40 gaps), collect `mediaTime` gaps from `requestVideoFrameCallback`, then `fpsFromDeltas` (pure, `angles.mjs`) = most common gap (5%-wide log bins) -> median in the bin -> snap to 24, 25, 30, 48, 50, 60, 120, 240 within 5%, else rounded; null if fewer than 5 gaps or no bin holds half of them. Why gaps at 0.25x: a 120 fps clip played at 1x on a 60 Hz screen drops frames and reads about 60. Applied automatically with a "자동 감지" chip next to the fps field; on failure the field keeps its value and the chip reads "fps 확인 필요". Position, speed and mute are restored. A manual change of the fps field clears the chip and recomputes the stride. Interaction (frame step, analysis) is blocked while probing.

**Stride auto.** `strideFor(fps) = max(1, round(fps / 30))` (pure, `angles.mjs`); set whenever fps is set or edited; the stride field stays editable.

**Auto detect (무릎 굽힘 순간 자동 감지).** Runs automatically when a full analysis finishes (not when cancelled), for the selected person. It finds moments where the knee bends; it does not claim they are lunges or hits. `detectEvents(samples, opts)` (pure, `angles.mjs`): samples `{frame, time, v}` with `v = signalValue('knee_min', angles)` = the smaller of knee_l and knee_r (null if neither). Steps: median-smooth (`smooth` = 5 samples); baseline = `baseline_pct` percentile (linear interpolation) of the smoothed values; a sample is an event when it is the minimum within +-`window_sec` (converted to samples with the median sample spacing) and at least `min_drop` degrees below the baseline; events closer than `min_gap_sec` keep only the lower one (ties: earlier). The rule is relative on purpose: in the first real clip the 2D knee never goes below about 139 degrees, so an absolute "front knee 130 or less" finds nothing. Parameters live in `app/checkpoints.json` top-level `auto_detect` (`signal, smooth, baseline_pct, min_drop, window_sec, min_gap_sec, note`); they are AI-chosen values, not coach numbers (said in the JSON note). Current values `window_sec = 0.33` (= 10 samples at 120 fps / stride 4) reproduce the 7 moments of `sessions/2026-10-16-IMG_1224` (frames 64, 308, 732, 848, 960, 1124, 1320); 0.17 s adds a spurious 8th (frame 1224).
For each event: seek, reset tracker, re-detect the pose on that exact frame, judge the front leg and every angle checkpoint (all groups), and store an automatic capture (note `자동 감지 #n`, `auto: true`). Side panel "무릎 굽힘 순간 자동 감지": count, one button per event (click = seek) and a summary of the angle items of the group selected in the checkpoint panel ("전체" = all angle items): items with a target show `통과 a/N, 측정 불가 c/N`, baseline-compare items show the mean value. Caption: "선택한 그룹 기준 — 런지 항목은 런지 드릴 영상에서만 의미". The chart (default key "무릎 최소 (자동 감지 기준)") shows the median-smoothed curve with a numbered dot per event. A new analysis replaces the previous automatic captures/events. Auto detect was tuned on 2D values; 3D mode can give different moments.

## 2. Dashboard (docs/index.html)

Static page, vanilla JS, fetches `docs/data/*.json`. No libraries; charts are inline SVG. Light/dark via prefers-color-scheme. Works at phone width. Korean.

Sections, top to bottom:
1. Header: project title "AI에게만 배워서 첫 스쿼시 대회 나가기", D-day to 2026-11-22, the question, and the fixed judgment rule (from project.json).
2. 이번 주 처방: latest prescriptions.json entry as a card (Tue/Thu menus with minutes, game task, load cap, source links).
3. 판정 지표: the 5 metrics, each a small chart of values over time from metrics.json with baseline marked and "개선/악화/측정 전" state chip. Shows "N / 5 개선" summary.
4. 주간 코치 리포트: reports.json newest first (diagnoses with confidence and source links, fix this week, last week effect, AI mistakes).
5. 훈련 일지: sessions.json table (date, type, minutes, RPE, avg/max HR, note).
6. Footer: link to YouTube playlist (field in project.json, may be empty) and to this repo.

Empty arrays must render designed empty states ("기준선 측정 전", etc.), not blank areas.

## 3. Data schemas (docs/data/)

`project.json`
```json
{"title":"AI에게만 배워서 첫 스쿼시 대회 나가기","question":"사람 코치 레슨 없이 AI에게만 배워서 첫 아마추어 대회에서 성과를 낼 수 있는가","start_date":"2026-10-15","tournament_date":"2026-11-22","rule":"과정 지표 5개 중 3개 이상 개선이면 AI 코칭이 작동했다고 판정","youtube_playlist":"","metrics":[
 {"id":"ghost_test_sec","name":"고스팅 테스트 기록","unit":"초","better":"lower"},
 {"id":"hr_recovery_1min","name":"1분 회복 심박","unit":"bpm","better":"higher"},
 {"id":"error_rate","name":"경기 범실률","unit":"%","better":"lower"},
 {"id":"t_occupancy","name":"T 점유율","unit":"%","better":"higher"},
 {"id":"posture_angle","name":"고친 자세 항목 각도","unit":"도","better":"target","target":null}
]}
```
`sessions.json` `[{"date":"2026-10-15","type":"solo|game|test|tournament","duration_min":75,"rpe":7,"hr_avg":null,"hr_max":null,"note":"","pain":"","external_advice":""}]`
`metrics.json` `[{"date":"2026-10-15","metric":"ghost_test_sec","value":0,"note":""}]` (first value per metric = baseline)
`prescriptions.json` `[{"week":1,"start":"2026-10-20","end":"2026-10-26","focus":"","load_cap":"","game_task":"","sessions":[{"day":"화","items":[{"name":"","min":10,"detail":"","source_url":""}]}]}]`
`reports.json` `[{"week":0,"date":"2026-10-19","diagnoses":[{"title":"","observation":"","interpretation":"","confidence":"상|중|하","evidence":"","source":{"channel":"","title":"","url":"","timestamp":""}}],"fix_this_week":[""],"last_week_effect":"","ai_mistakes":[""]}]`

Seed: project.json as above; other files `[]`.

## 4. Check

`tests/check.mjs` (node, `node:assert`): angle function on known triangles (90°, 180°, 45°), trunk lean on a vertical and a tilted segment, 3D angle/trunk lean, stance ratio, front/back leg decision, racket-hand alias mapping, `judge` (inside / outside / null target), `app/checkpoints.json` required keys (including `auto_detect`), `detectEvents` on the real `sessions/2026-10-16-IMG_1224/angles.csv` (must give the 7 frames above) and on synthetic valleys (0.7 s merge rule, shallow dip, spike), `fpsFromDeltas` (120/60/30 and others with jitter and dropped frames), `strideFor`, and every docs/data/*.json parses and has the required keys. Must pass with `node tests/check.mjs`.

## Done means

- `start.bat` opens the app; a local video shows skeleton overlay, frame stepping works, full analysis produces chart, export writes the bundle.
- Dashboard renders with seed data (empty states) and with a temporary sample (verify, then remove sample).
- `node tests/check.mjs` passes. Local git repo initialized with commits. Nothing pushed.
