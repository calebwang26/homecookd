// A local fake of the Convex /dish/* routes (docs/build/DISH-ASK-SPEC.md §4), for the v2 web pages
// before the real routes are deployed. Canned "tomato egg" guess and merge, a Hindi translation for
// `lang: 'hi'`, files kept in memory. No models, no keys.
//
//   node web/scripts/qa/dish-fake-server.mjs                      # http://localhost:8791
//   cd web && NEXT_PUBLIC_DISH_URL=http://localhost:8791 npx next dev --port 3105
//
// Test hooks (not in the spec): POST /__fake/budget {spent: true|false} makes /dish/cards answer 429
// `budget` as the spent daily budget does, POST /__fake/rate {on: true|false} answers 429 `rate` (a per-IP limit); GET /__fake/state returns every card; GET /files/<id> serves an upload.
// Import it to run it in-process: `const fake = await startFake({ port, site })`.
import { createServer } from 'node:http';
import { createHash, randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const token = () => Array.from({ length: 22 }, () => B62[randomInt(62)]).join('');
const askTokenOf = (kid) => {
  const bytes = createHash('sha256').update(`ask:${kid}`).digest();
  let out = '';
  for (const b of bytes) if (out.length < 22) out += B62[b % 62];
  return out;
};

const RELATION_LABEL = { mom: 'Mom', dad: 'Dad', grandma: 'Grandma', grandpa: 'Grandpa', auntie: 'Auntie', uncle: 'Uncle' };
const isRelation = (r) => r === 'none' || !!RELATION_LABEL[r];
const defaultMessage = (relation, dish) => (relation === 'none' ? '' : `${RELATION_LABEL[relation]}, how do you make your ${dish}? I'm trying to make it here.`);
const plain = (t) => String(t).replaceAll('**', '');

/** DISH-ASK-SPEC §10: a part of the guess named by the kid, as the real server resolves `about`. */
function partOf(guess, about) {
  if (about?.kind === 'ingredient') return guess.ingredients[about.index] ?? null;
  if (about?.kind === 'line') return guess.steps[about.step]?.lines[about.line] ?? null;
  return null;
}
/** §10 template: no model is called. */
const templateFor = (about, part) =>
  about.kind === 'ingredient' ? `How much ${part.name.split(',')[0].trim()} do you use?` : `How do you do this part: ${plain(part.text).slice(0, 60)}?`;
const FILTERED = /\b(fuck|shit)\b/i;

const ing = (name, amount, status, ask = null) => ({ name, amount, status, isGuess: status === 'guessed' || status === 'unknown', ask, clip: null, was: null, quote: null });
const line = (text, short, ask = null) => ({ text, short, detail: null, status: 'guessed', isGuess: true, ask, clip: null, was: null, quote: null });

function guessFor(dish) {
  return {
    dish: dish.replace(/^\s*(my\s+)?(mom|dad|grandma|grandpa|auntie|uncle)['’]?s\s+/i, '').trim() || 'tomato egg',
    servings: '1',
    time: '~20 min',
    cost: '~$3',
    ingredients: [
      ing('eggs, beaten', '~2', 'guessed'),
      ing('tomatoes, in wedges', '~2', 'guessed'),
      ing('ketchup', '~1 tbsp', 'guessed', 'q1'),
      ing('sugar', '', 'unknown', 'q2'),
      ing('salt', '~1/2 tsp', 'guessed'),
      ing('scallion, sliced', '~1', 'guessed'),
    ],
    steps: [
      { title: 'Scramble the eggs', lines: [line('Scramble the eggs **soft**.', 'Scramble eggs **soft**.'), line('Take them out.', 'Set aside.')], uses: [0], tip: null },
      { title: 'Cook the tomatoes', lines: [line('Cook the tomatoes until they go **soft and saucy**.', 'Tomatoes, **soft and saucy**.')], uses: [1], tip: null },
      { title: 'Season', lines: [line('Stir in the ketchup and salt.', 'Add ketchup, salt.')], uses: [2, 3, 4], tip: null },
      { title: 'Finish', lines: [line('Eggs back in. Fold **twice**, top with scallion, eat with rice.', 'Eggs back. Fold **twice**.', 'q3')], uses: [0, 5], tip: null },
    ],
    questions: [
      { id: 'q1', text: 'How much ketchup do you put in?' },
      { id: 'q2', text: 'Do you add sugar?' },
      { id: 'q3', text: 'When do the eggs go back in?' },
    ],
  };
}

/** The guess in Hindi, as the server's translation would give it: ids, statuses and ** kept. */
function hindi(guess, card) {
  const names = ['अंडे, फेंटे हुए', 'टमाटर, टुकड़ों में', 'केचप', 'चीनी', 'नमक', 'हरा प्याज़, कटा हुआ'];
  const lines = [['अंडों को **नरम** फेंट कर पकाएँ।', 'उन्हें निकाल लें।'], ['टमाटर **नरम और रसीले** होने तक पकाएँ।'], ['केचप और नमक मिलाएँ।'], ['अंडे वापस डालें। **दो बार** मिलाएँ, हरा प्याज़ डालें, चावल के साथ खाएँ।']];
  const qs = { q1: 'आप कितना केचप डालती हैं?', q2: 'क्या आप चीनी डालती हैं?', q3: 'अंडे वापस कब डालती हैं?' };
  return {
    lang: 'hi',
    guess: {
      ...guess,
      ingredients: guess.ingredients.map((x, i) => ({ ...x, name: x.status === 'stated' ? x.name : (names[i] ?? x.name) })),
      steps: guess.steps.map((st, i) => ({ ...st, lines: st.lines.map((l, j) => ({ ...l, text: l.status === 'stated' ? l.text : (lines[i]?.[j] ?? l.text), short: null })) })),
      questions: guess.questions.map((q) => ({ ...q, text: qs[q.id] ?? q.text })),
    },
    questions: card.asked.map((q) => ({ ...q, text: qs[q.id] ?? q.text })),
    message: 'माँ, आप अपना टमाटर अंडा कैसे बनाती हैं? मैं यहाँ बनाने की कोशिश कर रहा हूँ।',
    // Her version in Hindi too: names, amounts and lines; her quotes and tips stay as she said them.
    version: card.version
      ? {
          ...card.version,
          ingredients: card.version.ingredients.map((x, i) => ({ ...x, name: names[i] ?? x.name, amount: { '2 big spoons': '2 बड़े चम्मच', '1 tsp': '1 छोटा चम्मच' }[x.amount] ?? x.amount })),
          steps: card.version.steps.map((st, i) => ({
            ...st,
            lines: st.lines.map((l, j) => ({ ...l, text: l.status === 'mom' ? 'अंडे **बिल्कुल आख़िर में** डालें। मिलाएँ, हरा प्याज़ डालें, चावल के साथ खाएँ।' : (lines[i]?.[j] ?? l.text) })),
          })),
        }
      : null,
  };
}

const SAID = {
  en: {
    q1: { words: 'Two big spoons. Don’t be shy.', english: null },
    q2: { words: 'A little sugar takes the sour out.', english: null },
    q3: { words: 'At the very end, just fold it.', english: null },
  },
  hi: {
    q1: { words: 'दो बड़े चम्मच। कंजूसी मत करना।', english: 'Two big spoons. Don’t skimp.' },
    q2: { words: 'थोड़ी सी चीनी, खट्टापन चला जाता है।', english: 'A little sugar, it takes the sour out.' },
    q3: { words: 'बिल्कुल आख़िर में, बस मिला दो।', english: 'At the very end, just fold it in.' },
  },
};

/** Her version: what she answered replaces the guess, with `was` and her quote (spec §4 /dish/ask/finish). */
function merge(card) {
  const v = structuredClone(card.guess);
  const said = (q) => {
    const a = card.answers.get(q);
    return a ? (SAID[a.lang] ?? SAID.en)[q] : null;
  };
  const fix = (x, q, amount) => {
    const quote = said(q);
    if (!quote) return;
    Object.assign(x, { was: x.amount || null, amount, status: 'mom', isGuess: false, clip: q, quote, ask: null });
  };
  fix(v.ingredients[2], 'q1', '2 big spoons');
  fix(v.ingredients[3], 'q2', '1 tsp');
  const l = v.steps[3].lines[0];
  const q3 = said('q3');
  if (q3) Object.assign(l, { was: l.text, text: 'Eggs back in **at the very end**. Fold, top with scallion, eat with rice.', status: 'mom', isGuess: false, clip: 'q3', quote: q3, ask: null });
  return v;
}

export async function startFake({ port = 8791, site = 'http://localhost:3105', mergeMs = 3000, translateMs = 1500 } = {}) {
  const cards = new Map(); // kidToken -> card
  const files = new Map(); // fileId -> {kind, type, bytes}
  const log = [];
  let budgetSpent = false;
  let rateLimited = false;
  let base = `http://localhost:${port}`;
  const byAsk = (t) => [...cards.values()].find((c) => c.askToken === t);
  const fileUrl = (id) => (id ? `${base}/files/${id}` : null);

  const cardOut = (c) => ({
    dish: c.dish,
    relation: c.relation,
    kidName: c.kidName,
    status: c.version ? 'answered' : c.askedAt ? 'asked' : 'draft',
    guess: c.guess,
    version: c.version,
    answers: [...c.answers.entries()].map(([id, a]) => ({ id, words: c.version ? (SAID[a.lang] ?? SAID.en)[id].words : '', english: c.version ? (SAID[a.lang] ?? SAID.en)[id].english : null, audioUrl: fileUrl(a.file), durationS: a.durationS })),
    merging: c.merging,
    asked: c.asked,
    message: c.message,
    kidVoiceUrl: fileUrl(c.voice),
    kidVoiceS: c.voice ? c.voiceS : null,
    photoUrls: c.photos.map(fileUrl),
    askUrl: c.relation === 'none' ? null : `${site}/a?t=${c.askToken}`,
    askedAt: c.askedAt,
    openedAt: c.openedAt,
    finishedAt: c.finishedAt,
    createdAt: c.createdAt,
  });
  const askOut = (c, inLang = null) => ({
    dish: c.dish,
    relation: c.relation,
    kidName: c.kidName,
    message: c.message,
    kidVoiceUrl: fileUrl(c.voice),
    kidVoiceS: c.voice ? c.voiceS : null,
    guess: c.guess,
    inLang,
    photoUrls: c.photos.map(fileUrl),
    questions: c.asked.filter((q) => !c.answers.has(q.id)),
    answered: c.asked.filter((q) => c.answers.has(q.id)).map((q) => q.id),
    clips: [...c.answers.entries()].map(([id, a]) => ({ id, audioUrl: fileUrl(a.file), durationS: a.durationS })),
    finished: !!c.finishedAt,
    version: c.version,
    merging: c.merging,
  });

  const read = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      req.on('data', (d) => chunks.push(d));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const cors = origin && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { ...cors, 'Content-Type': type });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    const fail = (status, code, error) => send(status, { error, code });
    const url = new URL(req.url, base);
    if (origin && !cors['Access-Control-Allow-Origin']) return fail(403, 'origin', 'This request came from another site.');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Dish-Token', 'Access-Control-Max-Age': '600' });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
      const f = files.get(url.pathname.slice(7));
      return f ? send(200, f.bytes, f.type) : fail(404, 'not_found', 'No such file.');
    }
    if (req.method === 'GET' && url.pathname === '/__fake/state') return send(200, [...cards.values()].map((c) => ({ kidToken: c.kidToken, askToken: c.askToken, ...cardOut(c) })));
    if (req.method !== 'POST') return fail(405, 'bad_request', 'POST only.');
    const raw = await read(req);
    log.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), type: req.headers['content-type'] ?? '', token: req.headers['x-dish-token'] ?? null });
    const body = () => {
      try {
        return JSON.parse(raw.toString('utf8') || '{}');
      } catch {
        return null;
      }
    };
    const b = url.pathname === '/dish/files' || url.pathname === '/dish/ask/answer' ? null : body();
    if (b === null && url.pathname !== '/dish/files' && url.pathname !== '/dish/ask/answer') return fail(400, 'bad_request', 'That isn’t JSON.');

    switch (url.pathname) {
      case '/__fake/budget':
        budgetSpent = !!b.spent;
        return send(200, { budgetSpent });
      case '/__fake/rate':
        rateLimited = !!b.on;
        return send(200, { rateLimited });
      case '/dish/files': {
        const kind = url.searchParams.get('kind');
        const type = (req.headers['content-type'] ?? '').split(';')[0].trim();
        if (kind !== 'photo' && kind !== 'voice') return fail(400, 'bad_request', 'kind is photo or voice.');
        if (kind === 'photo' ? !/^image\/(jpeg|png|webp)$/.test(type) : !/^audio\//.test(type)) return fail(415, 'bad_type', 'We don’t take that type.');
        if (raw.length > (kind === 'photo' ? 5 : 3) * 1024 * 1024) return fail(413, 'too_large', 'That file is too big.');
        const fileId = token();
        files.set(fileId, { kind, type, bytes: raw });
        return send(201, { fileId, kind, contentType: type, size: raw.length });
      }
      case '/dish/cards': {
        if (budgetSpent) return fail(429, 'budget', 'homecookd has made all the recipes it can today. Try again tomorrow.');
        if (rateLimited) return fail(429, 'rate', 'Too many tries. Please wait a few minutes.');
        const dish = String(b.dish ?? '').trim();
        if (dish.length < 2 && !b.photos?.length && !b.voiceNote) return fail(400, 'bad_request', 'Tell us the dish.');
        if (/^(asdf|hello)$/i.test(dish)) return fail(422, 'not_a_dish', 'That doesn’t sound like a dish.');
        const relation = isRelation(b.relation) ? b.relation : 'mom';
        const kidToken = token();
        const guess = guessFor(dish);
        const card = {
          kidToken,
          askToken: askTokenOf(kidToken),
          dish: dish || guess.dish,
          relation,
          kidName: b.kidName ? String(b.kidName).slice(0, 40) : null,
          guess,
          version: null,
          answers: new Map(),
          merging: false,
          asked: [],
          message: defaultMessage(relation, guess.dish),
          voice: null,
          voiceS: null,
          photos: (b.photos ?? []).filter((id) => files.has(id)),
          askedAt: null,
          openedAt: null,
          finishedAt: null,
          createdAt: Date.now(),
        };
        cards.set(kidToken, card);
        await new Promise((r) => setTimeout(r, 600));
        return send(201, { kidToken, card: cardOut(card) });
      }
    }

    if (url.pathname.startsWith('/dish/cards/')) {
      const c = cards.get(b.kidToken);
      if (!c) return fail(404, 'not_found', 'This link doesn’t work anymore.');
      switch (url.pathname) {
        case '/dish/cards/get':
          return send(200, { card: cardOut(c) });
        case '/dish/cards/update': {
          if (c.finishedAt && (b.message !== undefined || b.voiceNote !== undefined || b.edits !== undefined)) return fail(409, 'closed', 'Mom already sent her answers.');
          if (b.relation !== undefined && !isRelation(b.relation)) return fail(400, 'bad_request', 'That isn’t a relation.');
          if (b.relation === 'none' && c.relation !== 'none' && c.askedAt) return fail(409, 'closed', 'This card was already sent.');
          if (b.voiceNoteS !== undefined && !(b.voiceNoteS > 0 && b.voiceNoteS <= 60)) return fail(400, 'bad_request', 'voiceNoteS is over 0 and at most 60.');
          if (b.edits !== undefined) {
            if (!Array.isArray(b.edits) || b.edits.length > 20) return fail(400, 'bad_request', 'At most 20 edits.');
            const next = structuredClone(c.guess);
            for (const e of b.edits) {
              const part = partOf(next, e);
              const values = e.kind === 'ingredient' ? [e.name, e.amount] : [e.text];
              if (!part || !values.some((v) => v !== undefined)) return fail(400, 'bad_request', 'That edit doesn’t point at a part of the guess.');
              const limits = e.kind === 'ingredient' ? [80, 40] : [80];
              for (const [i, v] of values.entries()) {
                if (v === undefined) continue;
                const plainV = e.kind === 'ingredient' ? String(v) : plain(v);
                if (typeof v !== 'string' || plainV.trim().length < 1 || plainV.length > limits[i] || (e.kind === 'ingredient' && String(v).includes('**'))) return fail(400, 'bad_request', 'That edit is the wrong length.');
                if (FILTERED.test(v)) return fail(422, 'words', 'Let’s keep it to the food.');
              }
              if (e.kind === 'ingredient') {
                if (e.name !== undefined) part.name = e.name.trim();
                if (e.amount !== undefined) part.amount = e.amount.trim();
              } else {
                part.text = e.text.trim();
                part.detail = null;
                part.short = null;
              }
              Object.assign(part, { status: 'stated', isGuess: false });
            }
            c.guess = next;
          }
          if (b.kidName !== undefined) c.kidName = b.kidName ? String(b.kidName).slice(0, 40) : null;
          if (b.relation) {
            // Picking someone turns asking on and writes the default message (or re-writes the default one).
            const wasDefault = c.message === defaultMessage(c.relation, c.guess.dish);
            c.relation = b.relation;
            if (wasDefault) c.message = defaultMessage(c.relation, c.guess.dish);
          }
          if (typeof b.message === 'string') c.message = b.message.trim().slice(0, 500);
          if (b.voiceNote !== undefined) {
            c.voice = b.voiceNote && files.has(b.voiceNote) ? b.voiceNote : null;
            c.voiceS = c.voice ? (b.voiceNoteS ?? null) : null;
          }
          return send(200, { card: cardOut(c) });
        }
        case '/dish/cards/ask': {
          if (c.relation === 'none') return fail(400, 'bad_request', 'Pick who you’re asking first.');
          const kept = c.asked.filter((q) => c.answers.has(q.id));
          const used = new Set(c.asked.map((q) => q.id));
          const out = [];
          for (const q of b.questions ?? []) {
            if (q.id && q.about) return fail(400, 'bad_request', 'Send an id or about, not both.');
            if (q.about) {
              const part = partOf(c.guess, q.about);
              if (!part) return fail(400, 'bad_request', 'That doesn’t point at a part of the guess.');
              const id = ['q4', 'q5', 'q6'].find((x) => !used.has(x) && !out.some((o) => o.id === x));
              if (!id) continue;
              part.ask = id;
              out.push({ id, text: String(q.text ?? templateFor(q.about, part)) });
            } else {
              out.push({ id: q.id ?? ['q4', 'q5', 'q6'].find((x) => !used.has(x) && !out.some((o) => o.id === x)) ?? 'q6', text: String(q.text) });
            }
          }
          const open = out.filter((q) => !c.answers.has(q.id)).slice(0, Math.min(3, 6 - kept.length));
          c.asked = [...kept, ...open];
          if (c.finishedAt && c.asked.some((q) => !c.answers.has(q.id))) c.finishedAt = null;
          return send(200, { card: cardOut(c) });
        }
        case '/dish/cards/sent':
          if (c.relation === 'none') return fail(400, 'bad_request', 'Pick who you’re asking first.');
          c.askedAt ??= Date.now();
          return send(200, { card: cardOut(c) });
      }
      return fail(404, 'not_found', 'No such route.');
    }

    if (url.pathname === '/dish/ask/answer') {
      const c = byAsk(req.headers['x-dish-token']);
      if (!c) return fail(404, 'not_found', 'This link doesn’t work anymore.');
      if (c.finishedAt) return fail(409, 'closed', 'You already sent your answers.');
      const q = url.searchParams.get('q');
      if (!c.asked.some((x) => x.id === q)) return fail(400, 'bad_request', 'That question wasn’t asked.');
      const fileId = token();
      files.set(fileId, { kind: 'answer', type: (req.headers['content-type'] ?? 'audio/webm').split(';')[0], bytes: raw });
      c.answers.set(q, { file: fileId, durationS: Math.min(120, Number(url.searchParams.get('durationS')) || 0), lang: url.searchParams.get('lang') || 'en' });
      return send(200, { ask: askOut(c) });
    }

    if (url.pathname.startsWith('/dish/ask/')) {
      const c = byAsk(b.askToken);
      if (!c) return fail(404, 'not_found', 'This link doesn’t work anymore.');
      switch (url.pathname) {
        case '/dish/ask/peek': {
          c.openedAt ??= Date.now();
          let inLang = null;
          if (b.lang === 'hi') {
            await new Promise((r) => setTimeout(r, translateMs));
            inLang = hindi(c.guess, c);
          }
          return send(200, { ask: askOut(c, inLang) });
        }
        case '/dish/ask/finish':
          if (!c.answers.size) return send(200, { ask: askOut(c) });
          if (!c.finishedAt) {
            c.finishedAt = Date.now();
            c.merging = true;
            setTimeout(() => {
              c.version = merge(c);
              c.merging = false;
            }, mergeMs);
          }
          return send(200, { ask: askOut(c) });
      }
    }
    return fail(404, 'not_found', 'No such route.');
  });

  await new Promise((resolve) => server.listen(port, resolve));
  base = `http://localhost:${server.address().port}`;
  return {
    base,
    cards,
    log,
    setBudget: (spent) => (budgetSpent = spent),
    setRate: (on) => (rateLimited = on),
    close: () => new Promise((r) => server.close(r)),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8791);
  const fake = await startFake({ port, site: process.env.SITE ?? 'http://localhost:3105' });
  console.log(`dish fake on ${fake.base}`);
}
