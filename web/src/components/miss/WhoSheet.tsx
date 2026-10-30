'use client';
// "Ask someone": a card made for no one in particular needs a person before it can be asked (DISH-ASK-SPEC §10).
// Picking one sends cards/update {relation}, which turns asking on and writes the message, then the Ask sheet opens.
import { useId, useState } from 'react';
import { Sheet } from '@/components/dish/parts';
import { useLang, useRel } from '@/components/dish/lang';
import { updateCard } from '@/lib/dish/api';
import { RELATIONS } from '@/lib/relation';
import type { Card, Relation } from '@/lib/dish/types';
import ui from '@/components/dish/ui.module.css';
import s from './ask.module.css';

type Props = { open: boolean; onClose: () => void; token: string; onPicked: (card: Card) => void; toast: (m: string, tone?: 'success' | 'error') => void };

export function WhoSheet({ open, onClose, token, onPicked, toast }: Props) {
  const { t } = useLang();
  const rel = useRel();
  const id = useId();
  const [busy, setBusy] = useState<Relation | null>(null);

  const pick = async (relation: Relation) => {
    if (busy) return;
    setBusy(relation);
    try {
      onPicked(await updateCard(token, { relation }));
    } catch {
      toast(t('share.failed'), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} labelledBy={id}>
      <h2 id={id} className={s.title}>
        {t('who.title')}
      </h2>
      <div className={s.whoGrid}>
        {RELATIONS.map((r) => (
          <button key={r} type="button" className={`${ui.press} ${s.whoChip}`} disabled={!!busy} aria-busy={busy === r} onClick={() => void pick(r)}>
            {rel(r)}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
