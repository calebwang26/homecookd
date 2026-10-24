// Photo and video credits (brief 6.5), imported from public/media/stock/credits.json (asset team).
// Rendered in the footer's "Photo credits" disclosure. Every file is under the Pexels License.
import raw from '../../public/media/stock/credits.json';

export interface Credit {
  file: string;
  title: string;
  author: string;
  source: string;
  license: string;
  url: string;
}

interface RawCredit {
  file: string;
  role?: string;
  title: string;
  author: string;
  source_url: string;
  license: string;
}

export const CREDITS: Credit[] = (raw as RawCredit[]).map((c) => ({
  file: c.file,
  title: c.title,
  author: c.author,
  source: 'Pexels',
  license: c.license.split(' (')[0].split(' http')[0],
  url: c.source_url.split(' ; ')[0].trim(),
}));

/** One line per author (several files share an author), for a compact credits list. */
export const CREDIT_AUTHORS: { author: string; url: string; files: string[] }[] = Object.values(
  CREDITS.reduce<Record<string, { author: string; url: string; files: string[] }>>((acc, c) => {
    (acc[c.author] ??= { author: c.author, url: c.url, files: [] }).files.push(c.file);
    return acc;
  }, {}),
);
