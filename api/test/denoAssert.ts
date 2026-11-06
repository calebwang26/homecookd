// Just enough of Deno's asserts for the tests carried over from supabase/tests/ to run unchanged on node:test.
import nodeAssert from "node:assert/strict";
import { test } from "node:test";

type TestOptions = { name: string; fn: () => void | Promise<void>; sanitizeOps?: boolean; sanitizeResources?: boolean };

export const Deno = {
  test(first: string | TestOptions, fn?: () => void | Promise<void>): void {
    if (typeof first === "string") test(first, fn!);
    else test(first.name, first.fn);
  },
};

export function assert(value: unknown, message?: string): asserts value {
  nodeAssert.ok(value, message);
}
export const assertFalse = (value: unknown, message?: string): void => nodeAssert.ok(!value, message);
export const assertEquals = <T>(actual: T, expected: T, message?: string): void => nodeAssert.deepStrictEqual(actual, expected, message);
export const assertThrows = (fn: () => unknown, _type?: unknown, includes?: string): void => {
  if (includes) nodeAssert.throws(fn, (e: Error) => e.message.includes(includes));
  else nodeAssert.throws(fn);
};
