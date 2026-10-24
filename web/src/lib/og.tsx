// Open Graph images (brief 9.2), one per version: /learn/og.jpg (kid), /teach/og.jpg (parent), and
// /og.jpg for the home page (the parent one). 1200×630, generated once at build (static export).
// Left 60%: the hero poster (a mom laughing with her adult son and daughter over a salad) under the
// olive scrim, with the version's hero line ("Cook it like Mom does." / "Record it once. They'll cook
// it forever.", the accent in italic on the highlighter, as on the page). Right 40%: canvas with the brand line, and the pot mascot + "homecookd" bottom-right.
// Fraunces is fetched from Google Fonts at build as static TTF subsets (Satori can't read woff2);
// if that fails the image still renders with the built-in sans.
//
// Why a route handler and not app/opengraph-image.tsx: the metadata convention exports an
// extensionless `out/opengraph-image` (a static host serves it as application/octet-stream) and
// Satori only writes PNG (605KB for this photo). The routes re-encode it to a ~100KB JPEG with a
// real extension and content type; the pages point og:image / twitter:image at them.
import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Audience } from '@/content/audience';
import { getCopy } from '@/content/copies';
import { HERO } from '@/content/media';
import { DEFAULT_RELATION, fillPerson } from '@/lib/relation';

const size = { width: 1200, height: 630 };

const C = {
  canvas: '#F7F7F2',
  cream: '#FFFDF7',
  ink: '#1E2410',
  green: '#5B6F00',
  highlighter: '#FFD24D',
  chartreuse: '#D1E043',
  muted: '#5F6352',
};

/** the italic word on the highlighter, as on the page */
const HIGHLIGHT = {
  display: 'flex',
  fontStyle: 'italic',
  color: C.ink,
  background: C.highlighter,
  borderRadius: 10,
  padding: '0 14px 6px 10px',
  marginLeft: -10,
  marginRight: 18,
} as const;

type FontSpec = { name: string; data: ArrayBuffer; weight: 500 | 700; style: 'normal' | 'italic' };

async function loadFraunces(chars: string): Promise<FontSpec[]> {
  const text = Array.from(new Set(chars)).join('');
  // axes in Google's order: ital, opsz, wght, SOFT, WONK
  const tuples = ['0,144,500,100,0', '0,144,700,100,0', '1,144,500,100,1', '1,144,700,100,1'].join(';');
  const url = `https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@${tuples}&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const faces = [...css.matchAll(/font-style:\s*(normal|italic);\s*font-weight:\s*(\d+);[\s\S]*?src:\s*url\(([^)]+)\)/g)];
  const fonts = await Promise.all(
    faces.map(async ([, style, weight, src]) => ({
      name: 'Fraunces',
      data: await (await fetch(src)).arrayBuffer(),
      weight: Number(weight) as 500 | 700,
      style: style as 'normal' | 'italic',
    })),
  );
  return fonts;
}

async function render(audience: Audience): Promise<ImageResponse> {
  const copy = getCopy(audience);
  const HERO_BEFORE = copy.hero.h1Before; // "Cook it like"
  const HERO_REL = copy.hero.relationDefault; // "Mom"
  const HERO_AFTER = copy.hero.h1After; // "does."
  // the parent's fixed H1, one row per line: "Record it once." / "They'll cook it" / "forever."
  const FIXED = copy.hero.h1Fixed ? copy.hero.h1Fixed.split('\n') : null;
  const ACCENT = copy.hero.h1Accent;
  // /teach dropped the "pass down" tagline (FEEDBACK-OCT16 C2), so its card uses the #recipe-box header.
  const parent = audience === 'parent';
  // "Your kids miss your cooking. Let's fix that." / "Too far to cook together? Mom films herself cooking, and you get her homemade recipe."
  const BRAND = fillPerson(parent ? copy.recipeBox.h2 : copy.passDown.h2, DEFAULT_RELATION);
  const BRAND_ACCENT = (parent ? copy.recipeBox.accent : copy.passDown.accent).join(' '); // "Let's fix that." / "homemade recipe."
  const BRAND_LEAD = BRAND.slice(0, BRAND.length - BRAND_ACCENT.length).trim();
  const WORDMARK = copy.nav.logo; // "homecookd"
  const [poster, fonts] = await Promise.all([
    readFile(join(process.cwd(), 'public', HERO.poster)),
    loadFraunces(`${HERO_BEFORE}${HERO_REL}${HERO_AFTER}${copy.hero.h1Fixed}${BRAND}${WORDMARK}`).catch(() => [] as FontSpec[]),
  ]);
  const posterSrc = `data:image/jpeg;base64,${poster.toString('base64')}`;
  const serif = fonts.length ? 'Fraunces' : undefined;

  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%', background: C.canvas }}>
        {/* Left 60%: the family, under the olive scrim */}
        <div style={{ display: 'flex', position: 'relative', width: 720, height: 630, overflow: 'hidden' }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders plain <img> */}
          <img
            src={posterSrc}
            alt=""
            width={1120}
            height={630}
            style={{ position: 'absolute', left: -250, top: 0, width: 1120, height: 630, objectFit: 'cover' }}
          />
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 720,
              height: 630,
              display: 'flex',
              backgroundImage:
                'linear-gradient(to top, rgba(20,22,12,0.86) 0%, rgba(20,22,12,0.62) 30%, rgba(20,22,12,0.18) 58%, rgba(20,22,12,0) 76%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 48,
              right: 32,
              bottom: 44,
              display: 'flex',
              flexDirection: 'column',
              fontFamily: serif,
              fontWeight: 700,
              fontSize: 92,
              lineHeight: 0.98,
              letterSpacing: '-0.03em',
              color: C.cream,
            }}
          >
            {FIXED ? (
              FIXED.map((line, i) =>
                line === ACCENT ? (
                  <div key={i} style={{ display: 'flex', marginTop: 6 }}>
                    <div style={{ ...HIGHLIGHT, marginRight: 0 }}>{line}</div>
                  </div>
                ) : (
                  <div key={i} style={{ display: 'flex' }}>
                    {line}
                  </div>
                ),
              )
            ) : (
              <>
                <div style={{ display: 'flex' }}>{HERO_BEFORE}</div>
                <div style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
                  <div style={HIGHLIGHT}>{HERO_REL}</div>
                  <div style={{ display: 'flex' }}>{HERO_AFTER}</div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right 40%: canvas, brand line, mascot + wordmark */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: 480,
            height: 630,
            padding: '56px 48px 58px 52px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              fontFamily: serif,
              fontWeight: 500,
              fontSize: 50,
              lineHeight: 1.04,
              letterSpacing: '-0.025em',
              color: C.ink,
            }}
          >
            <span style={{ display: 'flex' }}>{BRAND_LEAD}&nbsp;</span>
            <span style={{ display: 'flex', fontStyle: 'italic', color: C.green }}>{BRAND_ACCENT}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
            <svg width="64" height="59" viewBox="0 0 100 92">
              <path d="M38 22c-4-5 4-8 0-13M52 20c-4-5 4-8 0-13M66 22c-4-5 4-8 0-13" fill="none" stroke="#6E5A4C" strokeWidth="3.5" strokeLinecap="round" />
              <path d="M22 44h56v18a20 20 0 0 1-20 20H42a20 20 0 0 1-20-20z" fill="#F6BFA8" stroke="#6E5A4C" strokeWidth="3.5" strokeLinejoin="round" />
              <path d="M22 52h-8M78 52h8" stroke="#6E5A4C" strokeWidth="5" strokeLinecap="round" />
              <ellipse cx="50" cy="42" rx="31" ry="7" fill="#F2A98F" stroke="#6E5A4C" strokeWidth="3.5" />
              <circle cx="50" cy="33" r="4.5" fill="#6E5A4C" />
              <circle cx="40" cy="59" r="3.6" fill="#4A3B30" />
              <circle cx="60" cy="59" r="3.6" fill="#4A3B30" />
              <ellipse cx="33" cy="66" rx="5" ry="3" fill="#FFB8AE" />
              <ellipse cx="67" cy="66" rx="5" ry="3" fill="#FFB8AE" />
              <path d="M45 65q5 5 10 0" fill="none" stroke="#4A3B30" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <div
              style={{
                display: 'flex',
                fontFamily: serif,
                fontWeight: 700,
                fontSize: 60,
                lineHeight: 1,
                letterSpacing: '-0.02em',
                color: C.ink,
                marginBottom: 6,
              }}
            >
              {WORDMARK}
            </div>
          </div>

          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 14, display: 'flex', background: C.chartreuse }} />
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}

/** The version's share image as a JPEG response (each og.jpg route is `force-static`). */
export async function ogJpeg(audience: Audience): Promise<Response> {
  const png = Buffer.from(await (await render(audience)).arrayBuffer());
  const jpg = await sharp(png).flatten({ background: C.canvas }).jpeg({ quality: 82, mozjpeg: true, progressive: true }).toBuffer();
  return new Response(new Uint8Array(jpg), {
    headers: { 'Content-Type': 'image/jpeg' },
  });
}
