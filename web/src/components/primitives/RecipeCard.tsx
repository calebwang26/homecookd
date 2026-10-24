// The recipe card: a7's floating cards, turned into family recipes (brief 5 "RecipeCard"). Server-safe.
//
//   <RecipeCard recipe={getRecipe('nonna-lasagna')} style={{ width: '16vw' }} />
//   <RecipeCard recipe={r} face="cook" garnish={{ steam: true }} imageSizes="16vw" />
//   <RecipeCard recipe={front} media={<div className={s.videoSlot} />} garnish={{ rec: 'Recording · 0:42', watch: true }} />
//   <RecipeCard recipe={r} decorative={false} showEstimate titleAs="h3" />          // real list item (FolderGrid)
//
// 4:5 tinted panel (radius 24, 8px inset); the photo (radius 18) fills the top 66%; below it the
// title "{cook}'s {dish}" and "by {cook} · {time}". The cook's words sit on a lemon pill at the
// photo's bottom-left (with the ~estimate under them when showEstimate). The card is an inline-size
// container: ≥220px everything shows; 140–219px the feel pill and the time hide; <140px only the
// photo plus a cook tag. Size it from the outside (width); the height follows the 4:5 ratio unless
// you pass `ratio`.
//
// Garnish elements carry data-garnish="watch|rec|saved|sticker|steam|feel" so scenes can animate them.
// The photo box is exported as cardPhotoRect() for the hero's video clip-path math.
import type { CSSProperties, ElementType, ReactNode } from 'react';
import type { Recipe, Tint } from '@/content/types';
import { HeartIcon, PlayIcon } from '@/components/icons/Icons';
import { Img } from './Img';
import { Steam } from './Steam';
import { Sticker } from './Sticker';
import styles from './RecipeCard.module.css';

export interface RecipeCardGarnish {
  /** "▶ Watch" pill on the photo */
  watch?: boolean;
  /** recording pill text, e.g. "Recording · 0:42" or "REC 0:42" (red dot added) */
  rec?: string;
  /** a small scalloped sticker on the top-right corner; "That's / it." splits on " / " */
  sticker?: string;
  steam?: boolean;
  saved?: boolean;
}

export interface RecipeCardProps {
  recipe: Recipe;
  face?: 'dish' | 'cook';
  /** replaces the photo (e.g. an empty slot the hero video window lines up with) */
  media?: ReactNode;
  garnish?: RecipeCardGarnish;
  showEstimate?: boolean;
  tint?: Tint;
  /** decorative cards are aria-hidden with alt="" (default) */
  decorative?: boolean;
  /** next/image sizes hint for the photo */
  imageSizes?: string;
  /** width / height (default 4 / 5); 'auto' lets the content set the height */
  ratio?: number | 'auto';
  /** heading element for the title when not decorative */
  titleAs?: ElementType;
  /** preload the image (the 7 hero fan images only) */
  preload?: boolean;
  /** hide the feel pill regardless of size */
  hideFeel?: boolean;
  className?: string;
  style?: CSSProperties;
  as?: ElementType;
}

const BOLD: Tint[] = ['green', 'forest', 'sun', 'chartreuse'];

export const CARD_INSET_PX = 8;
export const CARD_PHOTO_FRACTION = 0.66;

/** The photo box inside a card of width w (px) and height h (px), relative to the card's top-left. */
export function cardPhotoRect(w: number, h = (w * 5) / 4): { x: number; y: number; width: number; height: number; radius: number } {
  const inset = Math.min(CARD_INSET_PX, w * 0.035);
  return {
    x: inset,
    y: inset,
    width: w - 2 * inset,
    height: h * CARD_PHOTO_FRACTION - inset,
    radius: Math.min(18, w * 0.075),
  };
}

export const possessive = (r: Recipe) => `${r.cook}'s ${r.dish}`;

export function RecipeCard({
  recipe,
  face = 'dish',
  media,
  garnish,
  showEstimate = false,
  tint,
  decorative = true,
  imageSizes = '(min-width: 1024px) 16vw, 34vw',
  ratio = 4 / 5,
  titleAs,
  preload = false,
  hideFeel = false,
  className,
  style,
  as: Tag = 'article',
}: RecipeCardProps) {
  const t = tint ?? recipe.tint;
  const photo = face === 'cook' && recipe.cookPhoto ? recipe.cookPhoto : { src: recipe.image, alt: recipe.imageAlt };
  const Title = decorative ? 'p' : (titleAs ?? 'h3');
  const stickerLines = garnish?.sticker?.split(' / ') ?? [];

  return (
    <Tag
      className={[styles.card, BOLD.includes(t) ? styles.bold : '', ratio === 'auto' ? styles.auto : '', className].filter(Boolean).join(' ')}
      style={{
        ['--tint-bg' as string]: `var(--tint-${t}-bg)`,
        ['--tint-ink' as string]: `var(--tint-${t}-ink)`,
        aspectRatio: ratio === 'auto' ? undefined : String(ratio),
        ...style,
      }}
      data-tint={t}
      data-recipe={recipe.id}
      aria-hidden={decorative ? true : undefined}
    >
      <div className={styles.panel}>
        <div className={styles.photo} data-card-photo="">
          {media ?? (
            <Img
              src={photo.src}
              alt={decorative ? '' : photo.alt}
              fill
              sizes={imageSizes}
              preload={preload}
              className={styles.img}
            />
          )}

          {garnish?.steam ? (
            <span className={styles.steam} data-garnish="steam">
              <Steam size={56} />
            </span>
          ) : null}

          {garnish?.rec || garnish?.watch ? (
            <span className={styles.topLeft}>
              {garnish.rec ? (
                <span className={[styles.pill, styles.rec].join(' ')} data-garnish="rec">
                  <span className={styles.recDot} aria-hidden="true" />
                  {garnish.rec}
                </span>
              ) : null}
              {garnish.watch ? (
                <span className={[styles.pill, styles.watch, garnish.rec ? styles.stacked : ''].join(' ')} data-garnish="watch">
                  <PlayIcon size="0.95em" /> Watch
                </span>
              ) : null}
            </span>
          ) : null}

          {garnish?.saved ? (
            <span className={[styles.pill, styles.watch, styles.topRight].join(' ')} data-garnish="saved">
              <HeartIcon size="0.9em" style={{ color: 'var(--tomato)' }} /> Saved
            </span>
          ) : null}

          {!hideFeel ? (
            <span className={styles.feel} data-garnish="feel">
              {recipe.feelOriginal ? (
                <span className={styles.feelOriginal} lang={recipe.feelOriginal.lang}>
                  “{recipe.feelOriginal.text}”
                </span>
              ) : null}
              <span className={styles.feelQuote}>{recipe.feelOriginal ? recipe.feelQuote : `“${recipe.feelQuote}”`}</span>
              {showEstimate ? <span className={styles.estimate}>{recipe.estimate}</span> : null}
            </span>
          ) : null}

          <span className={styles.tag} data-garnish="tag">
            {recipe.cook}
          </span>
        </div>

        <div className={styles.body}>
          <Title className={styles.title}>{possessive(recipe)}</Title>
          <p className={styles.meta}>
            <span>by {recipe.cook}</span>
            <span className={styles.time}> · {recipe.time}</span>
          </p>
        </div>
      </div>

      {stickerLines.length ? (
        <span className={styles.sticker} data-garnish="sticker">
          <Sticker lines={stickerLines} tone="creamOnSun" size={96} rotate={10} decorative={decorative} style={{ width: '100%', height: '100%', ['--st-min' as string]: '0px' }} />
        </span>
      ) : null}
    </Tag>
  );
}
