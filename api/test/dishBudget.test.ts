import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetFrom } from "../src/modules/dish/values.js";

test("the daily budget: $10 unless a valid override is set", () => {
  assert.equal(budgetFrom(undefined), 10);
  assert.equal(budgetFrom("1"), 1);
  for (const bad of ["", "0", "-5", "abc", "Infinity"]) assert.equal(budgetFrom(bad), 10, bad);
});
