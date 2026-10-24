// Share image for /learn (src/lib/og.tsx).
import { ogJpeg } from '@/lib/og';

export const dynamic = 'force-static';

export function GET(): Promise<Response> {
  return ogJpeg('kid');
}
