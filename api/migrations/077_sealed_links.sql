-- 077: craving links, dinner invites and share links are stored as join links are (SCHEMA.md, M6), so a copy of the database alone can't open one. Each keeps a
-- hash to look its token up by, and the token sealed, so its owner is shown the same link again (api/src/sealed.ts). The readable columns go in this same file.
-- That breaks "safe while the previous release is still running" for these three routes: a task still on the old code fails on them until the rollout ends.
-- Nothing live calls the api yet and no real row has been copied (SCHEMA.md, section 7), so that's staging for a minute. SQL can't seal: the key isn't in the database.

-- A craving link's token is 22 characters, so plain sha256. Old rows still open by their hash; their sealed token stays null, so her next "Share" makes a new link.
alter table craving_links add column token_hash hex_digest unique, add column token_enc text;
update craving_links set token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex');
alter table craving_links alter column token_hash set not null;
alter table craving_links drop column token;

-- A dinner's invite token is 32 random bytes: the same. An old dinner's next invite link replaces its token.
alter table dinners add column invite_token_hash hex_digest unique, add column invite_token_enc text;
update dinners set invite_token_hash = encode(sha256(convert_to(invite_token, 'UTF8')), 'hex') where invite_token is not null;
alter table dinners drop column invite_token;

-- A share link's token is the old apps' 10 characters, so its hash is keyed, and SQL can't make one. Rows from before this go, and so do the old tokens that
-- signups logged for joins through them: they're made-up rows on staging, and the next share makes a new link. An id becomes the primary key, so signups logs a
-- join through a share as 'share:<id>', never the token.
delete from shares;
update signups set share_token = null where share_token ~ '^[0-9A-Za-z]{10}$';
alter table shares drop column token;
alter table shares add column id text primary key default gen_random_uuid()::text;
alter table shares add column token_hash hex_digest not null unique;
alter table shares add column token_enc text not null;
