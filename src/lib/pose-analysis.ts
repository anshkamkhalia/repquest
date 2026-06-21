// Pose analysis ported from the Python pipeline (src/final.py, src/universal_trainer.py).
// Rep counting uses the same angle state-machine and thresholds. Form feedback is
// derived geometrically from the same body angles the trained models look at, so it
// stays robust without shipping a model to the browser.

export type Landmark = { x: number; y: number; z: number; visibility?: number };

export type RepExerciseId = "pushup" | "squat" | "lunge";

// MediaPipe BlazePose landmark indices.
const IDX = {
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
} as const;

type Pt = { x: number; y: number; z: number };

function angle3(a: Pt, b: Pt, c: Pt): number {
  const bax = a.x - b.x;
  const bay = a.y - b.y;
  const baz = a.z - b.z;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const bcz = c.z - b.z;
  const dot = bax * bcx + bay * bcy + baz * bcz;
  const magBa = Math.sqrt(bax * bax + bay * bay + baz * baz);
  const magBc = Math.sqrt(bcx * bcx + bcy * bcy + bcz * bcz);
  const cos = dot / (magBa * magBc + 1e-6);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

// 2D angle (x/y only) — matches extract_features which slices [:2].
function angle2(a: Pt, b: Pt, c: Pt): number {
  const bax = a.x - b.x;
  const bay = a.y - b.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const dot = bax * bcx + bay * bcy;
  const magBa = Math.sqrt(bax * bax + bay * bay);
  const magBc = Math.sqrt(bcx * bcx + bcy * bcy);
  const cos = dot / (magBa * magBc + 1e-6);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

// rep_map (MIN_ANGLE, UPRIGHT_POS_ANGLE) and rep_map_kypts from final.py.
const REP_CONFIG: Record<
  RepExerciseId,
  {
    min: number;
    upright: number;
    right: [number, number, number];
    left: [number, number, number];
  }
> = {
  pushup: {
    min: 90,
    upright: 150,
    right: [IDX.lWrist, IDX.lElbow, IDX.lShoulder],
    left: [IDX.rWrist, IDX.rElbow, IDX.rShoulder],
  },
  squat: {
    min: 87.5,
    upright: 150,
    right: [IDX.lHip, IDX.lKnee, IDX.lAnkle],
    left: [IDX.rHip, IDX.rKnee, IDX.rAnkle],
  },
  lunge: {
    min: 90,
    upright: 140,
    right: [IDX.lHip, IDX.lKnee, IDX.lAnkle],
    left: [IDX.rHip, IDX.rKnee, IDX.rAnkle],
  },
};

const WAIT_FRAMES = 20;

// How far past "clean" a body angle has to drift before we call out the form.
// Kept generous so feedback only fires when form is clearly off.
const FORM_LIMIT: Record<RepExerciseId, number> = {
  pushup: 26, // body-line deviation from straight (degrees)
  squat: 48, // torso lean from vertical (degrees)
  lunge: 38, // torso lean from vertical (degrees)
};

const FORM_MESSAGE: Record<RepExerciseId, string> = {
  pushup: "Keep your body in a straight line",
  squat: "Keep your chest up",
  lunge: "Keep your torso upright",
};

// Per-exercise geometric "how bad is the form right now" metric (higher = worse).
function formMetric(exercise: RepExerciseId, lm: Landmark[]): number {
  const midShoulder = mid(lm[IDX.lShoulder], lm[IDX.rShoulder]);
  const midHip = mid(lm[IDX.lHip], lm[IDX.rHip]);

  if (exercise === "pushup") {
    const midKnee = mid(lm[IDX.lKnee], lm[IDX.rKnee]);
    const bodyLine = angle2(midShoulder, midHip, midKnee);
    return Math.abs(180 - bodyLine);
  }

  // squat / lunge: how far the torso leans away from vertical.
  const torsoX = midShoulder.x - midHip.x;
  const torsoY = midShoulder.y - midHip.y;
  const mag = Math.sqrt(torsoX * torsoX + torsoY * torsoY) + 1e-6;
  // image y grows downward, so "up" is (0, -1).
  const cos = -torsoY / mag;
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

export type RepUpdate = {
  reps: number;
  repCompleted: boolean;
  formBad: boolean;
  message: string | null;
};

// Mirrors the rep cycle in final.py: idle -> initial (up) -> low (down) -> back up.
export class RepCounter {
  reps = 0;
  private initial = false;
  private low = false;
  private backUp = false;
  private waitOver = true;
  private waitFramesRemaining = 0;
  private worstForm = 0;

  constructor(private exercise: RepExerciseId) {}

  update(lm: Landmark[]): RepUpdate {
    const cfg = REP_CONFIG[this.exercise];
    const rightAngle = angle3(
      lm[cfg.right[0]],
      lm[cfg.right[1]],
      lm[cfg.right[2]],
    );
    const leftAngle = angle3(lm[cfg.left[0]], lm[cfg.left[1]], lm[cfg.left[2]]);

    if (this.initial) {
      this.worstForm = Math.max(this.worstForm, formMetric(this.exercise, lm));
    }

    let repCompleted = false;
    let formBad = false;

    if (this.waitOver) {
      if (!this.initial && !this.low && !this.backUp) {
        if (rightAngle > cfg.upright || leftAngle > cfg.upright) {
          this.initial = true;
          this.worstForm = 0;
        }
      } else if (this.initial && !this.low) {
        if (rightAngle < cfg.min || leftAngle < cfg.min) this.low = true;
      } else if (this.initial && this.low && !this.backUp) {
        if (rightAngle > cfg.upright || leftAngle > cfg.upright)
          this.backUp = true;
      }

      if (this.initial && this.low && this.backUp) {
        this.initial = false;
        this.low = false;
        this.backUp = false;
        this.waitOver = false;
        this.waitFramesRemaining = WAIT_FRAMES;
        this.reps += 1;
        repCompleted = true;
        formBad = this.worstForm > FORM_LIMIT[this.exercise];
        this.worstForm = 0;
      }
    } else {
      this.waitFramesRemaining -= 1;
      if (this.waitFramesRemaining <= 0) this.waitOver = true;
    }

    return {
      reps: this.reps,
      repCompleted,
      formBad,
      message: repCompleted
        ? formBad
          ? FORM_MESSAGE[this.exercise]
          : null
        : null,
    };
  }

  reset() {
    this.reps = 0;
    this.initial = false;
    this.low = false;
    this.backUp = false;
    this.waitOver = true;
    this.waitFramesRemaining = 0;
    this.worstForm = 0;
  }
}

// Plank isn't a rep — hold a straight, roughly horizontal body. Returns whether the
// athlete is currently holding a valid plank and a hint when they are not.
export function checkPlank(lm: Landmark[]): {
  holding: boolean;
  message: string | null;
} {
  const midShoulder = mid(lm[IDX.lShoulder], lm[IDX.rShoulder]);
  const midHip = mid(lm[IDX.lHip], lm[IDX.rHip]);
  const midKnee = mid(lm[IDX.lKnee], lm[IDX.rKnee]);

  const bodyLine = angle2(midShoulder, midHip, midKnee);
  const straight = Math.abs(180 - bodyLine) < 22;

  // Torso should be more horizontal than vertical when planking.
  const dx = Math.abs(midShoulder.x - midHip.x);
  const dy = Math.abs(midShoulder.y - midHip.y);
  const horizontal = dx > dy * 0.8;

  if (straight && horizontal) return { holding: true, message: null };
  if (!horizontal)
    return { holding: false, message: "Get into a plank position" };
  return { holding: false, message: "Straighten your back — no sagging" };
}

// Minimum landmark visibility before we trust a frame.
export function poseVisible(lm: Landmark[] | undefined): lm is Landmark[] {
  if (!lm || lm.length < 29) return false;
  const key = [IDX.lShoulder, IDX.rShoulder, IDX.lHip, IDX.rHip];
  let seen = 0;
  for (const i of key) {
    if ((lm[i]?.visibility ?? 1) > 0.4) seen += 1;
  }
  return seen >= 3;
}

// Skeleton connections for the overlay (subset of BlazePose edges).
export const POSE_CONNECTIONS: [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];
