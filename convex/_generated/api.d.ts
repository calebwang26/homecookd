/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as community from "../community.js";
import type * as cooking from "../cooking.js";
import type * as crons from "../crons.js";
import type * as dinners from "../dinners.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as ids from "../ids.js";
import type * as jobs from "../jobs.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_geo from "../lib/geo.js";
import type * as lib_mossDocs from "../lib/mossDocs.js";
import type * as lib_recipeJson from "../lib/recipeJson.js";
import type * as lib_supabase from "../lib/supabase.js";
import type * as lib_translate from "../lib/translate.js";
import type * as messages from "../messages.js";
import type * as moss from "../moss.js";
import type * as questions from "../questions.js";
import type * as recipes from "../recipes.js";
import type * as seed from "../seed.js";
import type * as seedCommunity from "../seedCommunity.js";
import type * as sessions from "../sessions.js";
import type * as transcribe from "../transcribe.js";
import type * as voice from "../voice.js";
import type * as worker from "../worker.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  community: typeof community;
  cooking: typeof cooking;
  crons: typeof crons;
  dinners: typeof dinners;
  files: typeof files;
  http: typeof http;
  ids: typeof ids;
  jobs: typeof jobs;
  "lib/auth": typeof lib_auth;
  "lib/geo": typeof lib_geo;
  "lib/mossDocs": typeof lib_mossDocs;
  "lib/recipeJson": typeof lib_recipeJson;
  "lib/supabase": typeof lib_supabase;
  "lib/translate": typeof lib_translate;
  messages: typeof messages;
  moss: typeof moss;
  questions: typeof questions;
  recipes: typeof recipes;
  seed: typeof seed;
  seedCommunity: typeof seedCommunity;
  sessions: typeof sessions;
  transcribe: typeof transcribe;
  voice: typeof voice;
  worker: typeof worker;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
