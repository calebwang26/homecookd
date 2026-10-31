// A family member's face: the seeded demo family's photos (same files as app/assets/avatars), else
// the bible's initial tile (lime-wash #DCEBE2, olive ink, Fraunces 600). Never invent a face: a
// person (a sender, an inviter) passes their `avatar_key`, and null means no photo, whatever their
// name. Only a recipe's cook with no key at all (undefined) is matched by name to the demo cooks.
import dad from './avatars/dad.jpg';
import grandma from './avatars/grandma.jpg';
import leo from './avatars/leo.jpg';
import mom from './avatars/mom.jpg';

const PHOTOS: Record<string, string> = { dad: dad.src, grandma: grandma.src, leo: leo.src, mom: mom.src };

export function avatarSrc(key: string | null | undefined, name?: string | null): string | null {
  if (key === null) return null;
  const k = (key ?? name ?? '').trim().toLowerCase();
  return PHOTOS[k] ?? null;
}

export function Avatar({ name, avatarKey, size }: { name: string; avatarKey?: string | null; size: number }) {
  const src = avatarSrc(avatarKey, name);
  const base = { width: size, height: size, borderRadius: '50%', flex: 'none' as const };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} style={{ ...base, objectFit: 'cover', display: 'block' }} />;
  }
  return (
    <span
      aria-hidden="true"
      style={{
        ...base,
        background: '#DCEBE2',
        color: '#244A39',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--ff-display)',
        fontWeight: 600,
        fontSize: Math.round(size * 0.44),
        lineHeight: 1,
      }}
    >
      {(name.trim()[0] || '?').toUpperCase()}
    </span>
  );
}
