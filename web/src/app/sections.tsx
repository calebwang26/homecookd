'use client';
// The sections below DeckFilm, each in its own JS chunk (performance budget, brief 11; the
// scheduling lives in src/lib/deferred.ts).
//
// Server: next/dynamic renders the section into the HTML and links its CSS in <head>, so the page
// paints exactly as before and no-JS visitors get the full, readable page.
// Client: the slot first hydrates as a frozen <div> that keeps the server HTML untouched
// (dangerouslySetInnerHTML + suppressHydrationWarning, so React neither diffs nor clears it, and no
// context change can reach it). When its turn comes, the real component mounts in its place in one
// commit. The wrapper is display: contents, so layout, sticky stages and selectors see the section
// exactly where it was.
import dynamic from 'next/dynamic';
import { startTransition, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { mountSlot, registerSlot } from '@/lib/deferred';

// next/dynamic needs literal import() calls, one per section (its compiler pass maps them to CSS).
const SSR = {
  'steps-to-box': dynamic(() => import('@/components/sections/StepsToBox/StepsToBox').then((m) => m.StepsToBox)),
  'see-it-work': dynamic(() => import('@/components/sections/SeeItWork/SeeItWork').then((m) => m.SeeItWork)),
  'family-table': dynamic(() => import('@/components/sections/StepsToBox/FamilyTable').then((m) => m.FamilyTable)),
  'every-family': dynamic(() => import('@/components/sections/EveryFamily/EveryFamily').then((m) => m.EveryFamily)),
  'in-their-words': dynamic(() => import('@/components/sections/InTheirWords/InTheirWords').then((m) => m.InTheirWords)),
  'far-apart': dynamic(() => import('@/components/sections/FarApart/FarApart').then((m) => m.FarApart)),
  questions: dynamic(() => import('@/components/sections/Questions/Questions').then((m) => m.Questions)),
  'final-cta': dynamic(() => import('@/components/sections/FinalCta/FinalCta').then((m) => m.FinalCta)),
  footer: dynamic(() => import('@/components/sections/Footer/Footer').then((m) => m.Footer)),
} satisfies Record<string, ComponentType>;

export type SectionId = keyof typeof SSR;

const LOAD: Record<SectionId, () => Promise<ComponentType>> = {
  'steps-to-box': () => import('@/components/sections/StepsToBox/StepsToBox').then((m) => m.StepsToBox),
  'see-it-work': () => import('@/components/sections/SeeItWork/SeeItWork').then((m) => m.SeeItWork),
  'family-table': () => import('@/components/sections/StepsToBox/FamilyTable').then((m) => m.FamilyTable),
  'every-family': () => import('@/components/sections/EveryFamily/EveryFamily').then((m) => m.EveryFamily),
  'in-their-words': () => import('@/components/sections/InTheirWords/InTheirWords').then((m) => m.InTheirWords),
  'far-apart': () => import('@/components/sections/FarApart/FarApart').then((m) => m.FarApart),
  questions: () => import('@/components/sections/Questions/Questions').then((m) => m.Questions),
  'final-cta': () => import('@/components/sections/FinalCta/FinalCta').then((m) => m.FinalCta),
  footer: () => import('@/components/sections/Footer/Footer').then((m) => m.Footer),
};

const ORDER = Object.keys(SSR) as SectionId[];
const SLOT_STYLE = { display: 'contents' } as const;

/** One deferred section. `id` is the slot name (not the DOM id; the section keeps its own ids). */
export function Section({ id }: { id: SectionId }) {
  const ref = useRef<HTMLDivElement>(null);
  const [Comp, setComp] = useState<ComponentType | null>(null);
  const refocus = useRef<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const unregister = registerSlot(id, ORDER.indexOf(id), LOAD[id], (C) => {
      // Keep keyboard focus across the swap (e.g. the skip link or an in-page anchor landed here).
      const active = document.activeElement;
      if (active instanceof HTMLElement && el.contains(active)) {
        refocus.current = active.id || active.closest<HTMLElement>('[id]')?.id || null;
      }
      startTransition(() => setComp(() => C));
    });

    // Near the viewport (one screen ahead), focused or touched: mount now.
    const now = () => mountSlot(id);
    const target = el.firstElementChild;
    // No server HTML in the slot: the page was rendered on the client (a soft navigation into the
    // lander, e.g. a next/link from another page). There's nothing frozen to show, so mount now
    // rather than leave the section blank until the idle queue (which slow/weak devices skip).
    if (!target) void now();
    let io: IntersectionObserver | undefined;
    if (target) {
      io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && now(), {
        rootMargin: '100% 0px 100% 0px',
      });
      io.observe(target);
    }
    el.addEventListener('focusin', now);
    el.addEventListener('pointerdown', now);
    return () => {
      unregister();
      io?.disconnect();
      el.removeEventListener('focusin', now);
      el.removeEventListener('pointerdown', now);
    };
  }, [id]);

  useLayoutEffect(() => {
    if (!Comp || !refocus.current) return;
    const target = document.getElementById(refocus.current);
    refocus.current = null;
    if (!target) return;
    if (!target.matches('a, button, input, select, textarea, summary, [tabindex]')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }, [Comp]);

  if (typeof window === 'undefined') {
    const Ssr = SSR[id];
    return (
      <div data-section={id} style={SLOT_STYLE}>
        <Ssr />
      </div>
    );
  }
  if (!Comp) {
    return <div ref={ref} data-section={id} style={SLOT_STYLE} suppressHydrationWarning dangerouslySetInnerHTML={FROZEN} />;
  }
  return (
    <div ref={ref} data-section={id} style={SLOT_STYLE}>
      <Comp />
    </div>
  );
}

const FROZEN = { __html: '' };
