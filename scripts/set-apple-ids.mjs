#!/usr/bin/env node
// Plug the Apple Team ID and the iOS bundle id into every place in the repo that needs them, so
// "links that open the app" and Apple sign-in work in TestFlight / App Store builds.
// See docs/build/LAUNCH-LINKS.md for the whole checklist.
//
//   node scripts/set-apple-ids.mjs --team ABCDE12345 --bundle app.homecookd   (edit the files)
//   node scripts/set-apple-ids.mjs --team ABCDE12345 --bundle app.homecookd --dry-run
//   node scripts/set-apple-ids.mjs --check [--team … --bundle …]               (check the live site)
//
// It edits exactly three things and nothing else:
//   app/app.config.ts                                  const IOS_BUNDLE_ID = '<bundle>';
//   web/public/.well-known/apple-app-site-association  every app id -> "<team>.<bundle>"
//   supabase/functions/api/index.ts                    const APP_BUNDLE_ID = "<bundle>";
// Running it again with the same values changes nothing; new values replace the old ones.
// No network, no secrets, no deploys: it prints what is left to do by hand.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = {
  config: join(ROOT, 'app/app.config.ts'),
  aasa: join(ROOT, 'web/public/.well-known/apple-app-site-association'),
  api: join(ROOT, 'supabase/functions/api/index.ts'),
};
const DOMAINS = ['homecookd.app', 'www.homecookd.app'];

const TEAM_RE = /^[A-Z0-9]{10}$/;
const BUNDLE_RE = /^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)+$/;

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { team: null, bundle: null, dryRun: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--team') out.team = (argv[++i] ?? '').trim().toUpperCase();
    else if (a === '--bundle') out.bundle = (argv[++i] ?? '').trim();
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--check') out.check = true;
    else if (a === '-h' || a === '--help') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 16).join('\n').replace(/^\/\/ ?/gm, ''));
      process.exit(0);
    } else fail(`Unknown argument: ${a} (try --help)`);
  }
  return out;
}

/** Replace the one line `pattern` matches; fail loudly if it isn't there exactly once. */
function replaceOnce(text, pattern, replacement, where) {
  const hits = text.match(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`)) ?? [];
  if (hits.length !== 1) fail(`Expected exactly one ${where} line, found ${hits.length}. Edit it by hand, then re-run.`);
  return text.replace(pattern, replacement);
}

function setConfig(text, bundle) {
  return replaceOnce(text, /^const IOS_BUNDLE_ID = '[^']*';$/m, `const IOS_BUNDLE_ID = '${bundle}';`, 'IOS_BUNDLE_ID in app/app.config.ts');
}

function setApi(text, bundle) {
  return replaceOnce(text, /^const APP_BUNDLE_ID = "[^"]*";$/m, `const APP_BUNDLE_ID = "${bundle}";`, 'APP_BUNDLE_ID in supabase/functions/api/index.ts');
}

/** Every app id in the AASA (applinks + webcredentials) becomes "<team>.<bundle>"; comments lose their TODO. */
function setAasa(text, appId) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    fail('web/public/.well-known/apple-app-site-association is not valid JSON.');
  }
  const details = doc?.applinks?.details;
  if (!Array.isArray(details) || details.length === 0) fail('The AASA file has no applinks.details.');
  for (const d of details) {
    d.appIDs = [appId];
    for (const c of d.components ?? []) {
      if (typeof c.comment === 'string') c.comment = c.comment.replace(/\s*TODO\(caleb\).*$/, '').trim() || undefined;
    }
  }
  doc.webcredentials = { apps: [appId] };
  // Same shape and spacing as the hand-written file: one component per line.
  return `${JSON.stringify(doc, null, 2).replace(/\{\n\s+("\/"[^}]*?)\n\s+\}/g, (m) => m.replace(/\n\s+/g, ' '))}\n`;
}

async function check(team, bundle) {
  const want = team && bundle ? `${team}.${bundle}` : null;
  let ok = true;
  for (const host of DOMAINS) {
    const url = `https://${host}/.well-known/apple-app-site-association`;
    try {
      const res = await fetch(url, { redirect: 'manual' });
      const type = res.headers.get('content-type') ?? '';
      const body = await res.text();
      let ids = [];
      try {
        ids = JSON.parse(body)?.applinks?.details?.flatMap((d) => d.appIDs ?? []) ?? [];
      } catch {
        /* not JSON */
      }
      const problems = [];
      if (res.status !== 200) problems.push(`status ${res.status} (Apple needs 200 with no redirect)`);
      if (!type.includes('application/json')) problems.push(`content-type "${type}" (needs application/json)`);
      if (ids.includes('TEAMID.BUNDLEID')) problems.push('still the TEAMID.BUNDLEID placeholder (merge the PR so Vercel redeploys)');
      if (want && !ids.includes(want)) problems.push(`app ids ${JSON.stringify(ids)} don't include ${want}`);
      if (problems.length) {
        ok = false;
        console.log(`✗ ${url}\n    ${problems.join('\n    ')}`);
      } else console.log(`✓ ${url}  ${JSON.stringify(ids)}`);
    } catch (e) {
      ok = false;
      console.log(`✗ ${url}  can't reach it (${e.message})`);
    }
  }
  console.log(ok ? '\nThe live site is ready for links that open the app.' : '\nNot ready yet (see above).');
  process.exit(ok ? 0 : 1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.team && !TEAM_RE.test(args.team)) fail(`"${args.team}" doesn't look like a Team ID (10 letters/digits, from developer.apple.com > Membership).`);
  if (args.bundle && !BUNDLE_RE.test(args.bundle)) fail(`"${args.bundle}" doesn't look like a bundle id (like app.homecookd).`);
  if (args.check) return check(args.team, args.bundle);
  if (!args.team || !args.bundle) fail('Give both --team and --bundle (or --check). Try --help.');

  const appId = `${args.team}.${args.bundle}`;
  const edits = [
    [FILES.config, (t) => setConfig(t, args.bundle)],
    [FILES.aasa, (t) => setAasa(t, appId)],
    [FILES.api, (t) => setApi(t, args.bundle)],
  ];
  let changed = 0;
  for (const [file, edit] of edits) {
    const before = readFileSync(file, 'utf8');
    const after = edit(before);
    const name = relative(ROOT, file);
    if (after === before) {
      console.log(`= ${name} (already set)`);
      continue;
    }
    changed++;
    if (args.dryRun) console.log(`~ ${name} (would change)`);
    else {
      writeFileSync(file, after);
      console.log(`✓ ${name}`);
    }
  }

  console.log(`
${args.dryRun ? 'Dry run: nothing was written.' : changed ? `Set ${appId} in ${changed} file(s).` : 'Nothing to change.'}

Still to do by hand (docs/build/LAUNCH-LINKS.md has the details):
  1. Commit these changes on a branch, open a PR and merge it. Vercel then serves the new
     apple-app-site-association; check it with:  node scripts/set-apple-ids.mjs --check --team ${args.team} --bundle ${args.bundle}
  2. Apple sign-in in store builds, right away, no redeploy: in Supabase > Edge Functions > Secrets set
       APPLE_AUDIENCES = ${args.bundle},host.exp.Exponent
     (drop host.exp.Exponent once TestFlight works; Expo Go's Apple sign-in stops then.)
     The api's APP_BUNDLE_ID default changes on its next deploy (whoever deploys the api).
  3. Build from this repo:  cd app && npx eas-cli build -p ios --profile production, then eas submit.`);
}

main();
