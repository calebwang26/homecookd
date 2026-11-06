// The lander's visit log, as Supabase's landerEvent wrote it (supabase/functions/api/index.ts): which page someone saw and why (`event` land | switch,
// `aud` parent | kid), and `tap` on the hero's buttons. The same fields, limits and words. Nothing about the person goes in the row: no IP, no user agent.
// Kept with no end date, as on Supabase, where nothing deletes them. TODO(caleb): a retention period if you want one; scheduled.ts's prune is where it would go.
import { db } from "../../db.js";
import { invalid } from "../../errors.js";

type Body = Record<string, unknown>;

const EVENTS = ["land", "switch", "tap"];
const AUDS = ["parent", "kid"];
const SIGNALS = ["aud", "saved", "snapchat", "link", "default", "switch"];

/** Supabase's str(): blank or missing is none, anything else is a string, trimmed, at most `max`. */
function text(body: Body, field: string, max: number, required = false): string | null {
  const value = body[field];
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    if (required) throw invalid(field, `${field} is required`);
    return null;
  }
  if (typeof value !== "string") throw invalid(field, `${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw invalid(field, `${field} must be at most ${max} characters`);
  return trimmed;
}

function oneOf(body: Body, field: string, allowed: string[], required = false): string | null {
  const value = text(body, field, 20, required);
  if (value !== null && !allowed.includes(value)) throw invalid(field, `${field} must be one of ${allowed.join(", ")}`);
  return value;
}

export async function logVisit(body: Body): Promise<void> {
  const row = [
    oneOf(body, "event", EVENTS, true),
    oneOf(body, "aud", AUDS, true),
    oneOf(body, "signal", SIGNALS),
    text(body, "app", 100),
    text(body, "utm_source", 100),
    text(body, "utm_campaign", 100),
    text(body, "path", 100),
    text(body, "ui", 20),
    text(body, "host", 60), // location.hostname, so preview and test traffic can be filtered out
  ];
  await db().query(`insert into lander_events (event, aud, signal, app, utm_source, utm_campaign, path, ui, host) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, row);
}
