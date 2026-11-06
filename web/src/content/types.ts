// Shared content types (docs/lander-build-brief.md section 6.1, verbatim).
export type Relation = 'mom' | 'dad' | 'grandma' | 'grandpa' | 'auntie' | 'uncle';
export type Tint = 'sage'|'limeWash'|'butter'|'lemon'|'apricotSoft'|'peach'|'blush'|'ube'|'green'|'forest'|'sun'|'chartreuse';
export type AppClipName = 'web-miss'|'web-answer'|'web-version'|'app-request';

export interface Recipe {
  id: string;
  dish: string;                 // "Hand-Pulled Noodle Soup"
  cook: string;                 // display name as the family says it: "Grandma", "Auntie Lin", "Grandpa Rey"
  relation: Relation;           // for balance checks & chips
  culture: string;              // "Chinese", "Nigerian" … (alt text, never shown as a label)
  feelQuote: string;            // the cook's own words, English
  feelOriginal?: { text: string; lang: string };  // when said in another language (shown on top)
  estimate: string;             // "~3 cups flour" | "to taste"
  time: string;                 // "~1 hr 15 min"
  tint: Tint;
  image: string;                // dish photo path under /media
  imageAlt: string;
  cookPhoto?: { src: string; alt: string };       // a photo of the cook cooking (used where men must be visible)
  source: 'app' | 'hero' | 'example';             // app = in the real screen recordings
}
