// One shape for every explicit state machine in the app (docs/agents/STATE-MACHINES.md): a table of
// state → event → next state, and nothing else. Components send events and read the state; they never set
// flags. An event a state doesn't list does nothing (logged in dev, never thrown).
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
  /** The next state, or null when `event` does nothing in `state`. */
  transition: (state: S, event: E) => S | null;
};

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
      if (next !== undefined) return next;
      if (dev()) console.log(`[${name}] ${event} does nothing in ${state}`);
      return null;
    },
  };
}

/** One machine's state in a component: `send(event)` moves it, or leaves it where it is. */
export function useMachine<S extends string, E extends string>(m: Machine<S, E>, initial: S | (() => S)): [S, (event: E) => void] {
  return useReducer(
    (state: S, event: E) => m.transition(state, event) ?? state,
    undefined,
    () => (typeof initial === 'function' ? (initial as () => S)() : initial),
  );
}
