// The cook's side of kids' asks for 1.1: her craving link, the cards asked of her, her filming day, and her voice
// recipe. Contract: docs/build/contracts/DISH.md on aws-migration ("The cook's routes in the app"). Screens move onto
// these behind AWS_ON (config.ts). The web's /dish/* routes are the site's, and 1.1 makes no card in the app.
//
// Her requests show only cards asked of her. A voice recipe is three steps: a link for its exact type and size, one
// PUT of exactly those bytes, then the send, which starts the merge (`voiceRecipe` goes writing, then ready or failed).

import type { CravingAsk } from '../cravings';
import { request } from './client';

const enc = encodeURIComponent;

export const cravings = {
  /** Every card asked of her, newest first, answered ones too (50 a page, read to the end). */
  async all(as?: string | null): Promise<CravingAsk[]> {
    const out: CravingAsk[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const page: { asks: CravingAsk[]; nextCursor: string | null } = await request(`/v1/cravings${cursor ? `?cursor=${enc(cursor)}` : ''}`, { auth: 'session', as });
      out.push(...page.asks);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return out;
  },
  /** One card asked of her (a push, or past the first page). Not hers: 404. */
  get: (id: string, as?: string | null) => request<CravingAsk>(`/v1/cravings/${enc(id)}`, { auth: 'session', as }),
  /** Her one live link, reused; a new `message` replaces its line. */
  link: (message?: string | null, as?: string | null) =>
    request<{ url: string }>('/v1/cravings/link', { auth: 'session', as, body: message ? { message } : {} }),
  revokeLink: (as?: string | null) => request<{ ok: true }>('/v1/cravings/link/revoke', { auth: 'session', as, body: {} }),
  /** 0 (Sunday) to 6, or null to clear: "Mom's filming it Sunday" on the kid's card. */
  filmingDay: (id: string, day: number | null, as?: string | null) =>
    request<{ ok: true }>(`/v1/cravings/${enc(id)}/filming-day`, { auth: 'session', as, body: { day } }),
  voiceUpload: (id: string, contentType: string, size: number, as?: string | null) =>
    request<{ audioKey: string; contentType: string; size: number; uploadUrl: string; uploadHeaders: Record<string, string>; expiresInS: number }>(
      `/v1/cravings/${enc(id)}/voice-recipe/upload`,
      { auth: 'session', as, body: { contentType, size } },
    ),
  /** Sends her voice recipe (1 to 120 s); the merge starts. The same audioKey again changes nothing. */
  voiceRecipe: (id: string, input: { audioKey: string; durationS: number; language?: string }, as?: string | null) =>
    request<{ ok: true }>(`/v1/cravings/${enc(id)}/voice-recipe`, { auth: 'session', as, body: input }),
};
