'use client';
// Register GSAP plugins once (brief 4.6). Always import gsap from here, never from 'gsap' directly:
//
//   import { gsap, ScrollTrigger, useGSAP } from '@/lib/motion/gsap';
//   import { MQ } from '@/lib/motion/media';
//   useGSAP(() => {
//     const mm = gsap.matchMedia();
//     mm.add(MQ.desktop, () => { const tl = gsap.timeline({ scrollTrigger: { trigger, start: 'top top', end: '+=230%', pin: true, scrub: SCRUB, anticipatePin: 1, invalidateOnRefresh: true } }); ... });
//     mm.add(MQ.mobile, () => { ... });
//   }, { scope: rootRef });

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger, useGSAP);
  ScrollTrigger.config({ ignoreMobileResize: true });
  gsap.defaults({ ease: 'power2.out' });
}

export { gsap, ScrollTrigger, useGSAP };
