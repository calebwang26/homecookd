'use client';
// "Cooking with:" picker (brief 8.0 / 4.4). Owner: B7.
//
//   <RelationPicker />            // desktop: "Cooking with: Grandma ▾" · <768px: "with Grandma ▾"
//                                 // (parent page: "Cooking as: Mom ▾" · "as Mom ▾")
// The short label stays at every width (QA B22): a bare "Mom ▾" read as "logged in as Mom", not a menu.
//
// A real native <select> (so iOS/Android open their own wheel/sheet and screen readers announce
// "Cooking with, Grandma, pop-up button") stretched invisibly over a styled pill that shows the
// current value. Changing it updates every relation-aware string on the page live, stores the
// choice and adds ?for=<relation> to the URL (RelationProvider.setRelation).
// Colors come from the parent's tone: set --picker-fg / --picker-label / --picker-bg / --picker-border
// (Nav does this for its hero and float tones).
import type { ChangeEvent } from 'react';
import { useCopy } from '@/components/providers/CopyProvider';
import { RELATIONS, isRelation } from '@/lib/relation';
import { useRelation } from '@/components/providers/RelationProvider';
import { ChevronDownIcon } from '@/components/icons/Icons';
import s from './RelationPicker.module.css';

export interface RelationPickerProps {
  className?: string;
}

export function RelationPicker({ className }: RelationPickerProps) {
  const copy = useCopy();
  // "with {R}" → "with"
  const SHORT_LABEL = copy.nav.pickerLabelMobile.split('{R}')[0].trim();
  const { relation, label, setRelation } = useRelation();

  const onChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (isRelation(v)) setRelation(v);
  };

  return (
    <div className={[s.picker, className].filter(Boolean).join(' ')}>
      <span className={s.face} aria-hidden="true">
        <span className={s.long}>{copy.nav.pickerLabel}</span>
        <span className={s.short}>{SHORT_LABEL}</span>
        <span className={s.value}>{label}</span>
        <ChevronDownIcon className={s.chev} size={16} stroke={2.2} />
      </span>
      <select className={s.select} aria-label={copy.nav.pickerA11yLabel} value={relation} onChange={onChange}>
        {RELATIONS.map((r) => (
          <option key={r} value={r}>
            {copy.nav.relations[r]}
          </option>
        ))}
      </select>
    </div>
  );
}
