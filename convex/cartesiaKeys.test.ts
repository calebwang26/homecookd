// The cook's voice-note transcript (transcribe.ts) moves to the next Cartesia key when one is out of credits, and
// only then.
import { afterEach, expect, test, vi } from "vitest";
import { cartesiaKeys, inkTranscribeWithKeys } from "./transcribe";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CARTESIA_API_KEY;
  delete process.env.CARTESIA_API_KEYS_BACKUP;
});

const audio = () => new Blob([new Uint8Array(64)], { type: "audio/mp4" });
const keyOf = (init?: RequestInit) => (init?.headers as Record<string, string>).Authorization.replace("Bearer ", "");
const outOfCredits = () => Response.json({ error_code: "quota_exceeded", message: "Model credits limit reached." }, { status: 402 });

test("the keys: CARTESIA_API_KEY, then the backups in order", () => {
  process.env.CARTESIA_API_KEY = "key-1";
  process.env.CARTESIA_API_KEYS_BACKUP = " key-2, ,key-3 ";
  expect(cartesiaKeys()).toEqual(["key-1", "key-2", "key-3"]);
});

test("a key out of credits moves on to the next", async () => {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => (keyOf(init) === "key-1" ? outOfCredits() : Response.json({ text: " Yes. " })));
  vi.stubGlobal("fetch", fetch);
  expect(await inkTranscribeWithKeys(audio(), ["key-1", "key-2"])).toBe("Yes.");
  expect(fetch.mock.calls.map(([, init]) => keyOf(init))).toEqual(["key-1", "key-2"]);
});

test("any other error is thrown at once, with no second key tried", async () => {
  const fetch = vi.fn(async () => new Response("down", { status: 500 }));
  vi.stubGlobal("fetch", fetch);
  await expect(inkTranscribeWithKeys(audio(), ["key-1", "key-2"])).rejects.toThrow("Cartesia STT 500");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("every key out of credits: the error comes through", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => outOfCredits()));
  await expect(inkTranscribeWithKeys(audio(), ["key-1", "key-2"])).rejects.toThrow("Cartesia STT 402");
});
