# Resume: App Store, web & builds (paused Oct 30 at 99% weekly usage; reset 12:00 UTC = 5am PT)

## Where the egg rebrand stands (Caleb: local only until iOS approval, no push)
- Web: `claude/brand-egg-web` (worktree `../hc-brand`), 9 commits ending `072ec1542`, plus this note.
  - Done: the kit in `docs/brand/` (tokens hold the final palette); the egg logo and mascot replace the pot on every page; the
    palette (yolk main, dark green second, cream, ink); favicon, manifest and the 3 OG images; docs and the memory note.
  - Checks: build, lint and typecheck pass. The dish e2e passes at 360.
- App native for 1.1: `claude/brand-egg-app` (worktree `../hc-brand-app`), `4126876b5`: icon, splash, adaptive icon and
  app.json colors. Not built.

## Next, after the reset
1. Re-run the dish e2e at 390 (`--width 390`), and re-shoot the 360 screenshots after the nav change (mark alone under
   400px). Look at the 360 shots of /r, /i, /d, /learn, /teach, /privacy, /terms and the 404
   (`scratchpad/brand-shots/`).
2. Decide or ask: the reversed lockup on the hero video has no solid tile (the kit rule). Inline legal links are under 48px
   (left as is).
3. Report to Caleb with screenshots. Hold the push until iOS approves 1.0. Then hand both branches to the Master Agent.
4. 1.1 checklist in the handoff doc: retake screenshots 01–07 after App screens & recording rebrands the app UI (they
   have the kit and the palette); the app icon comes from the 1.1 build.
5. Later: retake the lander media in `web/public/media/app/` after the app UI ships. The internal edible→homecookd
   rename is coordinated by the Master Agent after approval; it'll ping for the web side.
