// What one row becomes (SCHEMA.md section 2). A Convex row keeps its Convex id, and its old uuid stays in supabase_id. Name, role, email, tz and
// consent come from Supabase; language, voice clone consent and place from Convex; `relation` from Convex, else Supabase. Pure: no database, no outside call.
// A row with no Convex side isn't copied at all: SYNC-MIGRATION.md says why.
import type { ConvexFamily, ConvexPerson, ConvexRecipe, SupabaseFamily, SupabaseProfile } from "./sources.js";
import { isSupabaseId } from "./sources.js";

/** A row we can't turn into a copy. Reported by id and this rule, which holds none of the row's values. */
export class RowRule extends Error {
  override name = "RowRule";
  readonly rule: string;
  constructor(rule: string) {
    super(rule);
    this.rule = rule;
  }
}

export const lowerUuid = (id: string) => (isSupabaseId(id) ? id.toLowerCase() : id);

function at(value: number | string | null | undefined): Date | null {
  if (value === undefined || value === null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RowRule("bad_time");
  return date;
}

export const BLANK_NAME = "Deleted";

/** `blank`: the last person here deleted their account (C2), so a stale name can't come back. */
export function mergeFamily(family: ConvexFamily, supabase: SupabaseFamily | null, blank: boolean) {
  return {
    id: family._id,
    supabase_id: lowerUuid(family.supabaseFamilyId),
    name: blank ? BLANK_NAME : (supabase?.name ?? family.name),
    public_name: blank ? null : (family.publicName ?? null),
    moss_sync_started_at: at(family.mossSync?.startedAt),
    moss_sync_again: family.mossSync?.again ?? false,
    created_at: at(family._creationTime),
  };
}

/** A live person. `familyId` is Supabase's answer where one maps to a copied family: it wins, because membership lives there today (section 5). */
export function mergePerson(person: ConvexPerson, supabase: SupabaseProfile | null, familyId: string) {
  return {
    id: person._id,
    family_id: familyId,
    supabase_id: lowerUuid(person.supabaseProfileId),
    name: supabase?.name ?? person.name,
    role: supabase ? (supabase.role === "learner" ? "kid" : supabase.role) : person.role,
    relation: person.relation ?? supabase?.relation ?? null,
    avatar_key: supabase?.avatar_key ?? null,
    sort: supabase?.sort ?? 0,
    email: supabase?.email ?? null,
    tz: supabase?.tz ?? null,
    share_cooking: supabase?.share_cooking ?? null,
    memorial: supabase?.memorial ?? false,
    language: person.language ?? null,
    voice_clone_consented_at: at(person.voiceClone?.consentedAt),
    approx_lat: person.approx?.lat ?? null,
    approx_lng: person.approx?.lng ?? null,
    campus: person.campus ?? null,
    removed_at: at(supabase?.removed_at),
    created_at: at(person._creationTime),
  };
}

// convex/community.ts's PUBLIC_COVER, with the path as a group.
const PUBLIC_COVER = /^https:\/\/homecookd\.app\/media\/((?:stock|app-covers)\/[\w.-]+\.(?:jpg|jpeg|png|webp))$/;

/** `https://storage.googleapis.com/<bucket>/<path>?v=<generation>` (section 5). Anything else is held out, not guessed at. */
function gcsParts(url: string): { key: string; version: string | null } {
  try {
    const parsed = new URL(url);
    const match = parsed.hostname === "storage.googleapis.com" ? /^\/edible-[a-z0-9-]+\/(.+)$/.exec(parsed.pathname) : null;
    if (match) return { key: decodeURIComponent(match[1]), version: parsed.searchParams.get("v") };
  } catch {
    // falls through: a URL that doesn't parse is one we don't know
  }
  throw new RowRule("recipe_url_unknown");
}

function cover(url: string | undefined) {
  if (!url) return { cover_key: null, cover_version: null, cover_stock_path: null };
  const stock = PUBLIC_COVER.exec(url);
  if (stock) return { cover_key: null, cover_version: null, cover_stock_path: stock[1] };
  const { key, version } = gcsParts(url);
  return { cover_key: key, cover_version: version, cover_stock_path: null };
}

/** media_prefix stays null: only the job that made a recipe knows its folder, and jobs aren't copied. The purge in GCS stays with Convex. */
export function mergeRecipe(recipe: ConvexRecipe) {
  return {
    id: recipe._id,
    family_id: recipe.familyId,
    cook_id: recipe.cookId,
    title: recipe.title,
    status: recipe.status,
    library_id: recipe.libraryId ?? null,
    recipe_json_key: recipe.recipeJsonUrl ? gcsParts(recipe.recipeJsonUrl).key : null,
    ...cover(recipe.coverUrl),
    steps: recipe.steps,
    memories: recipe.memories,
    added_ingredients: recipe.addedIngredients ?? [],
    memories_opt_in: recipe.memoriesOptIn,
    moss_indexed_at: at(recipe.mossIndexedAt),
    language: recipe.language ?? null,
    shared_at: at(recipe.sharedAt),
    story_card_text: recipe.storyCard?.text ?? null,
    story_card_written_at: at(recipe.storyCard?.writtenAt),
    story_card_used_stories: recipe.storyCard?.usedStories ?? null,
    story_card_culture: recipe.storyCard?.culture ?? null,
    story_card_quote: recipe.storyCard?.quote ?? null,
    hidden_at: at(recipe.hiddenAt),
    created_at: at(recipe._creationTime),
  };
}
