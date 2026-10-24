// How ChatLog lays a conversation out, with no React (scripts/test-cooking.mjs runs it under Node):
// reactions taken out of the flow (splitReactions), the rest grouped by sender (groupMessages), and
// the group that carries my "· Sent" (lastWrittenGroup).
//
// A quiet line (a system note, or a reaction stamp that answers nothing here, e.g. a heart mid-cook)
// never carries a time, so in the parent layout (no day lines) it can't carry the day either: when one
// opens a day, the next group with a time line names the day ("Today, 6:40 pm"), not just "6:40 pm".
import { differentDay } from '@/lib/format';
import type { ChatMessage } from '@/lib/messaging';

export const GROUP_GAP_MS = 10 * 60 * 1000;

export type Group = {
  key: string;
  sender: string;
  mine: boolean;
  system: boolean;
  /** A reaction that answers nothing here (a heart mid-cook), drawn as a quiet centred line. */
  stamp: boolean;
  messages: ChatMessage[];
  /** The group opens a new day (the kid layout draws the day line above it). */
  firstOfDay: boolean;
  /**
   * The group's time line names the day (parent layout: "Today, 6:40 pm"): the first group of the day
   * that has a time line, even when a quiet line opened the day above it. Never on a quiet line.
   */
  showsDay: boolean;
};

const isQuiet = (m: ChatMessage) => m.kind === 'system' || m.kind === 'reaction';

/**
 * Messages grouped by sender (same day, within 10 minutes). System notes and reaction stamps are
 * groups of their own; the same reaction again from the same person right after (a few taps on the
 * heart) shows once.
 */
export function groupMessages(list: readonly ChatMessage[], meId: string | null | undefined): Group[] {
  const groups: Group[] = [];
  let prev: ChatMessage | null = null;
  // A quiet line opened the day and no group with a time line has named it yet.
  let dayUnnamed = false;
  for (const m of list) {
    const system = m.kind === 'system';
    const stamp = m.kind === 'reaction';
    const quiet = isQuiet(m);
    const mine = m.sender_id === meId && !quiet;
    const newDay = !prev || differentDay(prev.created_at, m.created_at);
    const gap = prev ? new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() : Infinity;
    const g = groups[groups.length - 1];
    const again = stamp && !!g?.stamp && g.sender === m.sender_id && g.messages[0].body === m.body && !newDay && gap <= GROUP_GAP_MS;
    if (again) {
      prev = m;
      continue;
    }
    if (!g || system || g.system || stamp || g.stamp || g.sender !== m.sender_id || newDay || gap > GROUP_GAP_MS || prev?.local === 'failed') {
      const showsDay = !quiet && (newDay || dayUnnamed);
      groups.push({ key: m.localId ?? m.id, sender: m.sender_id, mine, system, stamp, messages: [m], firstOfDay: newDay, showsDay });
      if (newDay) dayUnnamed = quiet;
      else if (!quiet) dayUnnamed = false;
    } else {
      g.messages.push(m);
    }
    prev = m;
  }
  return groups;
}

/**
 * Reactions out of the conversation's flow: the ones answering a message here go under it (one per
 * person and reaction), the rest stay in place as quiet lines. `messages` has no reactions at all,
 * for everything that reads the conversation (answers, dish cards, open questions).
 */
export function splitReactions(all: readonly ChatMessage[]) {
  const messages = all.filter((m) => m.kind !== 'reaction');
  const here = new Set(messages.map((m) => m.id));
  const under = new Map<string, ChatMessage[]>();
  const flow: ChatMessage[] = [];
  for (const m of all) {
    if (m.kind !== 'reaction') {
      flow.push(m);
      continue;
    }
    if (m.reply_to && here.has(m.reply_to)) {
      const list = under.get(m.reply_to) ?? [];
      if (!list.some((x) => x.sender_id === m.sender_id && x.body === m.body)) list.push(m);
      under.set(m.reply_to, list);
    } else {
      flow.push(m);
    }
  }
  return { messages, flow, under };
}

/** The newest group someone wrote: "Linda joined." or a heart after my message doesn't take my "Sent" away. */
export function lastWrittenGroup(groups: readonly Group[]): Group | undefined {
  for (let i = groups.length - 1; i >= 0; i--) if (!groups[i].system && !groups[i].stamp) return groups[i];
  return undefined;
}
