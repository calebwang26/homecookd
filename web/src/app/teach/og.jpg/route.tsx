// Share image for /teach (src/lib/og.tsx).
import { ogJpeg } from '@/lib/og';

export const dynamic = 'force-static';

export function GET(): Promise<Response> {
  return ogJpeg('parent');
}
