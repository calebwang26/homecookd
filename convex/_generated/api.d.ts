/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as alerts from "../alerts.js";
import type * as apple from "../apple.js";
import type * as community from "../community.js";
import type * as cooking from "../cooking.js";
import type * as cravings from "../cravings.js";
import type * as crons from "../crons.js";
import type * as dinners from "../dinners.js";
import type * as dishAskModel from "../dishAskModel.js";
import type * as dishAsks from "../dishAsks.js";
import type * as files from "../files.js";
import type * as followUps from "../followUps.js";
import type * as glasses from "../glasses.js";
import type * as homie from "../homie.js";
import type * as http from "../http.js";
import type * as ids from "../ids.js";
import type * as jobs from "../jobs.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_cravingLinks from "../lib/cravingLinks.js";
import type * as lib_dishAsk_prompts from "../lib/dishAsk/prompts.js";
import type * as lib_dishAsk_types from "../lib/dishAsk/types.js";
import type * as lib_dishAsk_validate from "../lib/dishAsk/validate.js";
import type * as lib_dishAskRoutes from "../lib/dishAskRoutes.js";
import type * as lib_dishAskValues from "../lib/dishAskValues.js";
import type * as lib_forKids from "../lib/forKids.js";
import type * as lib_geo from "../lib/geo.js";
import type * as lib_glassesRoutes from "../lib/glassesRoutes.js";
import type * as lib_http from "../lib/http.js";
import type * as lib_inviteRoutes from "../lib/inviteRoutes.js";
import type * as lib_joinTicket from "../lib/joinTicket.js";
import type * as lib_linkRoutes from "../lib/linkRoutes.js";
import type * as lib_liveRoutes from "../lib/liveRoutes.js";
import type * as lib_moderation from "../lib/moderation.js";
import type * as lib_mossDocs from "../lib/mossDocs.js";
import type * as lib_push from "../lib/push.js";
import type * as lib_pushWords from "../lib/pushWords.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_recipeJson from "../lib/recipeJson.js";
import type * as lib_safety from "../lib/safety.js";
import type * as lib_storyCard from "../lib/storyCard.js";
import type * as lib_supabase from "../lib/supabase.js";
import type * as lib_textModel from "../lib/textModel.js";
import type * as lib_translate from "../lib/translate.js";
import type * as lib_webOrigin from "../lib/webOrigin.js";
import type * as lib_yesNo from "../lib/yesNo.js";
import type * as links from "../links.js";
import type * as live from "../live.js";
import type * as liveEvents from "../liveEvents.js";
import type * as messages from "../messages.js";
import type * as moss from "../moss.js";
import type * as people from "../people.js";
import type * as push from "../push.js";
import type * as pushEvents from "../pushEvents.js";
import type * as questions from "../questions.js";
import type * as recipes from "../recipes.js";
import type * as reports from "../reports.js";
import type * as seed from "../seed.js";
import type * as seedCommunity from "../seedCommunity.js";
import type * as sessions from "../sessions.js";
import type * as shareRequests from "../shareRequests.js";
import type * as signer from "../signer.js";
import type * as storyCards from "../storyCards.js";
import type * as transcribe from "../transcribe.js";
import type * as voice from "../voice.js";
import type * as worker from "../worker.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  alerts: typeof alerts;
  apple: typeof apple;
  community: typeof community;
  cooking: typeof cooking;
  cravings: typeof cravings;
  crons: typeof crons;
  dinners: typeof dinners;
  dishAskModel: typeof dishAskModel;
  dishAsks: typeof dishAsks;
  files: typeof files;
  followUps: typeof followUps;
  glasses: typeof glasses;
  homie: typeof homie;
  http: typeof http;
  ids: typeof ids;
  jobs: typeof jobs;
  "lib/auth": typeof lib_auth;
  "lib/cravingLinks": typeof lib_cravingLinks;
  "lib/dishAsk/prompts": typeof lib_dishAsk_prompts;
  "lib/dishAsk/types": typeof lib_dishAsk_types;
  "lib/dishAsk/validate": typeof lib_dishAsk_validate;
  "lib/dishAskRoutes": typeof lib_dishAskRoutes;
  "lib/dishAskValues": typeof lib_dishAskValues;
  "lib/forKids": typeof lib_forKids;
  "lib/geo": typeof lib_geo;
  "lib/glassesRoutes": typeof lib_glassesRoutes;
  "lib/http": typeof lib_http;
  "lib/inviteRoutes": typeof lib_inviteRoutes;
  "lib/joinTicket": typeof lib_joinTicket;
  "lib/linkRoutes": typeof lib_linkRoutes;
  "lib/liveRoutes": typeof lib_liveRoutes;
  "lib/moderation": typeof lib_moderation;
  "lib/mossDocs": typeof lib_mossDocs;
  "lib/push": typeof lib_push;
  "lib/pushWords": typeof lib_pushWords;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/recipeJson": typeof lib_recipeJson;
  "lib/safety": typeof lib_safety;
  "lib/storyCard": typeof lib_storyCard;
  "lib/supabase": typeof lib_supabase;
  "lib/textModel": typeof lib_textModel;
  "lib/translate": typeof lib_translate;
  "lib/webOrigin": typeof lib_webOrigin;
  "lib/yesNo": typeof lib_yesNo;
  links: typeof links;
  live: typeof live;
  liveEvents: typeof liveEvents;
  messages: typeof messages;
  moss: typeof moss;
  people: typeof people;
  push: typeof push;
  pushEvents: typeof pushEvents;
  questions: typeof questions;
  recipes: typeof recipes;
  reports: typeof reports;
  seed: typeof seed;
  seedCommunity: typeof seedCommunity;
  sessions: typeof sessions;
  shareRequests: typeof shareRequests;
  signer: typeof signer;
  storyCards: typeof storyCards;
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
