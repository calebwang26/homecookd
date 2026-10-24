// On-demand Noto subsets for the six non-Latin translation lines (brief 8.8 "Fonts").
// Usage (InTheirWords): useEffect(() => { if (nearViewport) loadTranslationFonts(lines.map(l => l.original)); }, [nearViewport]);
// Then use font-family: var(--ff-cjk-sc) / var(--ff-cjk-kr) / var(--ff-deva) for those lines.

let injected = false;

export function loadTranslationFonts(lines: string[]): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const chars = Array.from(new Set(lines.join('').replace(/[\x00-\x7F]/g, '').split(''))).join('');
  const href =
    'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@500&family=Noto+Serif+KR:wght@500' +
    `&family=Noto+Serif+Devanagari:wght@500&display=swap&text=${encodeURIComponent(chars)}`;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
  const root = document.documentElement.style;
  root.setProperty('--ff-cjk-sc', "'Noto Serif SC', 'Songti SC', serif");
  root.setProperty('--ff-cjk-kr', "'Noto Serif KR', 'AppleMyungjo', serif");
  root.setProperty('--ff-deva', "'Noto Serif Devanagari', 'Kohinoor Devanagari', serif");
}
