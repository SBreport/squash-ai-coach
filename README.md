# squash-ai-coach

사람 코치 레슨 없이 AI에게만 배워서 첫 아마추어 스쿼시 대회(2026-11-22)에 나가는 38일 프로젝트의 도구 저장소입니다.
영상은 유튜브에 올리고, 이 저장소에는 분석 도구와 공개 대시보드, 분석 결과만 둡니다.

## 실행

1. `start.bat`을 더블클릭합니다. 검은 서버 창이 뜨고 잠시 뒤 브라우저에서 분석 앱(`http://localhost:8780/app/`)이 열립니다.
2. 작업하는 동안 서버 창은 닫지 마세요. 끝나면 서버 창을 닫으면 됩니다.
3. 대시보드는 `http://localhost:8780/docs/` 에서 미리 볼 수 있습니다.

맥: `start.command`를 더블클릭합니다(처음 한 번은 터미널에서 `chmod +x start.command`가 필요할 수 있음). python3과 Chrome이 필요합니다.

Chrome 또는 Edge를 쓰세요(분석 묶음 내보내기에 필요한 폴더 저장 기능이 이 둘에만 있습니다). 처음 실행할 때 MediaPipe 라이브러리를 인터넷(jsDelivr)에서 받으므로 인터넷 연결이 필요합니다. 자세 모델 파일은 저장소 안(`app/models/`)에 있습니다.

## 분석 앱 사용법

- 영상 열기: 위의 파일 선택 버튼 또는 영상 영역으로 끌어다 놓기
- `Space` 재생/정지, `←` `→` 1프레임 이동, `Shift`+화살표 10프레임 이동, `C` 이 프레임 담기
- fps 칸에 촬영 fps를 넣으세요(기본 60). 프레임 번호와 시간 계산이 이 값을 따릅니다.
- 전체 분석: 영상 전체를 간격(기본 2프레임마다)으로 훑어 각도를 기록하고 그래프를 그립니다. 그래프를 누르면 그 프레임으로 이동합니다.
- 분석 묶음 내보내기: 저장 위치로 이 저장소의 `sessions` 폴더를 고르면 `날짜-라벨` 폴더에 `meta.json`, `angles.csv`, `captures.json`, `frames/*.png`가 저장됩니다.
- 아이폰 영상(HEVC)이 안 열리면 명령 프롬프트에서 변환합니다: `ffmpeg -i in.mov -c:v libx264 -crf 18 -an out.mp4`

## 폴더

| 경로 | 내용 |
|---|---|
| `start.bat` | 로컬 서버(포트 8780)를 띄우고 분석 앱을 엽니다 |
| `app/` | 분석 앱. `index.html`(화면), `angles.mjs`(각도 계산), `models/`(MediaPipe 자세 모델, Apache-2.0) |
| `docs/` | 공개 대시보드(GitHub Pages가 이 폴더를 게시). `data/*.json`이 데이터, `media/`는 대시보드용 이미지 |
| `sessions/` | 분석 앱이 내보낸 분석 묶음 |
| `tests/check.mjs` | 점검 스크립트. `node tests/check.mjs` |

영상 파일(`*.mp4`, `*.mov`, `*.m4v`)은 저장소에 넣지 않습니다(`.gitignore`). 영상은 유튜브로 갑니다.

## 대시보드 데이터

`docs/data/`의 JSON 파일을 고치면 대시보드가 바뀝니다. 형식은 `SPEC.md` 3절을 따릅니다.

- `project.json` 프로젝트 정보와 판정 지표 5개
- `sessions.json` 훈련 일지
- `metrics.json` 지표 측정값(지표마다 첫 값이 기준선)
- `prescriptions.json` 주간 처방
- `reports.json` 주간 코치 리포트
