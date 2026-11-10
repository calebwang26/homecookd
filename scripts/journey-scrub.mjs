#!/usr/bin/env node
// Masks what a kept simulator log must never show, in place, for ios-journeys' "Drop what echoes a key or a link" step
// (the repo and its artifacts are public):
//   JOURNEY_SCRUB_VALUES="<one value a line>" node scripts/journey-scrub.mjs <log>...
// - every exact value in JOURNEY_SCRUB_VALUES (the device keys, the family link's token, the test ids) becomes ***;
// - an S3 address's query string (everything after "?" on any amazonaws.com URL) becomes ***: a presigned upload URL
//   carries a temporary key id and session token (run 42852281034's failed PUT was logged with them, cut short by iOS;
//   this must not depend on that);
// - any X-Amz-* value left elsewhere becomes ***: X-Amz-Credential=…, x-amz-security-token: …, and the same percent-encoded
//   (X-Amz-Credential%3D…, up to the next %26), as a URL logged inside another URL would be.
// It fails closed: a log it can't read or write, or that still holds a value or an X-Amz value afterwards, is deleted,
// and a line naming it is printed for a warning. If even that fails it exits non-zero, and the step removes every log.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const S3_QUERY = /(https?:\/\/[^\s"'<>?]*amazonaws\.com[^\s"'<>?]*)\?[^\s"'<>,;)}\]]*/gi;
// An X-Amz name starts a word, or follows a percent-escape (%3F, %26: "%26X-Amz-…" has no word boundary); its value
// follows "=", ": " or an encoded "=" or ":" (%3D, %3A), and ends at "&", an encoded "&" (%26) or a delimiter.
const NAME = String.raw`(?:(?<=%[0-9a-f]{2})|\b)(x-amz-[a-z0-9-]+)(=|:\s*|%3[da])`;
const VALUE_CHAR = String.raw`(?!%26)[^&\s"'<>,;)}\]]`;
const AMZ = new RegExp(`${NAME}(?!\\*\\*\\*)(?:${VALUE_CHAR})+`, 'gi');
const LEFT_AMZ = new RegExp(`${NAME}(?!\\*\\*\\*)${VALUE_CHAR}`, 'i');

/** The text with every value, S3 query string and X-Amz value masked. */
export function scrub(text, values = []) {
  let out = text;
  for (const v of values) if (v) out = out.split(v).join('***');
  return out.replace(S3_QUERY, '$1?***').replace(AMZ, '$1$2***');
}

/** Why a scrubbed text still can't be kept, or null. */
export function leftover(text, values = []) {
  if (values.some((v) => v && text.includes(v))) return 'it still held a key or a link';
  if (LEFT_AMZ.test(text)) return 'it still held an X-Amz value';
  return null;
}

/** Scrubs one log in place; returns a line for a warning when it had to be deleted instead. */
export function scrubFile(file, values) {
  let why;
  try {
    const text = scrub(readFileSync(file, 'utf8'), values);
    why = leftover(text, values);
    if (!why) {
      writeFileSync(file, text);
      return null;
    }
  } catch {
    why = 'it couldn’t be read and rewritten';
  }
  rmSync(file, { force: true });
  return `dropped ${path.basename(path.dirname(path.dirname(file)))}/${path.basename(file)}: ${why}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const values = (process.env.JOURNEY_SCRUB_VALUES ?? '').split('\n').filter((v) => v.length > 0);
  for (const file of process.argv.slice(2)) {
    const line = scrubFile(file, values);
    if (line) console.log(line);
  }
}
