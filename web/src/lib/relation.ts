// "Cooking with" personalization helpers (brief 4.4).
//   fill('Ask {R} to teach you.', 'dad')  → 'Ask Dad to teach you.'
//   fill('/?for={r}', 'dad')              → '/?for=dad'
//   fill('from {cook}', 'dad', { cook: 'Grandma' }) → 'from Grandma'
import type { Relation } from '@/content/types';
import { copy } from '@/content/copy';
import { getItem, setItem } from '@/lib/legacyKeys';

export type { Relation };

export const RELATIONS: Relation[] = ['mom', 'dad', 'grandma', 'grandpa', 'auntie', 'uncle'];
// Mom matches the hero video (a mom cooking with her adult son and daughter).
export const DEFAULT_RELATION: Relation = 'mom';
// One key per version: on /learn the relation is who the visitor cooks with, on /teach it is the
// visitor's own role, so a pick on one page never leaks into the other.
export const STORAGE_KEY = 'homecookd.relation';
export const STORAGE_KEY_PARENT = 'homecookd.role';

export const RELATION_LABEL: Record<Relation, string> = copy.nav.relations;

export function isRelation(v: unknown): v is Relation {
  return typeof v === 'string' && (RELATIONS as string[]).includes(v);
}

export function labelOf(rel: Relation): string {
  return RELATION_LABEL[rel];
}

/** Replace {R} (label), {r} (slug), the person tokens below and any extra {key} tokens. */
export function fill(str: string, rel: Relation, extra?: Record<string, string>): string {
  let out = str.replace(/\{R\}/g, RELATION_LABEL[rel]).replace(/\{r\}/g, rel);
  if (out.includes('{')) for (const [k, v] of Object.entries(personTokens(rel))) out = out.split(`{${k}}`).join(v);
  if (extra) for (const [k, v] of Object.entries(extra)) out = out.split(`{${k}}`).join(v);
  return out;
}

const HE: ReadonlySet<Relation> = new Set<Relation>(['dad', 'grandpa', 'uncle']);
const GRAND: ReadonlySet<Relation> = new Set<Relation>(['grandma', 'grandpa']);

/**
 * Person tokens for fill(), so one template reads right for any relation:
 * {R's} → "Mom's", {She}/{she} → "She"/"he", {her} → "her"/"his", {herself} → "herself"/"himself",
 * and for the parent version (where the relation is the visitor's own role) {kids} → "kids", or
 * "grandkids" for Grandma and Grandpa.
 *   fillPerson('{R} films {herself} cooking', 'dad') → 'Dad films himself cooking'
 * Every token is one word, so word-by-word animations keep their word count when the relation changes.
 */
export function personTokens(rel: Relation): Record<string, string> {
  const he = HE.has(rel);
  return {
    "R's": `${RELATION_LABEL[rel]}'s`,
    She: he ? 'He' : 'She',
    she: he ? 'he' : 'she',
    her: he ? 'his' : 'her',
    herself: he ? 'himself' : 'herself',
    kids: GRAND.has(rel) ? 'grandkids' : 'kids',
  };
}

export function fillPerson(str: string, rel: Relation): string {
  return fill(str, rel, personTokens(rel));
}

/** The relation whose label is shown ("Grandma" → 'grandma'); the default for anything else. */
export function relationOfLabel(label: string): Relation {
  return RELATIONS.find((r) => RELATION_LABEL[r] === label) ?? DEFAULT_RELATION;
}

/** Read ?for= then localStorage (client only). Returns null when neither is set. */
export function readStoredRelation(key: string = STORAGE_KEY): Relation | null {
  if (typeof window === 'undefined') return null;
  try {
    const q = new URLSearchParams(window.location.search).get('for')?.toLowerCase();
    if (isRelation(q)) return q;
  } catch {
    /* ignore */
  }
  try {
    const s = getItem(key);
    if (isRelation(s)) return s;
  } catch {
    /* storage blocked */
  }
  return null;
}

export function writeStoredRelation(rel: Relation, key: string = STORAGE_KEY): void {
  try {
    setItem(key, rel);
  } catch {
    /* storage blocked */
  }
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('for', rel);
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    /* ignore */
  }
}
