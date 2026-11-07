# 1.1 listing screens, unframed (Nov 6, 2026)

The seven screens [LISTING-1.1.md](../../../LISTING-1.1.md) lists, for App Store, web & builds to caption and frame into
`docs/app-store/screenshots/1.1/`. Each is 1320 × 2868 (6.9"), from the app's web build of main `b80aff8b2` (the code in
build 12) at 440 × 956 and 3×, as 1.0's seven were. The AWS switch was on, against **AWS staging**. Production's TEST family
isn't seeded yet (CUTOVER step 7 is Caleb's), so nothing here touched production.

The people were made with staging's test sign-in: Leo (a kid), Mei (his mom, joined from Leo's card) and Auntie Bumbi (a
cook on her own). Leo's card was made the way the web makes one. All three were deleted afterwards.

| File | Caption | What's on it |
|---|---|---|
| `01-cook-it-their-way.png` | Cook it the way they make it | Auntie Bumbi's own Chicken Biryani: "Watch yourself · 17 min" and her quote |
| `02-your-kids-ask.png` | Your kids ask. You answer. | Mei's Home: "Leo wants your tomato egg", Answer Leo |
| `03-tell-them-how.png` | Tell them how, out loud | The request: Leo's guess, "Film it next time you make it", "Tell Leo how you make it now" |
| `04-just-cook.png` | Just cook. We write it down. | Record: "What will you teach today?", the three tips, Start recording |
| `05-a-real-amount.png` | "A handful" becomes a real amount | The biryani's ingredients with ~ amounts |
| `06-hear-it-in-their-voice.png` | Hear it in their voice | Leo's card after Mei answered: her quote, "Hear Mom · 0:38" |
| `07-send-home-a-photo.png` | Send home a photo | Mei's chat with Leo: "Leo made your Sunday chili" with his photo |

Things to know before they go to Apple:

- **01 and 05 are the bundled Chicken Biryani**, which the app credits as "Video: Auntie Bumbi (YouTube)". It's the same
  dish 1.0's first screenshot used, but its frame is a creator's video, not ours.
- **05 shows the ~ amounts, not the cook's own words.** The recipe overview lists "~2 tbsp chopped ginger", not "a
  handful". The caption still fits; the table in LISTING-1.1.md says "the cook's words with ~ estimates beside them".
- **03 and 06 come from staging's fake models.** The guess is the canned tomato egg, which includes "~1 scallions,
  sliced". Mei's line is the fake transcription, "Two big spoons of ketchup.", and her version leaves every
  ingredient marked "guess". Real models would mark the amounts she said as hers.
- **02 and 06:** Leo sent no photo, so the card shows the dish's name on white.
- **07's photo** is the bundled Sunday Chili poster, the same photo 1.0's sixth screenshot used.
- **There's no status bar** (it's the web build), and nothing else from the browser shows.

How they were made: `listing-seed.mjs` (a staging-only seed) and `listing-shot.mjs` (Playwright, signed in by
the device key as [AWS-PROOFS.md](../../../../build/qa/AWS-PROOFS.md) section 3 says). Both were scratch scripts and
aren't kept.
