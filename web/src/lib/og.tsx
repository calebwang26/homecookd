// Open Graph images (brief 9.2), one per version: /learn/og.jpg (kid), /teach/og.jpg (parent), and
// /og.jpg for the home page (the parent one). 1200×630, generated once at build (static export).
// Left 60%: the hero poster (a mom laughing with her adult son and daughter over a salad) under the
// olive scrim, with the version's hero line ("Cook it like Mom does." / "Record it once. They'll cook
// it forever.", the accent in italic on the highlighter, as on the page). Right 40%: cream with the brand line and the kit's lockup bottom-right.
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

// The brand kit's colors (docs/brand/tokens): cream, ink, yolk, yolk-deep.
const C = {
  canvas: '#FBF5EA',
  cream: '#FBF5EA',
  ink: '#1F2430',
  accent: '#A3580C',
  highlighter: '#F6BE75',
  yolk: '#F2A23A',
  muted: '#5B554E',
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

type FontSpec = { name: string; data: ArrayBuffer; weight: 600 | 650; style: 'normal' | 'italic' };

async function loadFraunces(chars: string): Promise<FontSpec[]> {
  const text = Array.from(new Set(chars)).join('');
  // axes in Google's order: ital, opsz, wght, SOFT, WONK
  const tuples = ['0,144,600,100,0', '0,144,650,100,0', '1,144,600,100,1', '1,144,650,100,1'].join(';');
  const url = `https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@${tuples}&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const faces = [...css.matchAll(/font-style:\s*(normal|italic);\s*font-weight:\s*(\d+);[\s\S]*?src:\s*url\(([^)]+)\)/g)];
  const fonts = await Promise.all(
    faces.map(async ([, style, weight, src]) => ({
      name: 'Fraunces',
      data: await (await fetch(src)).arrayBuffer(),
      weight: Number(weight) as 600 | 650,
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
    const [poster, lockup, fonts] = await Promise.all([
    readFile(join(process.cwd(), 'public', HERO.poster)),
    readFile(join(process.cwd(), 'public', 'brand', 'lockup-horizontal.svg')),
    loadFraunces(`${HERO_BEFORE}${HERO_REL}${HERO_AFTER}${copy.hero.h1Fixed}${BRAND}`).catch(() => [] as FontSpec[]),
  ]);
  const posterSrc = `data:image/jpeg;base64,${poster.toString('base64')}`;
  const lockupSrc = `data:image/svg+xml;base64,${lockup.toString('base64')}`;
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
                'linear-gradient(to top, rgba(31,36,48,0.86) 0%, rgba(31,36,48,0.62) 30%, rgba(31,36,48,0.18) 58%, rgba(31,36,48,0) 76%)',
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
              fontWeight: 650,
              fontSize: 92,
              lineHeight: 0.98,
              letterSpacing: '-0.02em',
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
              fontWeight: 600,
              fontSize: 50,
              lineHeight: 1.04,
              letterSpacing: '-0.02em',
              color: C.ink,
            }}
          >
            <span style={{ display: 'flex' }}>{BRAND_LEAD}&nbsp;</span>
            <span style={{ display: 'flex', fontStyle: 'italic', color: C.accent }}>{BRAND_ACCENT}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders plain <img> */}
            <img src={lockupSrc} alt="homecookd" width={340} height={66} />
          </div>

          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 14, display: 'flex', background: C.yolk }} />
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
