# Kids' asks on AWS staging: the cook's side in the web build (Nov 3, 2026)

How to run these proofs again: [../AWS-PROOFS.md](../AWS-PROOFS.md).

The app's web build (375×812) with `EXPO_PUBLIC_BACKEND=aws` against staging. A card made as the website makes it
(`POST /dish/cards`, "tomato egg", sent), claimed by a test kid (Leo) with `POST /v1/links/claim`, and Mom (Asha)
joined from her link's ticket and claimed the cook side.

1. Mom's Home: "Leo wants your tomato egg · Answer Leo", from `GET /v1/cravings`.
2. The request: Leo's guess for the dish.
3. "Film it next time": the day and time sheet. **The web build can't save her day from here:** reminders are
   phone-only, so on the web the sheet stops before sending the day (`ReminderSheet.tsx`). Her `filmingDay` is proven
   by `aws-dish-flows` instead (`POST /v1/cravings/:id/filming-day`, read back as 0).
4. "Making it now" goes to Record with "Leo asked for tomato egg" and `?ask=<the card's id>`, found by
   `useCravingAsk`. That id now goes on the job as `dishAskId`, so Leo gets `filmed` when the recipe is ready.

Her voice recipe, its merge to `ready`, and a job with `dishAskId` publishing are proven by `aws-dish-flows`. Both test
people were deleted.
