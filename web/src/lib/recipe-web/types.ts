// Recipe types for the web recipe page (/r). Mirrors app/src/lib/types.ts, which mirrors
// pipeline/schema.py (the source of truth). All times are whole seconds from the start of the
// recipe's play.mp4; one pair drives both Watch and Hear.

export type Confidence = 'low' | 'medium' | 'high';

export type Ingredient = {
  name: string;
  feel: string; // the cook's own words, always shown when present
  estimate: string; // starts with "~" or is "unknown"
  confidence: Confidence;
  first_seen_s: number | null;
};

export type Step = {
  order: number;
  title: string;
  instruction: string;
  sensory_cue: string | null;
  start_s: number;
  end_s: number;
  quote: string | null;
  wait_after: string | null;
  story_ids: string[];
  special_ids: string[];
  image_url?: string | null;
};

export type Story = { id: string; step: number; start_s: number; end_s: number; title: string; text: string };

export type Special = { id: string; step: number; start_s: number; end_s: number | null; text: string; why: string };

export type Recipe = {
  id: string;
  title: string;
  cook: { name: string; relation: string };
  intro: string;
  servings: string | null;
  total_time: string | null;
  sample: boolean;
  source: string | null;
  tags: string[];
  media: {
    video_url: string | null;
    audio_url: string | null;
    poster_url: string | null;
    duration_s: number;
    width?: number | null;
    height?: number | null;
  };
  ingredients: Ingredient[];
  steps: Step[];
  stories: Story[];
  special: Special[];
};

/** GET /shares/:token (public). See docs/build/SPEC.md section 4. */
export type Share = {
  token: string;
  recipe_id: string;
  recipe_url: string;
  sender: { name: string; relation: string | null; avatar_key: string | null } | null;
  family_name: string | null;
};

/** POST /invites/peek (public, no side effects). See docs/build/FEEDBACK-OCT16c.md A4 and E2. */
export type InviteStatus = 'pending' | 'used' | 'expired' | 'revoked';

export type Invitee = { name: string; role: 'cook' | 'learner'; avatar_key: string | null };

export type InvitePeek = {
  status: InviteStatus;
  family_name: string | null;
  inviter: { name: string; relation: string | null; avatar_key: string | null } | null;
  /** Who the invite is for; null for a family invite (one link for whoever opens it, E2). */
  invitee: Invitee | null;
  expires_at: string | null;
  code?: string | null; // optional: the invite link's ?c= is the usual source
};
