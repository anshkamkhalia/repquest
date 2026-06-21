export type ExerciseId = 'pushup' | 'squat' | 'lunge';

export type FeedbackStatus = 'idle' | 'correct' | 'incorrect';

export type FeedbackState = {
  status: FeedbackStatus;
  message: string;
};

export type Difficulty = 'easy' | 'medium' | 'hard';

export type DifficultyPref = Difficulty | 'auto';

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

export const DIFFICULTY_PREFS: DifficultyPref[] = ['auto', 'easy', 'medium', 'hard'];

export const DIFFICULTY_LABEL: Record<DifficultyPref, string> = {
  auto: 'Auto',
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

type Level = { target: number; points: number };

type ExerciseConfig = {
  title: string;
  messages: Record<FeedbackStatus, string>;
  tips: string[];
  levels: Record<Difficulty, Level>;
};

export const EXERCISE_CONFIG: Record<ExerciseId, ExerciseConfig> = {
  pushup: {
    title: 'Push-ups',
    messages: {
      idle: 'Line up with the camera',
      correct: 'Clean rep',
      incorrect: 'Hips sagging — brace your core',
    },
    tips: ['Keep your hips level with your shoulders', 'Lower until elbows hit 90°', 'Full lockout at the top'],
    levels: {
      easy: { target: 5, points: 10 },
      medium: { target: 10, points: 20 },
      hard: { target: 20, points: 30 },
    },
  },
  squat: {
    title: 'Squats',
    messages: {
      idle: 'Line up with the camera',
      correct: 'Clean rep',
      incorrect: 'Drop lower — hit depth',
    },
    tips: ['Hit at least parallel depth', 'Keep your knees tracking over your toes', 'Chest up, weight in your heels'],
    levels: {
      easy: { target: 10, points: 10 },
      medium: { target: 15, points: 20 },
      hard: { target: 20, points: 30 },
    },
  },
  lunge: {
    title: 'Lunges',
    messages: {
      idle: 'Line up with the camera',
      correct: 'Clean rep',
      incorrect: 'Keep your torso upright',
    },
    tips: ['Front knee stays over your ankle', 'Drop your back knee toward the floor', 'Keep your torso tall'],
    levels: {
      easy: { target: 10, points: 10 },
      medium: { target: 16, points: 20 },
      hard: { target: 20, points: 30 },
    },
  },
};

export const EXERCISE_IDS: ExerciseId[] = ['pushup', 'squat', 'lunge'];

// Daily points needed to keep a streak alive.
export const STREAK_THRESHOLD = 15;

export type Quest = {
  exercise: ExerciseId;
  difficulty: Difficulty;
  target: number;
  points: number;
};

export function buildQuest(exercise: ExerciseId, difficulty: Difficulty): Quest {
  const config = EXERCISE_CONFIG[exercise];
  const level = config.levels[difficulty];
  return {
    exercise,
    difficulty,
    target: level.target,
    points: level.points,
  };
}

// Difficulty climbs as the athlete banks more points.
export function recommendedDifficulty(points: number): Difficulty {
  if (points < 250) return 'easy';
  if (points < 800) return 'medium';
  return 'hard';
}

export function resolveDifficulty(pref: DifficultyPref, points: number): Difficulty {
  return pref === 'auto' ? recommendedDifficulty(points) : pref;
}

export function randomQuest(difficulty: Difficulty): Quest {
  const exercise = EXERCISE_IDS[Math.floor(Math.random() * EXERCISE_IDS.length)];
  return buildQuest(exercise, difficulty);
}
