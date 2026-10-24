// Every family: the floating recipe cloud (brief 8.7, a7 M15). Owner: B4.
//
// Canvas breather between the green See-it-work block and the sun In-their-words block. Two wavy
// rows of recipe tiles from many families drift in opposite directions around a centered pot
// mascot, the heading ("A few minutes a day with *Mom*.", the italic word cycling) and a
// short body, one sentence per line. Everything moving is decorative; the hidden list carries the same recipes.
import { useAudience, useCopy } from '@/components/providers/CopyProvider';
import { possessive } from '@/components/primitives/RecipeCard';
import { PotMascot } from '@/components/primitives/PotMascot';
import { Reveal } from '@/components/motion/Reveal';
import { WordReveal } from '@/components/motion/WordReveal';
import { PauseButton } from '@/components/providers/PauseProvider';
import { Cloud } from './Cloud';
import { CycleHeading } from './CycleHeading';
import { CLOUD_RECIPES } from './cloudData';
import s from './EveryFamily.module.css';

export function EveryFamily() {
  const c = useCopy().everyFamily;
  // The parent version (FEEDBACK-OCT16 C2): no body, and the tiles stand still (they still fade up
  // once, and lift with their bubble on hover). Its heading cycles like the kid's (Caleb, Oct 17).
  const parent = useAudience() === 'parent';
  // One sentence per line from 768 up, so the break never strands a word or two ("passed down.");
  // phones let the lines flow back together (EveryFamily.module.css).
  const BODY = c.body.replace(/([.!?])\s+(?=\S)/g, '$1\n');
  return (
    <section id="every-family" className={s.section} aria-labelledby="every-family-h2" data-still={parent ? '' : undefined}>
      <div className={s.center}>
        <Reveal y={14} className={s.mascot}>
          <PotMascot size={44} />
        </Reveal>
        {/* both versions: the cycling word alone on line 2, so its width never reflows line 1 */}
        <CycleHeading id="every-family-h2" />
        {BODY ? <WordReveal as="p" className={['t-lead', s.body].join(' ')} text={BODY} stagger={0.02} delay={0.35} /> : null}
        <div className="sr-only">
          <p>{c.listLabel}</p>
          <ul>
            {CLOUD_RECIPES.map((r) => (
              <li key={r.id}>
                {possessive(r)}: “{r.feelQuote}”
              </li>
            ))}
          </ul>
        </div>
      </div>

      <Cloud still={parent} />

      {/* the heading's word cycles in both versions (the parent's tiles stand still) */}
      <div className={s.pause}>
        <PauseButton variant="ink" labels={{ pause: c.pause, play: c.play }} />
      </div>
    </section>
  );
}
