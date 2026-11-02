# Accounts on AWS staging: the web build at phone size (Nov 2, 2026)

The app's web build (375×812) with `EXPO_PUBLIC_BACKEND=aws` against staging (https://d2zh46br3dalyf.cloudfront.net), for #287.
Test people from the staging-only test sign-in; everyone made was deleted at the end.

1. "Who's in the kitchen?": Asha (the test cook), Nani and Maya (no phones), all from `GET /family` on AWS.
2. Tapping Nani: her own session (`POST /v1/sessions/start` as her) and `GET /v1/me` (no language yet, so the language screen).
3. Nani's home in Hindi. No AWS route saves a language yet, so the pick stays on the phone, with no "didn't save" note.
4. "Delete my account" for Asha, this phone's own person.
5. After it: `POST /v1/account/delete` answered 200, the phone is signed out. On staging afterwards the old key gets 401, and the
   same test id signs in as someone new, so the account (and Nani, the family's last phone-less person) is gone.

The browser's own calls: `/family` 200, `/v1/sessions/start` 200, `/v1/me` 200, `/v1/account/delete` 200. `/threads` and
`/unread` answer 404: Messages hasn't moved to AWS yet.
