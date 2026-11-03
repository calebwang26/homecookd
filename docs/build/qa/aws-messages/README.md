# Messages on AWS staging: two phones in the web build (Nov 2, 2026)

Two copies of the app's web build at phone size (375×812), both with `EXPO_PUBLIC_BACKEND=aws` against staging: Leo
(a kid) on `localhost:8083` and Asha (a cook) on `localhost:8082`, a test family from the staging-only test sign-in,
with a ready "Masala chai (test recipe)" of Asha's from `POST /v1/test/recipe`.

1. Leo's home: Asha's Masala chai, from `GET /v1/recipes`.
2. Leo asks about it in a chat with Asha ("Ask about a dish" → Masala chai → Asha): `POST /v1/threads`, then a keyed
   `question` message.
3. Asha's Messages: the "1" badge (`GET /v1/unread`) and Leo's thread on top of the inbox (`GET /v1/threads`).
4. The chat: the question "waiting for you", and the composer "Answering Leo".
5. Her typed answer: **"Saved to the recipe · Undo"**: the reply answered the question and AWS saved it as a recipe
   note in the same write. (The "1 week" next to Leo is the Sunday table, `GET /v1/table`.)
6. Leo's chat, polled (`GET /v1/threads/:id/messages?after=`, every 3 s as today): her answer, "Saved to the recipe".

Both test people were deleted afterwards.
