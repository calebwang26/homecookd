# /miss stays out of the app-links file (Nov 10, 2026)

Caleb, Nov 10, 2026 (his answer to the morning list, relayed by the Master Agent): "I want to make sure all users,
including ones on 1.0, can use the link." So `/miss` stays out of `apple-app-site-association`. A kid's /miss link
keeps opening on the website for everyone, and the branch that adds /miss to the file stays held.

**Why:** 1.0 phones (build 6) can't open /miss in the app. With /miss in the file, iOS would hand the link to any
installed homecookd, and on 1.0 it would land nowhere. The website works on every phone.

**How to apply:** don't add `/miss` (or `/miss/*`) to the association file while 1.0 phones are still around. The
held branch stays held until Caleb says 1.0 is gone or every app that would receive the link can open it. A link that
opens the app from /miss goes through the page's own "Open homecookd" button, never the association file.
