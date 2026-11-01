'use client';
// /a?t=<ask token>, Mom's side of v2 (docs/PRD-V2.md §4 Phase 3): the kid's voice note (M1), the kid's
// guess (M2), her answers by voice (M3), her version filling in (M4), Sent (M5) and the film ask (M6).
// The page is in her phone's language: English shows at once, then the guess, the questions and the
// message swap to her language when the server's translation lands (peek with `lang`, DISH-ASK-SPEC §4).
// The kid has no pronouns in the data, so every line uses the kid's name.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DishLangProvider, useLang } from '@/components/dish/lang';
import { TopBar } from '@/components/dish/parts';
import { canRecord as browserCanRecord } from '@/components/dish/useRecorder';
import { EggMascot } from '@/components/primitives/EggMascot';
import { DishError, finishAsk, isPlausibleToken, peekAsk, sendAnswer } from '@/lib/dish/api';
import { askedItems, guessOf } from '@/lib/dish/text';
import type { Ask, InLang } from '@/lib/dish/types';
import { spokenLang } from '@/lib/dish/words';
import { MomRecipe } from './MomRecipe';
import { FillScreen, GuessScreen, IntroScreen, SentScreen } from './MomScreens';
import { QuestionScreen, type Pending, type SaveOutcome, type ShownQuestion } from './QuestionScreen';
import ui from '@/components/dish/ui.module.css';
import s from './mom.module.css';

type Stage = 'loading' | 'error' | 'intro' | 'guess' | 'questions' | 'nothing' | 'fill' | 'sent' | 'recipe';
type Failure = 'not-found' | 'offline';

const POLL_MS = 2000;
const FILL_WAIT_MS = 45_000;

export function MomApp() {
  return (
    <DishLangProvider>
      <div className={s.page}>
        <div className={s.column}>
          <Mom />
        </div>
      </div>
    </DishLangProvider>
  );
}

function Mom() {
  const { t, lang, tags } = useLang();
  const [token, setToken] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [stage, setStage] = useState<Stage>('loading');
  const [failure, setFailure] = useState<Failure>('not-found');
  const [inLangs, setInLangs] = useState<Record<string, InLang | null>>({});
  const [english, setEnglish] = useState(false);
  const [list, setList] = useState<string[]>([]); // the question ids she's answering, fixed when she starts
  const [recordable, setRecordable] = useState(true);
  const askRef = useRef<Ask | null>(null);
  const toSent = useCallback(() => setStage('sent'), []);
  const [filmShown, setFilmShown] = useState(false); // the film ask rises once by itself; back from her recipe it stays down
  const onFilmShown = useCallback(() => setFilmShown(true), []);
  const keep = (a: Ask) => {
    askRef.current = a;
    setAsk(a);
  };

  const load = useCallback(() => {
    const k = new URLSearchParams(window.location.search).get('t');
    if (!isPlausibleToken(k)) {
      setFailure('not-found');
      return setStage('error');
    }
    setToken(k);
    setStage('loading');
    peekAsk(k).then(
      (a) => {
        keep(a);
        setStage(a.finished ? (a.merging ? 'fill' : 'sent') : 'intro');
      },
      (e: unknown) => {
        setFailure(e instanceof DishError && e.kind === 'not-found' ? 'not-found' : 'offline');
        setStage('error');
      },
    );
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address is only readable on the client (static export)
    load();
    setRecordable(browserCanRecord());
  }, [load]);

  // Her language: ask once per language (the first translation takes 10–15 s); null means English.
  useEffect(() => {
    if (!token || !ask || lang === 'en' || lang in inLangs) return;
    let live = true;
    peekAsk(token, lang).then(
      (a) => live && setInLangs((m) => ({ ...m, [lang]: a.inLang?.lang === lang ? a.inLang : null })),
      () => live && setInLangs((m) => ({ ...m, [lang]: null })),
    );
    return () => {
      live = false;
    };
  }, [token, ask, lang, inLangs]);

  // After Send: her version is written in 10–20 s.
  useEffect(() => {
    if (stage !== 'fill' || !token) return;
    const t0 = Date.now();
    const timer = window.setInterval(() => {
      const a = askRef.current;
      if (a?.version || (a && !a.merging) || Date.now() - t0 > FILL_WAIT_MS) {
        window.clearInterval(timer);
        if (!a?.version) setStage('sent');
        return;
      }
      // With her language, so her version comes back translated in the same answer (no English flash).
      peekAsk(token, lang).then((a) => {
        keep(a);
        if (lang !== 'en') setInLangs((m) => ({ ...m, [lang]: a.inLang?.lang === lang ? a.inLang : (m[lang] ?? null) }));
      }, () => {});
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [stage, token, lang]);

  // A read link on the page has expired: her page again, for fresh ones.
  const refresh = useCallback(() => {
    if (token) void peekAsk(token, lang).then(keep, () => {});
  }, [token, lang]);

  const inLang = lang !== 'en' && !english ? (inLangs[lang] ?? null) : null;
  const kid = ask?.kidName?.trim() || t('m.family');
  const guess = inLang?.guess ?? ask?.guess ?? null;

  const shown: ShownQuestion[] = useMemo(() => {
    if (!ask || !guess) return [];
    const all = [...ask.questions];
    return list
      .map((id) => all.find((q) => q.id === id) ?? ask.guess.questions.find((q) => q.id === id) ?? null)
      .filter((q): q is NonNullable<typeof q> => !!q)
      .map((q) => ({
        id: q.id,
        text: inLang?.questions.find((x) => x.id === q.id)?.text ?? q.text,
        guess: guessOf(askedItems(guess, [q.id])[0]),
      }));
  }, [ask, guess, inLang, list]);

  const startQuestions = () => {
    const a = askRef.current;
    if (!a) return;
    setList(a.questions.map((q) => q.id));
    setStage(a.questions.length ? 'questions' : 'nothing');
  };

  const onSave = async ({ qid, clip }: Pending): Promise<SaveOutcome> => {
    if (!token) return 'gone';
    try {
      keep(await sendAnswer(token, qid, spokenLang(lang, tags), clip.durationS, clip.blob, clip.contentType));
      return 'saved';
    } catch (e) {
      const kind = e instanceof DishError ? e.kind : 'network';
      if (kind === 'closed') {
        setStage('sent');
        return 'gone';
      }
      if (kind === 'not-found') {
        setFailure('not-found');
        setStage('error');
        return 'gone';
      }
      return kind === 'bad' ? 'redo' : 'retry';
    }
  };

  const onFinish = async () => {
    const a = askRef.current;
    if (!token || !a) return;
    if (!a.answered.length) return setStage('nothing');
    try {
      keep(await finishAsk(token));
    } catch {
      /* her answers are saved; the fill screen polls and Send is retried by the kid's page (spec §4) */
    }
    setStage('fill');
  };

  if (stage === 'loading') {
    return (
      <>
        <TopBar />
        <div className={s.notice} aria-busy="true">
          <EggMascot size={96} mood="hello" />
        </div>
      </>
    );
  }
  if (stage === 'error' || !ask || !guess) {
    return (
      <>
        <TopBar />
        <div className={`${s.body} ${s.notice}`}>
          <EggMascot size={88} mood="oops" />
          <h1 className={s.h1}>{failure === 'not-found' ? t('m.notFound') : t('common.offline')}</h1>
          {failure === 'offline' && (
            <button type="button" className={`${ui.press} ${ui.primary}`} onClick={load}>
              {t('common.tryAgain')}
            </button>
          )}
        </div>
      </>
    );
  }

  const toggle = lang !== 'en' && inLangs[lang] ? { on: english, flip: () => setEnglish((v) => !v) } : null;

  switch (stage) {
    case 'intro':
      return <IntroScreen ask={ask} kid={kid} message={inLang?.message ?? ask.message} toggle={toggle} onNext={() => setStage('guess')} onStale={refresh} />;
    case 'guess':
      return <GuessScreen ask={ask} kid={kid} guess={guess} toggle={toggle} onBack={() => setStage('intro')} onNext={startQuestions} />;
    case 'questions':
      return (
        <>
          <TopBar />
          <QuestionScreen kid={kid} questions={shown} answered={ask.answered} canRecord={recordable} onSave={onSave} onFinish={onFinish} onBack={() => setStage('guess')} />
        </>
      );
    case 'nothing':
      return (
        <>
          <TopBar />
          <div className={`${s.body} ${s.notice}`}>
            <EggMascot size={88} mood="sleepy" />
            <h1 className={s.h1}>{t('m.nothing')}</h1>
            <p className={s.sentLine}>{t('m.nothingLine', { kid })}</p>
            <button type="button" className={`${ui.press} ${ui.primary}`} onClick={startQuestions}>
              {t('m.answerOne')}
            </button>
          </div>
        </>
      );
    case 'fill':
      return <FillScreen ask={ask} guess={guess} version={inLang?.version ?? ask.version} onDone={toSent} onStale={refresh} />;
    case 'sent':
    case 'recipe': {
      // Her version, in her language once it is translated (the same pick as the fill screen).
      const version = inLang?.version ?? ask.version;
      if (stage === 'recipe' && version) {
        return <MomRecipe ask={ask} kid={kid} token={token!} version={version} onClose={() => setStage('sent')} />;
      }
      return (
        <SentScreen
          ask={ask}
          kid={kid}
          token={token!}
          canOpen={!!version}
          filmFirst={!filmShown}
          onFilmShown={onFilmShown}
          onOpenRecipe={() => setStage('recipe')}
        />
      );
    }
  }
}
