# The Android line stays in English on translated pages (Nov 10, 2026)

Caleb, Nov 10, 2026 (his answer to the morning list, relayed by the Master Agent): "English is fine for now." The
iPhone-only line Android phones see where "Get the app" would be (`IPHONE_ONLY` in `web/src/lib/app-links.ts`, #465)
stays in English on the translated /miss and /a pages.

**Why:** there's no homecookd app for Android yet, so the line is short-lived. One English sentence isn't worth a
translation pass in every language.

**How to apply:** closed, no work. Don't translate the line or flag it as a missing translation. Revisit only if
Caleb asks, or if the line changes when an Android app exists.
