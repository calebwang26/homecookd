// Mirrors pipeline/schema.py (the source of truth). All times are whole seconds
// from the start of the recipe's play.mp4; one pair drives both Watch & Hear.

export type Confidence = 'low' | 'medium' | 'high';

export type Cook = { name: string; relation: string };

export type Media = {
  video_url: string | null;
  audio_url: string | null;
  poster_url: string | null;
  duration_s: number;
  width?: number | null; // play.mp4 frame size
  height?: number | null;
};

export type Session = {
  index: number;
  recorded_at: string | null;
  offset_s: number;
  duration_s: number;
};

export type Ingredient = {
  name: string;
  feel: string; // the cook's own words, always shown
  estimate: string; // starts with "~" or is "unknown"
  confidence: Confidence;
  first_seen_s: number | null;
  /**
   * Added after the video: the cook said yes to homie's "Did you add …?" (convex/followUps.ts,
   * recipes.addedIngredients). `said` is her answer ("a handful, at the start"), in English when there is one.
   */
  confirmed?: { said: string | null; step: number | null };
};

export type Step = {
  order: number;
  title: string;
  instruction: string;
  sensory_cue: string | null;
  start_s: number;
  end_s: number;
  quote: string | null; // in English
  quote_original?: string | null; // the cook's words as spoken when not English (Marathi, in Devanagari)
  wait_after: string | null;
  story_ids: string[];
  special_ids: string[];
  image_url?: string | null; // a still from this step's video (publish.py)
  // Cook mode's short version (pipeline/shorten.py). Old recipes don't have them: the app splits
  // `instruction` instead (components/recipe/steps.ts).
  substeps?: Substep[] | null;
  uses?: StepIngredient[] | null; // what this step needs, reused ingredients included
  tip?: string | null; // one useful tip in the cook's own words
};

/** One short line (`**bold**` marks amounts, heat & times); `detail` opens on tap. */
export type Substep = {
  text: string;
  detail?: string | null;
  /** Absolute whole seconds on the recording (play.mp4 / voice.m4a, the step's clock) where this substep
   * begins: the first equals the step's start_s, strictly increasing, all before its end_s. Null or absent
   * on recipes without media. */
  start_s?: number | null;
};

/** An ingredient a step uses; `name` matches an Ingredient's name. */
export type StepIngredient = { name: string; amount?: string | null };

export type Story = {
  id: string;
  step: number;
  start_s: number;
  end_s: number;
  title: string;
  text: string;
};

export type Special = {
  id: string;
  step: number;
  start_s: number;
  end_s: number | null;
  text: string;
  why: string;
};

export type FollowUpQuestion = {
  id: string;
  about_step: number | null;
  question: string;
};

export type Recipe = {
  id: string;
  title: string;
  cook: Cook;
  intro: string;
  servings: string | null;
  total_time: string | null;
  sample: boolean;
  source: string | null;
  tags: string[];
  media: Media;
  sessions: Session[];
  ingredients: Ingredient[];
  steps: Step[];
  stories: Story[];
  special: Special[];
  follow_up_questions: FollowUpQuestion[];
};

export type LibraryEntry = {
  id: string;
  title: string;
  cook_name: string;
  /**
   * The family profile who cooked it (familyEntries), when the recipe's cookId is one of the family's profiles
   * (1.1: they share one id). library.json's dishes, and Convex's (its people ids aren't profile ids), have none.
   */
  cook_id?: string;
  relation: string;
  poster_url: string | null;
  tags: string[];
  sample: boolean;
  recipe_url: string;
};
