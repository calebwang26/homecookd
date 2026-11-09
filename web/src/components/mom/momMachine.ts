// Mom's page (/a, MomApp): which screen she's on, as one explicit table. Pure: MomApp sends an event
// for each thing that happens (her taps, the server's answers, the fill poll) and shows the stage
// that comes back. The pattern: docs/agents/STATE-MACHINES.md; every stage × event is checked in
// momMachine.test.ts.
//
//   loading ──LOADED──▶ intro ──INTRO_NEXT──▶ guess ──START──▶ questions ──FINISH ok──▶ fill ──FILL_STOPPED (finished)──▶ sent ⇄ recipe
//      │                (finished ▶ fill or sent)       │ START with none ▶ nothing     │ FINISH none ▶ nothing
//      └─BAD_LINK | LOAD_FAILED──▶ error ──LOAD_START──▶ loading       questions ──SAVE_CLOSED──▶ sent, SAVE_NOT_FOUND ▶ error
//
// Guards: a screen's own buttons (INTRO_NEXT, GUESS_BACK, START, QUESTIONS_BACK, OPEN_RECIPE,
// CLOSE_RECIPE) only act on that screen. The server's answers and the page's own loads act from any
// stage, as their setStage calls did: they can land after she moved on.
//
// Invariant: she only reaches "Sent" when the server has her Send: a finished ask, a closed ask, or the
// fill screen ending on a finished ask (decision 3, Caleb's yes on Nov 8). A failed Send stays on the
// questions, where QuestionScreen says so and offers Try again; a fill that ends on an unfinished ask goes
// back there too. A page reloaded for the mic comes back to the questions (LOADED with resume).
//
// CI (scripts/check-machine-tests.mjs) fails a change to this file without one to its test:
// state-machine-test: momMachine.test.ts

export type Stage = 'loading' | 'error' | 'intro' | 'guess' | 'questions' | 'nothing' | 'fill' | 'sent' | 'recipe';
export const STAGES: readonly Stage[] = ['loading', 'error', 'intro', 'guess', 'questions', 'nothing', 'fill', 'sent', 'recipe'];

export type MomEvent =
  | { type: 'LOAD_START' } // her page is being read (first load, or Try again)
  | { type: 'BAD_LINK' } // the address has no plausible token
  | { type: 'LOADED'; finished: boolean; merging: boolean; resume: boolean } // the ask, as the server has it; resume: back from a mic reload
  | { type: 'LOAD_FAILED' } // not found, or offline
  | { type: 'INTRO_NEXT' } // past the kid's voice note
  | { type: 'GUESS_BACK' }
  | { type: 'START'; questions: number } // "Fix it with your voice" (or "Answer one" from nothing)
  | { type: 'QUESTIONS_BACK' } // Back on the first question
  | { type: 'SAVE_CLOSED' } // an answer came back 409: the ask is closed
  | { type: 'SAVE_NOT_FOUND' } // an answer came back 404
  | { type: 'FINISH'; answered: number; ok: boolean } // the last question done: her Send
  | { type: 'FILL_STOPPED'; version: boolean; finished: boolean } // the fill poll ended (her version, not merging any more, or 45 s)
  | { type: 'FILL_DONE' } // the fill screen's own "done"
  | { type: 'OPEN_RECIPE' }
  | { type: 'CLOSE_RECIPE' };

export type MomEventType = MomEvent['type'];
export const MOM_EVENTS: readonly MomEventType[] = [
  'LOAD_START', 'BAD_LINK', 'LOADED', 'LOAD_FAILED', 'INTRO_NEXT', 'GUESS_BACK', 'START', 'QUESTIONS_BACK',
  'SAVE_CLOSED', 'SAVE_NOT_FOUND', 'FINISH', 'FILL_STOPPED', 'FILL_DONE', 'OPEN_RECIPE', 'CLOSE_RECIPE',
];

/** The next stage, or null where the event is ignored. */
export function momTransition(s: Stage, e: MomEvent): Stage | null {
  switch (e.type) {
    case 'LOAD_START':
      return 'loading';
    case 'BAD_LINK':
    case 'LOAD_FAILED':
    case 'SAVE_NOT_FOUND':
      return 'error';
    case 'LOADED':
      return e.finished ? (e.merging ? 'fill' : 'sent') : e.resume ? 'questions' : 'intro';
    case 'INTRO_NEXT':
      return s === 'intro' ? 'guess' : null;
    case 'GUESS_BACK':
      return s === 'guess' ? 'intro' : null;
    case 'START':
      return s === 'guess' || s === 'nothing' ? (e.questions > 0 ? 'questions' : 'nothing') : null;
    case 'QUESTIONS_BACK':
      return s === 'questions' ? 'guess' : null;
    case 'SAVE_CLOSED':
    case 'FILL_DONE':
      return 'sent';
    case 'FINISH':
      if (e.answered === 0) return 'nothing';
      return e.ok ? 'fill' : null; // a failed Send stays on the questions (QuestionScreen: sendFailed)
    case 'FILL_STOPPED':
      if (s !== 'fill' || e.version) return null; // her version: the fill screen's own done moves on
      return e.finished ? 'sent' : 'questions';
    case 'OPEN_RECIPE':
      return s === 'sent' || s === 'recipe' ? 'recipe' : null;
    case 'CLOSE_RECIPE':
      return s === 'recipe' ? 'sent' : null;
  }
}
