// @machine
// One shape for every explicit state machine in the app (docs/agents/STATE-MACHINES.md): a table of
// state → event → next state, and nothing else. Components send events and read the state; they never set
// flags. An event a state doesn't list does nothing (logged in dev, never thrown). Every event a component
// sends is kept in its machine's last-20 history (machineHistory), for reports of a stuck screen.
//
//   const door = machine('door', ['open', 'close'] as const, { shut: { open: 'ajar' }, ajar: { close: 'shut' } });
//   door.transition('shut', 'open')   // 'ajar'
//   door.transition('ajar', 'open')   // null: nothing happens
//   const [state, send] = useMachine(door, 'shut');
//
// Pure apart from useMachine (React), so scripts/test-*.mjs run a table under node and enumerate every
// state × event pair against the expected one.
import { useReducer } from 'react';

export type Table<S extends string, E extends string> = Readonly<Record<S, Readonly<Partial<Record<E, S>>>>>;

export type Machine<S extends string, E extends string> = {
  name: string;
  states: readonly S[];
  events: readonly E[];
  table: Table<S, E>;
  /** The next state, or null when `event` does nothing in `state`. Pure. */
  transition: (state: S, event: E) => S | null;
  /** transition, recorded in this machine's history (useMachine sends through it). */
  step: (state: S, event: E) => S | null;
};

/** One recorded event: what came, from where, to where (null: it did nothing), when. */
export type MachineStep = { event: string; from: string; to: string | null; t: number };

/** The last HISTORY_SIZE events of each machine, so a report of a stuck screen carries the sequence. */
export const HISTORY_SIZE = 20;
const histories = new Map<string, MachineStep[]>();

function remember(name: string, step: MachineStep) {
  const h = histories.get(name) ?? [];
  h.push(step);
  if (h.length > HISTORY_SIZE) h.splice(0, h.length - HISTORY_SIZE);
  histories.set(name, h);
}

/** Every machine's recent events, oldest first (for an error report or a dev log). */
export function machineHistory(): Record<string, MachineStep[]> {
  return Object.fromEntries([...histories].map(([name, h]) => [name, h.map((x) => ({ ...x }))]));
}

/** Forget every history (tests). */
export function clearMachineHistory() {
  histories.clear();
}

const dev = () => typeof __DEV__ !== 'undefined' && __DEV__;

export function machine<S extends string, E extends string>(name: string, events: readonly E[], table: Table<S, E>): Machine<S, E> {
  const states = Object.keys(table) as S[];
  return {
    name,
    states,
    events,
    table,
    transition(state, event) {
      const next = table[state]?.[event];
      return next !== undefined ? next : null;
    },
    step(state, event) {
      const next = table[state]?.[event];
      const to = next !== undefined ? next : null;
      remember(name, { event, from: state, to, t: Date.now() });
      if (to === null && dev()) console.log(`[${name}] ${event} does nothing in ${state}`);
      return to;
    },
  };
}

/** One machine's state in a component: `send(event)` moves it, or leaves it where it is. */
export function useMachine<S extends string, E extends string>(m: Machine<S, E>, initial: S | (() => S)): [S, (event: E) => void] {
  return useReducer(
    // Recorded (machineHistory); in dev React may run this twice, so an event can show up twice there.
    (state: S, event: E) => m.step(state, event) ?? state,
    undefined,
    () => (typeof initial === 'function' ? (initial as () => S)() : initial),
  );
}
