import { afterEach, expect, test } from "vitest";

import { askUrlOf } from "./dishAsks";
import { cravingUrl } from "./lib/cravingLinks";
import { isWebOrigin, webOrigin } from "./lib/webOrigin";

afterEach(() => {
  delete process.env.DISH_WEB_ORIGIN;
});

test("links point at homecookd.app unless DISH_WEB_ORIGIN names a test site", () => {
  expect(webOrigin()).toBe("https://homecookd.app");
  expect(askUrlOf("t")).toBe("https://homecookd.app/a?t=t");
  process.env.DISH_WEB_ORIGIN = "https://test.homecookd.app";
  expect(cravingUrl("c")).toBe("https://test.homecookd.app/miss?c=c");
  expect(isWebOrigin("https://test.homecookd.app")).toBe(true);
  expect(isWebOrigin("https://evil.example")).toBe(false);
});

test("a malformed DISH_WEB_ORIGIN falls back to homecookd.app", () => {
  process.env.DISH_WEB_ORIGIN = "javascript:alert(1)";
  expect(webOrigin()).toBe("https://homecookd.app");
});
