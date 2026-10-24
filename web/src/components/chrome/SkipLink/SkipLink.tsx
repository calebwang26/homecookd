// Owner: B7 (brief 8.0). Working basic version by B0: first focusable element, visible on focus.
import { copy } from '@/content/copy';
import s from './SkipLink.module.css';

export function SkipLink({ href = '#how-it-works', label = copy.nav.skipLink }: { href?: string; label?: string }) {
  return (
    <a className={s.skip} href={href}>
      {label}
    </a>
  );
}
