// Claude as the cooking agent: each time the kid finishes talking, it picks one tool (STACK.md,
// "Claude's tools"). find_moment is the only tool that hands control back for a second pick, so a
// question becomes find_moment → play_clip, or find_moment → ask_cook.
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.js";
import type { CookSession } from "./convex.js";
import type { Hit } from "./moss.js";

import type * as Beta from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

/** What the agent can make happen. The cooking session implements these. */
export type Actions = {
  currentStep: () => number;
  goToStep: (order: number) => Promise<void>;
  /** Moss search. `waitMs` caps how long to wait for the family's index to load. */
  findMoment: (query: string, waitMs: number) => Promise<Hit[]>;
  /** Plays a moment of the cook's video. `question` is set when it answers something the kid asked. */
  playClip: (startS: number, endS: number, question?: { text: string; quote: string }) => Promise<void>;
  askCook: (question: string) => Promise<void>;
  say: (text: string) => Promise<void>;
};

const MAX_CALLS_PER_TURN = 3;

const obj = (properties: Record<string, object>, required: string[] = []) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});

const TOOLS: Beta.BetaTool[] = [
  { name: "next_step", description: "Move to the next step and read it aloud.", input_schema: obj({}) },
  { name: "previous_step", description: "Go back one step and read it aloud.", input_schema: obj({}) },
  { name: "repeat_step", description: "Read the current step aloud again.", input_schema: obj({}) },
  {
    name: "go_to_step",
    description: "Jump to step n (1-based) and read it aloud.",
    input_schema: obj({ n: { type: "integer", description: "Step number, from 1." } }, ["n"]),
  },
  {
    name: "find_moment",
    description:
      "Search again what the cook said and did in their video, with different words than the kid used. Returns the best moments with their times.",
    input_schema: obj({ query: { type: "string", description: "The question, as a short search phrase." } }, ["query"]),
  },
  {
    name: "play_clip",
    description:
      "Play a moment of the cook's video. Use only start_s/end_s from a find_moment result, or a step's own moment from the recipe.",
    input_schema: obj({ start_s: { type: "number" }, end_s: { type: "number" } }, ["start_s", "end_s"]),
  },
  {
    name: "ask_cook",
    description:
      "Send the kid's question to the cook, when no moment answers it. The cook answers later on their phone. The kid hears that you asked.",
    input_schema: obj({ question: { type: "string", description: "The kid's question in their own words, e.g. \"Can I use maple syrup instead of rock sugar?\"" } }, ["question"]),
  },
  {
    name: "say",
    description: "Speak a very short line to the kid (under 15 words). Never a cooking fact, amount, time or tip.",
    input_schema: obj({ text: { type: "string" } }, ["text"]),
  },
].map((t) => ({ ...t, strict: true }));

const momentsJson = (hits: Hit[]) =>
  JSON.stringify(hits.map((h) => ({ cook_said: h.text, start_s: h.startS, end_s: h.endS, step: h.stepOrder, score: h.score })));

function systemPrompt(s: CookSession): string {
  const cook = s.cook?.name ?? "the cook";
  const steps = s.recipe.steps
    .map((st) => `${st.order}. ${st.title}: ${st.text} [video ${st.moment.startS}-${st.moment.endS}s]`)
    .join("\n");
  return `You are the hands-free helper in homecookd. ${s.kid.name} is cooking ${cook}'s "${s.recipe.title}" from ${cook}'s own video, with messy hands, talking to you out loud. Their speech reaches you as a transcript, so expect small transcription errors.

Each turn, call exactly one tool:
- "next", "done", "what's next", "ok go on" → next_step. "back", "last step" → previous_step. "again", "what?", "say that again" → repeat_step. "step 4", "go to the sauce part" → go_to_step.
- A question about the dish (how much, how long, what should it look like, why, can I swap something): the message lists moments from ${cook}'s video that may match. If one clearly answers it, play_clip with its start_s and end_s. If none does, ask_cook. Use find_moment when no moments are listed, or when the kid's words were vague and other words would clearly find it.
- "show me how you did this step" → play_clip with the step's own video times.
- Small talk or thanks → say, briefly and warmly.
- Unclear speech → say, asking them to repeat.
- Speech not meant for you (talking to someone else, background noise, half a word) → call no tool and reply with an empty message. Silence is better than interrupting.

The one rule that matters most: never state anything ${cook} didn't say. Don't answer from general cooking knowledge, don't guess an amount, time or temperature, and don't sum up a clip. The answer is ${cook}'s own clip, or the question goes to ${cook}. The only exception: if something is on fire or someone is hurt, say "Turn off the heat, and get help if anyone's hurt."

${cook}'s recipe:
${steps}`;
}

export class TurnAgent {
  private client = new Anthropic({ apiKey: env.anthropicKey });
  private system: string;
  private cook: string;
  private messages: Beta.BetaMessageParam[] = [];
  /** Results of the last turn's final tool call; they open the next user message. */
  private pending: Beta.BetaToolResultBlockParam[] = [];
  /** Moments the agent may play: the steps' own, plus whatever find_moment returned. */
  private playable: { startS: number; endS: number; quote?: string }[];

  constructor(
    private session: CookSession,
    private actions: Actions,
  ) {
    this.system = systemPrompt(session);
    this.cook = session.cook?.name ?? "the cook";
    this.playable = session.recipe.steps.map((s) => s.moment);
  }

  /** Handle one finished utterance from the kid. */
  async turn(utterance: string): Promise<void> {
    const steps = this.session.recipe.steps;
    const now = steps.find((s) => s.order === this.actions.currentStep());
    const context = `[On step ${now?.order ?? "?"} of ${steps.length}: ${now?.title ?? ""}]`;
    // Search the video up front (in-memory, ~10 ms), so a question needs one model call, not two.
    let foundThisTurn = await this.actions.findMoment(utterance, 2000).catch(() => [] as Hit[]);
    this.playable.push(...foundThisTurn.map((h) => ({ startS: h.startS, endS: h.endS, quote: h.text })));
    const moments = foundThisTurn.length ? `\nMoments from ${this.cook}'s video that may match: ${momentsJson(foundThisTurn)}` : "";
    this.pushUser([...this.pending, { type: "text", text: `${context}\n${this.session.kid.name}: "${utterance}"${moments}` }]);
    this.pending = [];

    for (let call = 0; call < MAX_CALLS_PER_TURN; call++) {
      const t0 = Date.now();
      const res = await this.ask();
      this.messages.push({ role: "assistant", content: res.content });
      const tool = res.content.find((b): b is Beta.BetaToolUseBlock => b.type === "tool_use");
      console.log(`claude ${Date.now() - t0}ms stop=${res.stop_reason} tool=${tool ? `${tool.name} ${JSON.stringify(tool.input)}` : "none"}`);
      if (!tool) return; // nothing to do: speech wasn't for us, or a refusal

      const input = tool.input as Record<string, unknown>;
      const result = (content: string, is_error = false): Beta.BetaToolResultBlockParam => ({
        type: "tool_result",
        tool_use_id: tool.id,
        content,
        is_error,
      });

      if (tool.name === "find_moment") {
        const hits = await this.actions.findMoment(String(input.query), 15000).catch(() => [] as Hit[]);
        foundThisTurn = [...foundThisTurn, ...hits];
        this.playable.push(...hits.map((h) => ({ startS: h.startS, endS: h.endS, quote: h.text })));
        const body = hits.length ? momentsJson(hits) : "No moment in the video matches. Use ask_cook.";
        this.pushUser([result(body)]);
        continue;
      }

      if (tool.name === "play_clip") {
        const startS = Number(input.start_s);
        const endS = Number(input.end_s);
        const known = this.playable.find((m) => Math.abs(m.startS - startS) < 1 && Math.abs(m.endS - endS) < 1);
        if (!known) {
          this.pushUser([result("Those times aren't a known moment. Use find_moment, or a step's own times.", true)]);
          continue;
        }
        const question = known.quote ? { text: utterance, quote: known.quote } : undefined;
        await this.actions.playClip(known.startS, known.endS, question);
        this.pending = [result("Playing.")];
        return;
      }

      this.pending = [result(await this.run(tool.name, input))];
      return;
    }
    // Ran out of calls without an action (for example, kept searching): send it to the cook.
    await this.actions.askCook(utterance);
  }

  private fast = env.claudeFast;

  private async ask(): Promise<Beta.BetaMessage> {
    const params = {
      model: env.claudeModel,
      max_tokens: 1024,
      system: this.system,
      tools: TOOLS,
      tool_choice: { type: "auto" as const, disable_parallel_tool_use: true },
      messages: this.messages,
      output_config: { effort: "low" as const },
      cache_control: { type: "ephemeral" as const },
      fallbacks: "default" as const,
    };
    if (this.fast) {
      try {
        return await this.client.beta.messages.create(
          { ...params, speed: "fast", betas: ["server-side-fallback-2026-07-01", "fast-mode-2026-02-01"] },
          { maxRetries: 0 },
        );
      } catch (err) {
        if (!(err instanceof Anthropic.RateLimitError)) throw err;
        console.warn("fast mode rate-limited; standard speed for this session");
        this.fast = false;
      }
    }
    return this.client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"] });
  }

  /** Appends user content, joining the last message if it's already a user one (a turn that ran out of calls). */
  private pushUser(content: Beta.BetaContentBlockParam[]) {
    const last = this.messages.at(-1);
    if (last?.role === "user" && Array.isArray(last.content)) last.content.push(...content);
    else this.messages.push({ role: "user", content });
  }

  private async run(name: string, input: Record<string, unknown>): Promise<string> {
    const a = this.actions;
    const last = this.session.recipe.steps.length;
    const step = a.currentStep();
    switch (name) {
      case "next_step":
        if (step >= last) {
          await a.say("That was the last step. Enjoy it!");
          return "Already on the last step.";
        }
        await a.goToStep(step + 1);
        return `Now on step ${step + 1}.`;
      case "previous_step":
        await a.goToStep(Math.max(1, step - 1));
        return `Now on step ${Math.max(1, step - 1)}.`;
      case "repeat_step":
        await a.goToStep(step);
        return `Repeated step ${step}.`;
      case "go_to_step": {
        const n = Math.min(last, Math.max(1, Number(input.n)));
        await a.goToStep(n);
        return `Now on step ${n}.`;
      }
      case "ask_cook":
        await a.askCook(String(input.question));
        return "Sent to the cook.";
      case "say":
        await a.say(String(input.text));
        return "Said.";
      default:
        return `Unknown tool ${name}.`;
    }
  }
}
