// Static, CSS-positioned deck (brief 5 "CardFan"). Server-safe. It is the SSR / reduced-motion
// layout AND the initial pose a GSAP scene can take over (every card is a direct child
// [data-deck-card] with --x/--y/--r/--s set from src/lib/deck/layouts.ts).
//
//   <CardFan recipes={FAN.map(getRecipe)} mobileRecipes={FAN_MOBILE.map(getRecipe)} layout="fan"
//            faces={{ 'dad-chili': 'cook', 'dziadek-pierogi': 'cook' }} />
//   <CardFan recipes={FAN.map(getRecipe)} layout="stack" />
//   <CardFan recipes={stepRecipes} layout="stairs" renderCard={(r, i) => <MyStepCard … />} />
//
// Geometry is in viewport units and centered in the block: desktop fan cards are 16vw (mobile 34vw,
// the mobile list only), with the a7 smile arc, −8° → +6°, the front (last) card on top, and a soft
// floor shadow under the fan.
import type { CSSProperties, ReactNode } from 'react';
import type { Recipe } from '@/content/types';
import { css, fan, poseVars, relativeTo, stack, stairs, type Pose } from '@/lib/deck/layouts';
import { RecipeCard, type RecipeCardProps } from '@/components/primitives/RecipeCard';
import styles from './CardFan.module.css';

export interface CardFanProps {
  recipes: Recipe[];
  layout?: 'fan' | 'stack' | 'stairs';
  /** cards shown below 768px (fan: 5 cards at 34vw). Defaults to `recipes`. */
  mobileRecipes?: Recipe[];
  /** force the mobile geometry at every width */
  mobile?: boolean;
  /** per-recipe face overrides (e.g. two men cooking in the first deck) */
  faces?: Record<string, 'dish' | 'cook'>;
  /** extra props for every RecipeCard, or a function per card */
  cardProps?: Partial<RecipeCardProps> | ((r: Recipe, i: number) => Partial<RecipeCardProps>);
  /** replace the card renderer entirely */
  renderCard?: (r: Recipe, i: number) => ReactNode;
  /** show the soft floor shadow (fan) */
  floor?: boolean;
  className?: string;
  style?: CSSProperties;
  /** preload the card images (hero fan only) */
  preload?: boolean;
}

function poseFor(layout: CardFanProps['layout'], i: number, n: number, mobile: boolean): Pose {
  if (layout === 'stack') {
    const p = stack(i, n, { w: mobile ? 46 : 19 });
    return relativeTo(p, { x: { vw: 50 }, y: { vh: 60 } });
  }
  if (layout === 'stairs') {
    // relative to the middle card so the stair stays centered in the block
    const mid = stairs(Math.floor((n - 1) / 2));
    const p = stairs(i);
    return { ...relativeTo(p, { x: mid.x, y: mid.y }), w: p.w };
  }
  const p = fan(i, n, { mobile });
  return relativeTo(p, mobile ? { x: { vw: 50 }, y: { vh: 56 } } : { x: { vw: 50 }, y: { vh: 60 } });
}

export function CardFan({
  recipes,
  layout = 'fan',
  mobileRecipes,
  mobile = false,
  faces,
  cardProps,
  renderCard,
  floor = layout === 'fan',
  className,
  style,
  preload = false,
}: CardFanProps) {
  const desk = recipes;
  const mob = mobileRecipes ?? recipes;
  const all = Array.from(new Set([...desk, ...mob]));
  // keep desktop order; mobile-only cards (rare) go last
  const ordered = [...desk, ...all.filter((r) => !desk.includes(r))];

  return (
    <div className={[styles.fan, styles[layout], mobile ? styles.forceMobile : '', className].filter(Boolean).join(' ')} style={style} data-deck="">
      {floor ? <span className={styles.floor} aria-hidden="true" /> : null}
      {ordered.map((r) => {
        const di = desk.indexOf(r);
        const mi = mob.indexOf(r);
        const dPose = di >= 0 ? poseFor(layout, di, desk.length, mobile) : null;
        const mPose = mi >= 0 ? poseFor(layout, mi, mob.length, true) : null;
        const vars: Record<string, string | number> = {
          ...(dPose ? poseVars(dPose) : {}),
          ...(mPose ? poseVars(mPose, 'm') : {}),
          '--w': dPose?.w !== undefined ? `${dPose.w}vw` : '16vw',
          '--mw': mPose?.w !== undefined ? `${mPose.w}vw` : '34vw',
          ...(dPose?.h ? { '--h': css(dPose.h) } : {}),
        };
        const extra = typeof cardProps === 'function' ? cardProps(r, di >= 0 ? di : mi) : cardProps;
        return (
          <div
            key={r.id}
            className={styles.slot}
            style={vars as CSSProperties}
            data-deck-card={r.id}
            data-desktop={di >= 0 ? '' : undefined}
            data-mobile={mi >= 0 ? '' : undefined}
          >
            {renderCard ? (
              renderCard(r, di >= 0 ? di : mi)
            ) : (
              <RecipeCard
                recipe={r}
                face={faces?.[r.id] ?? 'dish'}
                imageSizes={layout === 'stack' ? '(min-width: 1024px) 19vw, 46vw' : '(min-width: 1024px) 16vw, 34vw'}
                preload={preload}
                {...extra}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
