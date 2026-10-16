# squash-ai-coach — SPEC v1.5 (MVP, due 2026-10-19)

v1.5: (1) court calibration is a numbered step wizard with a guide picture (section 1d, `CAL_ORDER`, `calGuideSvg`, shared `courtSvg`); (2) ghosting order picture in the empty 스텝·체력 chart (`ghostGuideSvg`); (3) time slider under the video with wheel scrub and tick marks (section 1e); (4) ghosting start signal = hands up (`handsUp`, `detectHandsUp`, `court.hands_up_min_sec`, `court.json.start_signal`), `total_sec` now counts from the end of the first hands-up (section 1d). Where 1d describes the old "pick a mark in a list" calibration UI, the wizard wins.

v1.4: UI overhaul of `app/index.html` (section 1e): four tabs (자세 조정, 게임 분석, 스텝·체력, 변화 기록), no page scroll at 1440x900, summary card, `plain` text and range bars per checkpoint, fps fallback, remembered export folder, tab suggestion, fullscreen, `app/history.mjs`, `hr` in `meta.json`/`court.json`. Analysis logic unchanged. Where 1a/1c/1d describe the old side panel (group select, auto-detect list, calibration panel), 1e wins for layout.

v1.3: slim on-video box (only `overlay_ids`, max 3 lines, section 1c), non-overlapping knee labels (`layoutLabels`), court calibration + T occupancy + movement map + ghosting excursion times (section 1d, `app/court.mjs`), `court.json`, `court_x,court_y` in `angles.csv`, `court` in `meta.json`.
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
  app/pose.mjs         shared: pose loading, person tracking, drawing, settings, knee label layout
  app/court.mjs        court dimensions, homography, floor position, T occupancy, corner visits, hands-up start signal, court SVG pictures (section 1d)
  app/angles.mjs       pure math: 2D/3D angles, racket/front-leg aliases, judge
  app/history.mjs      session summary + change versus the previous record (pure; section 1e)
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
   - `meta.json` {video_name, label, fps, stride, width, height, duration_sec, frames_total, created_at, mediapipe_version, checkpoints_version, handedness, angle_mode, auto_detect, court, hr}. `auto_detect` = the parameter object from checkpoints.json used for this bundle. `court` = calibration object of section 1d or `null`. `angle_mode` is the mode of `angles.csv` (the mode of the last full analysis; current mode if none ran)
   - `angles.csv` header: `frame,time_sec,person,knee_l,knee_r,hip_l,hip_r,elbow_l,elbow_r,trunk_lean,stance_ratio,front,court_x,court_y` (degrees 1 decimal; stance_ratio unitless 2 decimals; empty if not detected; `front` = front-leg decision per frame, `l`, `r` or empty; `court_x,court_y` = floor position in metres, 2 decimals, empty without calibration or when the player is more than 0.3 m outside the court)
   - `events.json` [{n, frame, time_sec, front, angles:{...}, checkpoints:[{id, value, status}]}] — the automatic detections of section 1c (`[]` if none)
   - `court.json` see section 1d (calibration `null` and empty results if the court was not set); v1.4 adds `hr`
   - `captures.json` [{frame, time_sec, person, note, auto, angle_mode, angles:{...}, checkpoints:[{id, value, status}], image:"frames/f000342.png"}]. `status`: angle type `pass|fail|na|ref` (na = not measurable, ref = no target), visual type `pass|fail|skip|unset`
   - `frames/f000342.png` ...
   `auto: true` marks captures taken by automatic detection (image `frames/f000342-auto.png`). If no full analysis exists, export asks `각도 데이터가 비어 있습니다. 전체 분석 없이 내보낼까요?` first.
   Fallback if the API is unavailable: download each file.
7. If the video cannot be decoded (iPhone HEVC), show a Korean message with the fix: `ffmpeg -i in.mov -c:v libx264 -crf 18 -an out.mp4` (ffmpeg is installed on this PC).

Out of scope now (do NOT build): rally tagging screen, ghost overlay, AI panel. Leave no stubs for them. (Court calibration and T occupancy moved into scope in v1.3, section 1d.)

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

**On-video checkpoint box (v1.3: slimmed).** Translucent box under the mode badge, on the half of the frame away from the player. It shows only the items listed in `app/checkpoints.json` top-level `overlay_ids` (this week's prescription, the AI coach changes it weekly), in that order, at most 3 lines, angle items only (`visual` items and unknown ids are never drawn on the video; they stay in the side panel). Default `["lunge_front_knee","lunge_back_knee","lunge_width"]`. Title `이번 주 체크 · 앞다리 L` (`?` when undecidable). Per row: name (cut with an ellipsis), value, target, colored by status (pass green, fail red, not measurable gray, baseline-compare white). Font size = short side / 51 (about 14 px on 720p, 2/3 of v1.2), padding reduced. Drawn under the skeleton and knee labels. Checkbox "영상에 표시" (default on); the box is part of the overlay, so "이 프레임 담기" PNGs carry it too. The side panel keeps the group select (panel only), source links and the visual toggles.

**Knee labels.** Each knee label sits on the outside of its knee (away from the hip midpoint). `layoutLabels(items, W, H)` (pure, `pose.mjs`) clamps the boxes into the frame and, if two rectangles still overlap, moves the later one up or down to the nearest free spot. `drawKnees` draws both arcs and labels (also used by compare.html).

**fps auto-detect.** On file open: muted, `playbackRate = 0.25`, play about 2 s (stop at 40 gaps), collect `mediaTime` gaps from `requestVideoFrameCallback`, then `fpsFromDeltas` (pure, `angles.mjs`) = most common gap (5%-wide log bins) -> median in the bin -> snap to 24, 25, 30, 48, 50, 60, 120, 240 within 5%, else rounded; null if fewer than 5 gaps or no bin holds half of them. Why gaps at 0.25x: a 120 fps clip played at 1x on a 60 Hz screen drops frames and reads about 60. Applied automatically with a "자동 감지" chip next to the fps field; on failure the field keeps its value and the chip reads "fps 확인 필요". Position, speed and mute are restored. A manual change of the fps field clears the chip and recomputes the stride. Interaction (frame step, analysis) is blocked while probing.

**Stride auto.** `strideFor(fps) = max(1, round(fps / 30))` (pure, `angles.mjs`); set whenever fps is set or edited; the stride field stays editable.

**Auto detect (무릎 굽힘 순간 자동 감지).** Runs automatically when a full analysis finishes (not when cancelled), for the selected person. It finds moments where the knee bends; it does not claim they are lunges or hits. `detectEvents(samples, opts)` (pure, `angles.mjs`): samples `{frame, time, v}` with `v = signalValue('knee_min', angles)` = the smaller of knee_l and knee_r (null if neither). Steps: median-smooth (`smooth` = 5 samples); baseline = `baseline_pct` percentile (linear interpolation) of the smoothed values; a sample is an event when it is the minimum within +-`window_sec` (converted to samples with the median sample spacing) and at least `min_drop` degrees below the baseline; events closer than `min_gap_sec` keep only the lower one (ties: earlier). The rule is relative on purpose: in the first real clip the 2D knee never goes below about 139 degrees, so an absolute "front knee 130 or less" finds nothing. Parameters live in `app/checkpoints.json` top-level `auto_detect` (`signal, smooth, baseline_pct, min_drop, window_sec, min_gap_sec, note`); they are AI-chosen values, not coach numbers (said in the JSON note). Current values `window_sec = 0.33` (= 10 samples at 120 fps / stride 4) reproduce the 7 moments of `sessions/2026-10-16-IMG_1224` (frames 64, 308, 732, 848, 960, 1124, 1320); 0.17 s adds a spurious 8th (frame 1224).
For each event: seek, reset tracker, re-detect the pose on that exact frame, judge the front leg and every angle checkpoint (all groups), and store an automatic capture (note `자동 감지 #n`, `auto: true`). Side panel "무릎 굽힘 순간 자동 감지": count, one button per event (click = seek) and a summary of the angle items of the group selected in the checkpoint panel ("전체" = all angle items): items with a target show `통과 a/N, 측정 불가 c/N`, baseline-compare items show the mean value. Caption: "선택한 그룹 기준 — 런지 항목은 런지 드릴 영상에서만 의미". The chart (default key "무릎 최소 (자동 감지 기준)") shows the median-smoothed curve with a numbered dot per event. A new analysis replaces the previous automatic captures/events. Auto detect was tuned on 2D values; 3D mode can give different moments.

### 1d. v1.3 court calibration, T occupancy, ghosting times

`app/court.mjs` (pure + two canvas helpers). Constants from the WSF singles court specification; line widths are ignored (a line is its centre). Coordinates in metres: x = from the LEFT side wall to the right (0..6.40), y = from the FRONT wall to the back (0..9.75), left/right as seen facing the front wall. Length 9.75, width 6.40, short line 5.44 from the front wall, service box 1.60 x 1.60 against the side wall behind the short line (back edge at y 7.04), T = (3.20, 5.44).

**Calibration UI** (v1.5: step wizard, side panel "코트 맞추기"). `CAL_ORDER` (in `court.mjs`, equals the `COURT_POINTS` ids; the test checks this) fixes the order and the number shown on the guide picture, on the video and in the text: 1 T (short line x centre line), 2 short line-left wall, 3 short line-right wall, 4 left service box back-inner corner, 5 right service box back-inner corner, 6 front wall-left floor corner, 7 front wall-right floor corner, then optional 8 back wall-left floor corner, 9 back wall-right, 10 centre line-back wall (`CAL_REQUIRED` = 7). [코트 맞추기] pauses the video and asks for one mark at a time: "3/7 · 숏라인-오른쪽 벽을 클릭하세요". A click on the video assigns the next mark and moves on (no list). [건너뛰기(안 보임)] skips the mark, [되돌리기] undoes the last click or skip (also after the wizard ended), [초기화] clears everything, [그만하기] leaves the wizard. When no mark of the round is left and 4 or more points were clicked (skipped ones do not count) the calibration is computed (`calibrate`, DLT homography as before; with fewer than 4 points the wizard stays and says so), the wizard ends and the court lines are drawn translucent over the video (checkbox "영상에 코트 선 표시") with the mean reprojection error in pixels. [더 찍기(선택)] starts a second round for the marks 8-10 that are still open. The clicked points are numbered on the video with the same numbers. An existing calibration is replaced by [처음부터 다시]. Points are remembered per video name in localStorage (`sqc_court_<name>`, with the video size; restored only if the size matches; try/catch); skipped marks are not remembered.
**Guide picture** (`calGuideSvg`, top-down court SVG, front wall at the top, same drawing function `courtSvg` as the movement map): marks 1-10 as numbered circles; the mark to click now is a big yellow pulsing circle, clicked marks are green with a check, skipped ones gray, open ones white (8-10 paler). Caption: "뒤에서 찍은 영상에서는 1~7번이 보입니다. 8~10은 보이면 찍으세요(정확도가 올라감)."

**Floor position.** `footPoint`: per foot the heel (landmark 29/30) if visible, else the ankle (27/28); mean of the available feet (visibility >= 0.5). The pixel point is stored per analysed frame and person (`foot`), so the court can be set before or after the full analysis; court metres are derived from the calibration (`courtPos`, null if more than 0.3 m outside the court). Selected person only for all statistics (existing person assignment).

**T occupancy** (`tOccupancy`): share of samples with a valid position within `t_radius_m` of T (denominator = samples with a valid position; the shown text also gives valid/total). Limitation: the whole analysed range counts, rest time between rallies included (no rally detection yet).

**Corner visits** (`detectExcursions(track, T, opts)`, `cornerOf(pt)`): a visit starts at the first sample outside `t_radius_m` after the player was at T, needs a sample farther than `away_m`, and ends at the first sample back within `t_radius_m`. Visits shorter than `min_away_sec` (start to return) are dropped as noise; a visit that never returns and a track that starts away from T are not counted; samples without position are skipped. Per visit: start (leaving T), time of the farthest point, return, duration, corner of the farthest point. `cornerOf`: front = y < 5.44, side = 5.44 <= y <= 7.04, back = y > 7.04; left = x < 3.20 (3.20 itself counts as right) -> `front_left, front_right, side_left, side_right, back_left, back_right` (labels 앞/옆/뒤 + 왼쪽/오른쪽). Result table: visits, per-corner count and mean duration with the slowest corner highlighted, total time. The protocol is 6 corners x 3 laps = 18 visits; any other count shows "18회가 아님 (N회 감지)". Parameters in `checkpoints.json` `court` `{t_radius_m: 1.0, away_m: 1.5, min_away_sec: 0.3, hands_up_min_sec: 0.3, note}`: all AI-set values, not coach numbers (said in the note).

**Start signal: hands up** (v1.5). The player marks the start of the ghosting test by standing at T with both arms raised (no clap: sound cannot be relied on). `handsUp(lm)` (pure) is true when both wrists (landmarks 15, 16) are above the nose (0) in the image (smaller y), false when not, null when one of the three is not visible (visibility < 0.5); the app stores it per analysed frame and person (`hands`). `detectHandsUp(samples, {hands_up_min_sec})` (pure): samples `{t, up}` of the selected person; a span starts at the first `up` sample and ends at the first sample with the hands down (the moment the arms come down; the last sample if the track ends first); `null` samples neither start nor end a span; spans shorter than `hands_up_min_sec` are dropped. Returns `[{start_sec, end_sec}]`. The END of the FIRST span is the test start: excursions are counted only from samples at or after it (then as above: first leave from T), and `total_sec` = test start -> return of the last visit. Without a hands-up span the old rule applies (first departure -> last return, `totalSec`) and the summary says "시작 신호(만세) 못 찾음". Later spans (for example a final hands-up at the end of the test, or a reach above the nose during a corner touch) are shown on the slider but not used.

**Movement map** (below the chart): top-down court SVG with lines, T circle, position dots from light to dark with time, numbered far points of the visits, live position marker, "T 점유율 N%". Clicking the map seeks to the nearest sample in space; clicking a visit row seeks to its farthest point.

**Export.** `meta.json.court` = `{points:[{name, px:[x,y], m:[x,y]}], H:[9 numbers, row-major, pixels -> metres], reproj_px}` or `null`. `court.json`: `{calibration (same object or null), person, t_occupancy_pct, t_radius_m, away_m, min_away_sec, hands_up_min_sec, start_signal: {type: 'hands_up', sec} | null, excursions:[{start_sec, far_sec, return_sec, duration_sec, corner, far_m, far_dist_m}], corner_avg:{<corner>:{n, avg_sec}}, slowest_corner, total_sec (v1.5: from the end of the hands-up when `start_signal` is set, else first departure -> last return)}`.

### 1e. v1.4 UI (layout, tabs, panel rules)

**Time slider** (v1.5): a full-width `<input type="range">` (one step = one frame) directly under the video, above the control row, with `m:ss.s / m:ss.s` (now / total) next to it; a second copy sits inside the stage and shows only in fullscreen. While dragging, the video only seeks and the skeleton is hidden; the pose is detected again after 120 ms without movement or when the slider is released (`scrubTo`, `endScrub`). Wheel or trackpad scroll over the video: 100 px of scroll = 1 second (Shift: 1 frame), forward for scrolling down; disabled while analysing or probing fps. With a result, small tick marks sit on top of the slider: knee-bend moments (yellow), ghosting visit starts (orange), the hands-up span (blue, as wide as the span), each with a tooltip and a hint text.

**Layout at 1440x900, no page scroll** (`document.documentElement.scrollHeight <= innerHeight`, checked per tab): header (title, four tabs, status, mode chip, 파일 열기, 고급 설정, 단축키, 영상 비교 화면 link) + two columns 64% / 36%. Left: video box of fixed height 45vh (aspect ratio kept by `fit()`; the overlay canvas keeps the video pixel size and scales with the box), one control row (재생, -10 -1 +1 +10, frame/time text, fps chip, 장면 담기, 전체 분석, 내보내기), then the per-tab chart or map filling the remaining height with the video cursor synced. Right: panel (own scroll if long). Under 1100 px everything stacks and the page may scroll. Text roles: numbers (bold), body 14 px, sub (12 px gray); yellow is the single accent (active tab, event dots, slowest corner).

**Tabs** (same video, same analysis; switching never re-analyses; the tab is remembered in `sqc_tab`):
1. 자세 조정: chart = knee chart with event dots. Summary = knee-bend count, mean lowest knee, mean stance ratio (from the automatic events). Panel = 이번 주 체크 (`overlay_ids` angle items), list of knee-bend moments with thumbnails (reused auto-capture PNGs), 다른 체크 (other angle items of groups 런지/준비 자세/스윙).
2. 게임 분석: movement map; summary = T occupancy with valid/total samples; panel = calibration steps, person select (1번/2번), 범실 기록 empty state ("2주차 추가 예정"), 무빙 group visual checks.
3. 스텝·체력: bar chart of mean time per corner (slowest highlighted); before there is a result (no calibration, no analysis or no visit found) the chart area shows the ghosting order picture instead (`ghostGuideSvg`: same court drawing, T and the 6 corners as numbered yellow dots 1 앞 왼쪽 -> 2 앞 오른쪽 -> 3 옆 왼쪽 -> 4 옆 오른쪽 -> 5 뒤 왼쪽 -> 6 뒤 오른쪽 with a dashed line from T to each, text "T에서 출발해 번호 순서로 코너를 라켓으로 찍고 매번 T로 돌아옵니다. 3바퀴(18회).", the start-signal sentence and the reason no result is shown yet); summary = ghosting total with "시작: 만세 m:ss.s" (or "시작 신호(만세) 못 찾음"), visits (warning if not 18), slowest corner; panel = calibration, small map, visit table (click = seek), recovery heart rate: inputs A (right after) and B (1 min later), recovery = A - B (`recoveryHr`), saved per video name in localStorage (`sqc_hr_<name>`), exported as `hr: {a, b, recovery}` in `meta.json` and `court.json` (nulls when empty).
4. 변화 기록: replaces the video area, see below.

**Checkpoint rule per tab**: groups shown = 자세 조정 {런지, 준비 자세, 스윙}, 게임 분석 {무빙}, 스텝·체력 none. So lunge angle items are judged and drawn on the video only in 자세 조정. Automatic captures always judge every angle item and always carry the 자세 조정 check box on the PNG (`render(true)`). Manual captures store the checkpoints of the current tab.

**Item display**: status dot, `name`, one-line `plain` (new field in checkpoints.json, required by the check), for angle items a target range bar (green band = target, pin + number = my value; no bar for `target: null`, only the value and "기준선 비교"), small gray confidence, "근거 보기" link that expands channel, title, time (new-tab link) and the item note. For items with a target: "감지 N번 중 M번 통과" from the automatic events. Visual items live in the "눈으로 확인" fold (통과/미달/해당없음 buttons; opened by default in 게임 분석). Current-frame angles: 무릎 L, 무릎 R, 발 간격 always; hip, elbow, trunk in the "상세 각도" fold. "근거" fold lists every source of the tab's items.

**고급 설정** (popover): fps, stride, 각도 2D/3D, 라켓 손, 뼈대 표시 (모든 사람 / 선택한 사람만), 영상 위 체크 표시, 묶음 이름, 저장 위치 바꾸기. The header keeps only the angle mode chip.

**fps**: auto-detect as in 1c. On failure the full analysis is blocked (`fpsOk` false) and a large notice with quick buttons 30 / 60 / 120 / 240 appears; choosing one (or editing the fps field) sets fps and stride and unblocks.

**Export folder**: the `showDirectoryPicker` handle is stored in IndexedDB (`sqc` / `kv` / `dir`); `requestPermission({mode:'readwrite'})` is called at every export or history load (user gesture). "저장 위치 바꾸기" re-picks. The same handle serves 변화 기록. Without the API exports fall back to downloads.

**Tab suggestion** (text + button, never switches by itself, AI-set values): two persons in at least 25% of the analysed frames -> 게임 분석; else with a calibration and at least 15% of valid positions 2 m or more from T -> 스텝·체력; else 자세 조정. Shown only when it differs from the current tab.

**Fullscreen**: button and `F` toggle the video stage (Fullscreen API), Esc returns. The skeleton, check box, frame info, arrow keys (Shift = 10), Space and C keep working. Shortcuts Space, arrows, Shift+arrows, C, F are listed in the header "단축키".

**변화 기록 tab**: button "sessions 폴더 연결" (saved handle, permission asked again; fallback `<input webkitdirectory>` "폴더 여러 파일 선택"). Every sub folder with a `meta.json` is one record (`events.json`, `court.json`, `angles.csv` optional). Date-ordered table of six metrics with the change versus the previous record that has that metric (text like "+3.2°", "-1.5초", "첫 기록", "변화 없음", "기록 없음"; good = green, bad = red, no direction = gray) and one small trend chart per metric.

`app/history.mjs` (pure): `summarizeSession({name, meta, events, court, csv}, {auto_detect})` -> `knee_min_avg` (mean of the smaller knee at the events), `stance_avg`, `t_occ`, `ghost_total` (only if visits exist), `slow_corner` (mean seconds of the slowest corner), `hr_recovery`, plus `n_events`, `ghost_visits`, `slow_corner_name`, `date`, `label`. Without `events.json` the events are computed from `angles.csv` (person 1) with `meta.auto_detect` or the current checkpoints.json values. `diffSessions(prev, cur, {kneeTarget})`: ghosting time and slowest-corner time lower is better; T occupancy and recovery HR higher is better; the knee is better when it gets closer to the lunge target range (`lunge_front_knee.target`, inside = distance 0); stance ratio has no direction. `withDiffs(list)` sorts by date and compares each metric with the nearest earlier session that has it. `recoveryHr(a, b)` = a - b, null if either is missing.

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

`tests/check.mjs` (node, `node:assert`): angle function on known triangles (90°, 180°, 45°), trunk lean on a vertical and a tilted segment, 3D angle/trunk lean, stance ratio, front/back leg decision, racket-hand alias mapping, `judge` (inside / outside / null target), `app/checkpoints.json` required keys (including `auto_detect`, `court` with `hands_up_min_sec`, and `overlay_ids`: 1 to 3 ids, all present in `checkpoints`, all angle items), `detectEvents` on the real `sessions/2026-10-16-IMG_1224/angles.csv` (must give the 7 frames above) and on synthetic valleys (0.7 s merge rule, shallow dip, spike), `fpsFromDeltas` (120/60/30 and others with jitter and dropped frames), `strideFor`, `plain` text on every checkpoint, history (`summarizeSession` on the real `sessions/2026-10-16-IMG_1224/` bundle, `diffSessions` direction rules and missing data, `withDiffs`, `recoveryHr`), `layoutLabels` (no overlap, knee-outside placement, frame clamping), homography (square to unit square, interior points, 5-point least squares, collinear/too-few input gives null), `CAL_ORDER` (same ids as `COURT_POINTS`, 1-7 order as in the wizard) and the guide pictures (`calGuideSvg` states, `ghostGuideSvg`, shared `courtSvg`), `calibrate` + `courtPos` + `footPoint`, `handsUp` and `detectHandsUp` (synthetic: span, blip, track end, null samples), `cornerOf` boundaries, `detectExcursions` on a synthetic path (2 visits, short wobble and one-sample spike ignored), `tOccupancy`, and every docs/data/*.json parses and has the required keys. Must pass with `node tests/check.mjs`.

## Done means

- `start.bat` opens the app; a local video shows skeleton overlay, frame stepping works, full analysis produces chart, export writes the bundle.
- Dashboard renders with seed data (empty states) and with a temporary sample (verify, then remove sample).
- `node tests/check.mjs` passes. Local git repo initialized with commits. Nothing pushed.
