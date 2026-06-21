// Quality classification ported from the Python pipeline (src/final.py,
// src/universal_trainer.py extract_features). Feeds the same 110-dim feature
// vector, in the same 106-frame non-overlapping windows, into the compiled
// tflite_models/{pushup,lunge}.tflite graphs the Python side trained.
//
// Squat is intentionally left out — final.py itself skips the squat model and
// only does angle-based rep counting for it (see RepCounter in pose-analysis.ts).

import { IDX, angle2, mid, type Landmark } from "./pose-analysis";

export const SEQ_LEN = 106;
export const FEATURE_LEN = 110;

export type QualityExerciseId = "pushup" | "lunge";

function dist2(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Direct port of Exercise.extract_features (universal_trainer.py:92-160).
export function extractFeatures(lm: Landmark[] | undefined): Float32Array {
  const out = new Float32Array(FEATURE_LEN);
  if (!lm || lm.length < 33) return out;

  const lShoulder = lm[IDX.lShoulder];
  const rShoulder = lm[IDX.rShoulder];
  const lElbow = lm[IDX.lElbow];
  const rElbow = lm[IDX.rElbow];
  const lWrist = lm[IDX.lWrist];
  const rWrist = lm[IDX.rWrist];
  const lHip = lm[IDX.lHip];
  const rHip = lm[IDX.rHip];
  const lKnee = lm[IDX.lKnee];
  const rKnee = lm[IDX.rKnee];
  const lAnkle = lm[IDX.lAnkle];
  const rAnkle = lm[IDX.rAnkle];

  const elbowAngleL = angle2(lShoulder, lElbow, lWrist);
  const elbowAngleR = angle2(rShoulder, rElbow, rWrist);
  const elbowAngle = (elbowAngleL + elbowAngleR) / 2;

  const midShoulder = mid(lShoulder, rShoulder);
  const midHip = mid(lHip, rHip);
  const midKnee = mid(lKnee, rKnee);
  const midAnkle = mid(lAnkle, rAnkle);
  const bodyLineAngle = angle2(midShoulder, midHip, midKnee);

  const shoulderAnkleX = midAnkle.x - midShoulder.x;
  const shoulderAnkleY = midAnkle.y - midShoulder.y;
  const shoulderHipX = midHip.x - midShoulder.x;
  const shoulderHipY = midHip.y - midShoulder.y;
  const lineLen = Math.hypot(shoulderAnkleX, shoulderAnkleY) + 1e-6;
  const t =
    (shoulderHipX * shoulderAnkleX + shoulderHipY * shoulderAnkleY) /
    (lineLen * lineLen);
  const projectedY = midShoulder.y + t * shoulderAnkleY;
  const hipOffset = midHip.y - projectedY;

  const shoulderAngleL = angle2(lElbow, lShoulder, lHip);
  const shoulderAngleR = angle2(rElbow, rShoulder, rHip);
  const shoulderAngle = (shoulderAngleL + shoulderAngleR) / 2;

  const wristShoulderDist = (dist2(lWrist, lShoulder) + dist2(rWrist, rShoulder)) / 2;
  const hipShoulderYOffset = midHip.y - midShoulder.y;

  const kneeAngleL = angle2(lHip, lKnee, lAnkle);
  const kneeAngleR = angle2(rHip, rKnee, rAnkle);
  const kneeAngle = (kneeAngleL + kneeAngleR) / 2;

  out[0] = elbowAngle;
  out[1] = bodyLineAngle;
  out[2] = hipOffset;
  out[3] = shoulderAngle;
  out[4] = wristShoulderDist;
  out[5] = hipShoulderYOffset;
  out[6] = kneeAngle;
  out[7] = elbowAngleL;
  out[8] = elbowAngleR;
  out[9] = kneeAngleL;
  out[10] = kneeAngleR;

  // landmarks_flat = p.flatten() over all 33 landmarks (x, y, z), row-major.
  for (let i = 0; i < 33; i += 1) {
    const p = lm[i];
    out[11 + i * 3] = p.x;
    out[11 + i * 3 + 1] = p.y;
    out[11 + i * 3 + 2] = p.z;
  }

  return out;
}

// label_map order from final.py / live_webcam_test.py — argmax index = array index.
export const LABEL_MAPS: Record<QualityExerciseId, string[]> = {
  pushup: ["good_pushup", "high_hip_pushup", "low_hip_pushup"],
  lunge: ["angled_back_lunge", "good_lunge", "partial_lunge"],
};

// score_map from final.py:36-43.
export const SCORE_MAP: Record<string, number> = {
  good_pushup: 1.0,
  good_lunge: 1.0,
  low_hip_pushup: 0.25,
  high_hip_pushup: 0.5,
  partial_lunge: 0.25,
  angled_back_lunge: 0.5,
};

export const GOOD_LABEL: Record<QualityExerciseId, string> = {
  pushup: "good_pushup",
  lunge: "good_lunge",
};

const QUALITY_MESSAGE: Record<string, string> = {
  good_pushup: "Clean rep",
  high_hip_pushup: "Hips too high — flatten your back",
  low_hip_pushup: "Hips sagging — brace your core",
  good_lunge: "Clean rep",
  angled_back_lunge: "Keep your torso upright",
  partial_lunge: "Go deeper — front knee to 90°",
};

// Short noun-phrase version of every label (including the "good" ones) — used
// for the post-set "Most common issue" summary and the live per-class
// probability readout, where the longer coaching copy above is too long.
export const CLASS_LABEL: Record<string, string> = {
  good_pushup: "Good form",
  high_hip_pushup: "Hips too high",
  low_hip_pushup: "Hips sagging",
  good_lunge: "Good form",
  angled_back_lunge: "Torso leaning back",
  partial_lunge: "Partial range of motion",
};

export type QualityResult = {
  label: string;
  score: number;
  good: boolean;
  message: string;
  // Raw softmax probability of the chosen label (model confidence, distinct
  // from `score`'s fixed quality weight) and the full per-class breakdown —
  // useful for sanity-checking the model live instead of just trusting argmax.
  confidence: number;
  probs: { label: string; prob: number }[];
};

// argmax over a 3-class softmax output, decoded against LABEL_MAPS/SCORE_MAP.
export function decodeQuality(
  exercise: QualityExerciseId,
  output: ArrayLike<number>,
): QualityResult {
  const labels = LABEL_MAPS[exercise];
  let best = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < output.length; i += 1) {
    if (output[i] > bestVal) {
      bestVal = output[i];
      best = i;
    }
  }
  const label = labels[best] ?? GOOD_LABEL[exercise];
  return {
    label,
    score: SCORE_MAP[label] ?? 0.5,
    good: label === GOOD_LABEL[exercise],
    message: QUALITY_MESSAGE[label] ?? "",
    confidence: bestVal,
    probs: labels.map((l, i) => ({ label: l, prob: output[i] ?? 0 })),
  };
}

// Mirrors final.py's buffer: append every frame, run inference once it hits
// SEQ_LEN, then reset to empty (non-overlapping windows, not synced to reps).
export class QualityBuffer {
  private frames: Float32Array[] = [];

  push(features: Float32Array): Float32Array[] | null {
    this.frames.push(features);
    if (this.frames.length < SEQ_LEN) return null;
    const window = this.frames;
    this.frames = [];
    return window;
  }

  reset() {
    this.frames = [];
  }
}

// Flattens a SEQ_LEN-length array of FEATURE_LEN vectors into the
// [1, SEQ_LEN, FEATURE_LEN] row-major buffer tflite expects.
export function flattenWindow(window: Float32Array[]): Float32Array {
  const flat = new Float32Array(SEQ_LEN * FEATURE_LEN);
  for (let t = 0; t < window.length; t += 1) {
    flat.set(window[t], t * FEATURE_LEN);
  }
  return flat;
}

// Mirrors final.py:326-332 — tallies every non-"good" prediction across the
// set and surfaces the most frequent one, e.g. for a post-set summary.
export class IssueTracker {
  private counts = new Map<string, number>();

  record(label: string, goodLabel: string) {
    if (label === goodLabel) return;
    this.counts.set(label, (this.counts.get(label) ?? 0) + 1);
  }

  mostCommonIssue(): string | null {
    let best: string | null = null;
    let bestCount = 0;
    for (const [label, count] of this.counts) {
      if (count > bestCount) {
        bestCount = count;
        best = label;
      }
    }
    return best;
  }

  reset() {
    this.counts.clear();
  }
}
