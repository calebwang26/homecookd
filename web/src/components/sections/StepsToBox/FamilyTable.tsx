'use client';
// The family table, parent version (/teach, FEEDBACK-OCT16b 3). Id: #recipe-box.
//
// Its own screen after the app demo (SeeItWork), and deliberately unlike How it works above it: a
// full-bleed forest sheet laid over the green demo, the H2 centred in cream ("Let's fix that." in
// chartreuse), and the family table (FolderGrid) centred under it as one long table: six dishes in a
// row on wide screens, 3 × 2 on tablets and small laptops, 2 columns on phones.
//
// Motion: the H2 and the folder fade up once as they enter (Reveal; final state with reduced motion
// or no JS). The folder's tabs stay interactive. "+ Add a recipe" goes forward to #early-access (the
// demo is above this section on /teach).
import type { CSSProperties } from 'react';
import { useCopy } from '@/components/providers/CopyProvider';
import { useRelation } from '@/components/providers/RelationProvider';
import { Reveal } from '@/components/motion/Reveal';
import { SWIRLS } from '@/content/media';
import { DEFAULT_RELATION, fillPerson } from '@/lib/relation';
import { FolderGrid } from './FolderGrid';
import s from './FamilyTable.module.css';

const SWIRL = { ['--swirl' as string]: `url(${SWIRLS.forest})` } as CSSProperties;

export function FamilyTable() {
  const BOX = useCopy().recipeBox;
  const { relation, explicit } = useRelation();
  // {kids} → "grandkids" once Grandma or Grandpa is picked
  const h2 = fillPerson(BOX.h2, explicit ? relation : DEFAULT_RELATION);
  const accent = BOX.accent.join(' ');
  const i = h2.lastIndexOf(accent);
  const lead = i < 0 ? h2 : h2.slice(0, i).trimEnd();

  return (
    <section id="recipe-box" className={s.section} style={SWIRL} aria-labelledby="recipe-box-h2">
      <Reveal y={20} zoomImages={false}>
        <h2 id="recipe-box-h2" className={['t-h2', s.h2].join(' ')}>
          {lead}
          {i < 0 ? null : (
            <>
              {' '}
              <em className={s.accent}>{accent}</em>
            </>
          )}
        </h2>
      </Reveal>
      <Reveal y={24} delay={0.08} zoomImages={false} className={s.folderWrap}>
        <FolderGrid labelledBy="recipe-box-h2" addHref="#early-access" className={s.folder} />
      </Reveal>
    </section>
  );
}
