# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this repo is

RepQuest has two halves that share model artifacts but not code:

1. **The app** (`src/app`, `src/components`, `src/lib`, `src/constants`) — an Expo/React Native client. This is the product.
2. **The ML pipeline** (`src/final.py`, `src/universal_trainer.py`, `src/{pushup,squat,lunge}/`, `evals/`) — Python scripts that collect video, train per-exercise Keras models, and convert them to TFLite. This is research/training tooling, not shipped code.

## Commands

```bash
npm install         # install JS deps
npm start            # expo start (dev server, pick platform from the CLI menu)
npm run ios          # expo run:ios
npm run android      # expo run:android
npm run web          # expo start --web
npm run lint         # expo lint
```

There is no test runner configured (no Jest config, no test script). `npm run reset-project` is the create-expo-app template's reset script (wipes `app` into `app-example`) — this app is well past that starter state, so do not run it.

Python side has no `requirements.txt`/`Pipfile`; dependencies only exist in the local untracked `venv/`. Key imports across the scripts: `tensorflow`, `opencv-python` (`cv2`), `mediapipe`, `numpy`, `tqdm`.

## Expo version note

This project is pinned to Expo SDK 56, which changed significant APIs from earlier SDKs. Per `AGENTS.md` (imported above), check `https://docs.expo.dev/versions/v56.0.0/` before writing any Expo-related code — don't rely on older training knowledge of Expo APIs.

## App architecture

- File-based routing via `expo-router`; screens live in `src/app`. Tab navigation is `src/components/app-tabs.tsx` (native, `expo-router/unstable-native-tabs`) with a `.web.tsx` counterpart for web. Tabs: `index` (Home), `workout` (Train), `leaderboard` (Ranks), `profile` (Profile).
- `@/*` resolves to `src/*` (see `tsconfig.json`).
- `src/app/_layout.tsx` wraps the app in `UserProvider` (`src/lib/user-context.tsx`) and wires notification scheduling (`src/lib/notifications.ts`). User stats/settings are **in-memory only** — no backend or persistence layer exists yet.
- `src/constants/workout-rules.ts` is the single source of truth for exercise metadata: titles, coaching tips, per-difficulty targets/points (`EXERCISE_CONFIG`), and difficulty auto-recommendation based on accumulated points (`recommendedDifficulty`). `buildQuest`/`randomQuest` assemble the `Quest` objects the workout screens consume.
- `src/constants/brand.ts` centralizes all design tokens (`Brand`, `Overlay` — dark theme, warm accent `#e06345`). Pull colors/radii from here rather than hardcoding hex in components.

### The workout camera has two real implementations — both do on-device inference

- **`src/components/workout-preview.tsx`** — the native (iOS/Android) workout screen. Camera feed via `react-native-vision-camera`; pose landmarks via `react-native-mediapipe`'s `usePoseDetection`/`MediapipeCamera`, pointed at the same `pose_landmarker_full.task` file the Python pipeline uses (bundled as a native resource by `plugins/withPoseLandmarkerModel.js`, since `react-native-mediapipe` has no Expo config plugin of its own). Rep counting runs through `src/lib/pose-analysis.ts`; for pushup/lunge, form quality additionally runs through a trained TFLite classifier (`tflite_models/{pushup,lunge}.tflite`, loaded via `react-native-fast-tflite`'s `useTensorflowModel`) every 106 frames, decoded by `src/lib/exercise-model.ts`. Squat has no quality model — `final.py` itself only does angle-based rep counting for it, so `QUALITY_MODEL_ASSETS` only maps pushup/lunge.
- **`src/components/workout-preview.web.tsx`** — the web-only screen (Metro/Expo auto-picks `.web.tsx` for web builds). It loads MediaPipe's `@mediapipe/tasks-vision` PoseLandmarker from a CDN at runtime (dynamic `import()` wrapped in `new Function(...)` so Metro doesn't try to statically bundle it) and feeds landmarks into `src/lib/pose-analysis.ts` for rep counting and form feedback. It does not run the TFLite quality classifiers — `tflite_models/*.tflite` is native-only.
- `react-native.config.js` excludes `react-native-vector-icons` (a transitive dep of `react-native-mediapipe`'s example app, not the API surface actually used) from native autolinking — its codegen doesn't build cleanly under RN 0.85's New Architecture.

`src/lib/pose-analysis.ts` is a hand-ported TypeScript copy of the rep-counting state machine from `src/final.py`/`src/universal_trainer.py` (same angle thresholds in `REP_CONFIG`/`rep_map`, same BlazePose landmark indices). `src/lib/exercise-model.ts` similarly ports `extract_features`/the label and score maps from `universal_trainer.py`/`final.py` for the quality classifiers. If you change rep-counting or quality-feature logic on one side, update the other to match.

## ML pipeline architecture (Python)

- `src/universal_trainer.py` — shared `Exercise` class: pose landmark extraction via MediaPipe Tasks (`pose_landmarker_full.task`), feature engineering (`extract_features`), and data augmentation (`augment_pose`: noise, scale/translation jitter, left/right flip). Used by every per-exercise `train.py`.
- `src/{pushup,squat,lunge}/` — per-exercise `model.py` (Keras model subclass), `train.py`, `rep_counter.py`, `live_webcam_test.py`. Squat has no quality classifier — only rep counting; pushup and lunge each have a trained Keras classifier for form quality.
- `src/final.py` — the integration script combining the rep-counting angle state machine with the trained Keras classifiers (pushup/lunge) for live/video feedback. The file's own header calls it "ground truth for everything" — treat it as the canonical rep-counting + scoring logic when porting behavior elsewhere (e.g. into `pose-analysis.ts`).
- `src/tflite_converter.py` — converts trained `models/*.keras` into `tflite_models/*.tflite` for mobile use.
- `src/recorder.py` — webcam/video capture utility for building training datasets under `data/`/`video_data/` (both gitignored).
- `evals/` — exploratory notebooks/scripts for evaluating the rep counter and the timed-feedback model; not part of the shipped app.
- `archive/` is gitignored scratch video data, not part of the pipeline.
