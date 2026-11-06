-- migrate: no-transaction
-- 079: one open "put it on the map" ask per dish (messages/shareAsks.ts), which Convex's serialized mutation gave. Open is until homie has read her answer.
-- Two kids asking at once write one question. Built without blocking writes, since staging's questions has rows; a failed build leaves an INVALID index to drop first.
create unique index concurrently if not exists questions_one_open_share on questions (recipe_id) where kind = 'share' and share_said is null;
