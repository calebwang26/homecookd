// Community for 1.1: the neighborhood feed and map, a shared recipe's page, swaps and "cook together", dinners and
// their invite links, and "Report or block". Contract: docs/build/contracts/COMMUNITY.md on aws-migration. Screens
// move onto these behind AWS_ON (config.ts). Field names are Convex's, so the app's types fit as they are.
//
// What another family can't see answers 404, the same as a missing row. Swaps, reports and blocks act for the whole
// family. A new dinner always carries an Idempotency-Key, so a retry never hosts twice.

import type { BlockedFamily, CommunityFeed, CommunityRecipe, Dinner, FeedDinner, NewDinner, Reportable, ReportReason, Swap } from '../live/community';
import { request } from './client';

const enc = encodeURIComponent;
const q = (params: Record<string, string | number | null | undefined>) => {
  const s = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${enc(String(v))}`)
    .join('&');
  return s ? `?${s}` : '';
};

async function pages<T>(read: (cursor: string | null) => Promise<{ items: T[]; next: string | null }>, max = 10): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < max; i++) {
    const p: { items: T[]; next: string | null } = await read(cursor);
    out.push(...p.items);
    if (!p.next) break;
    cursor = p.next;
  }
  return out;
}

type FeedPage = { here: CommunityFeed['here']; recipes: CommunityFeed['recipes']; dinners: FeedDinner[]; nextCursor: string | null; dinnersCursor: string | null };

export const community = {
  /** The feed, every page of recipes and of dinners (the dinners page on through `dinnersCursor`). */
  async feed(maxMiles?: number | null, as?: string | null): Promise<CommunityFeed> {
    const first = await request<FeedPage>(`/v1/community/feed${q({ maxMiles })}`, { auth: 'session', as });
    const recipes = [...first.recipes];
    let cursor = first.nextCursor;
    for (let i = 0; cursor && i < 10; i++) {
      const p: FeedPage = await request<FeedPage>(`/v1/community/feed${q({ maxMiles, cursor })}`, { auth: 'session', as });
      recipes.push(...p.recipes);
      cursor = p.nextCursor;
    }
    const dinners = [...first.dinners];
    let dc = first.dinnersCursor;
    for (let i = 0; dc && i < 10; i++) {
      const p: { dinners: FeedDinner[]; nextCursor: string | null } = await request(`/v1/community/dinners${q({ maxMiles, cursor: dc })}`, { auth: 'session', as });
      dinners.push(...p.dinners);
      dc = p.nextCursor;
    }
    return { here: first.here, recipes, dinners };
  },
  recipe: (id: string, as?: string | null) => request<CommunityRecipe>(`/v1/community/recipes/${enc(id)}`, { auth: 'session', as }),

  swaps: (as?: string | null) =>
    pages(async (cursor) => {
      const p = await request<{ swaps: Swap[]; nextCursor: string | null }>(`/v1/community/swaps${q({ cursor })}`, { auth: 'session', as });
      return { items: p.swaps, next: p.nextCursor };
    }),
  requestSwap: (recipeId: string, myRecipeId?: string, as?: string | null) =>
    request<{ swapId: string }>('/v1/community/swaps', { auth: 'session', as, body: myRecipeId ? { recipeId, myRecipeId } : { recipeId } }),
  cookTogether: (recipeId: string, as?: string | null) => request<{ swapId: string }>('/v1/community/cook-together', { auth: 'session', as, body: { recipeId } }),
  respondSwap: (swapId: string, accept: boolean, as?: string | null) =>
    request<{ ok: true }>(`/v1/community/swaps/${enc(swapId)}/respond`, { auth: 'session', as, body: { accept } }),

  /** A new dinner, with its Idempotency-Key (one per dinner she hosts, kept for her retries). */
  createDinner: (dinner: NewDinner, idempotencyKey: string, as?: string | null) =>
    request<{ dinnerId: string }>('/v1/dinners', { auth: 'session', as, body: dinner, idempotencyKey }),
  dinner: (id: string, as?: string | null) => request<Dinner>(`/v1/dinners/${enc(id)}`, { auth: 'session', as }),
  myDinners: (as?: string | null) =>
    pages(async (cursor) => {
      const p = await request<{ dinners: Dinner[]; nextCursor: string | null }>(`/v1/dinners/mine${q({ cursor })}`, { auth: 'session', as });
      return { items: p.dinners, next: p.nextCursor };
    }),
  join: (dinnerId: string, as?: string | null) => request<{ requestId: string }>(`/v1/dinners/${enc(dinnerId)}/join`, { auth: 'session', as, body: {} }),
  respond: (requestId: string, accept: boolean, as?: string | null) =>
    request<{ ok: true }>(`/v1/dinner-requests/${enc(requestId)}/respond`, { auth: 'session', as, body: { accept } }),
  inviteLink: (dinnerId: string, as?: string | null) =>
    request<{ token: string; url: string }>(`/v1/dinners/${enc(dinnerId)}/invite-link`, { auth: 'session', as, body: {} }),

  report: (kind: Reportable, targetId: string, reason: ReportReason, as?: string | null) =>
    request<{ ok: true }>('/v1/community/reports', { auth: 'session', as, body: { kind, targetId, reason } }),
  block: (kind: Reportable, targetId: string, as?: string | null) =>
    request<{ ok: true }>('/v1/community/blocks', { auth: 'session', as, body: { kind, targetId } }),
  blocked: (as?: string | null) =>
    pages(async (cursor) => {
      const p = await request<{ blocked: BlockedFamily[]; nextCursor: string | null }>(`/v1/community/blocks${q({ cursor })}`, { auth: 'session', as });
      return { items: p.blocked, next: p.nextCursor };
    }),
  unblock: (blockId: string, as?: string | null) =>
    request<{ ok: true }>(`/v1/community/blocks/${enc(blockId)}`, { auth: 'session', as, method: 'DELETE' }),

  /** The public invite page's call (no session): the dish, the host's name and when. */
  openInvite: (token: string, deviceId: string) => request<{ dish: string; hostName: string; startsAt: number }>('/invite/open', { auth: 'none', body: { token, deviceId } }),
};
