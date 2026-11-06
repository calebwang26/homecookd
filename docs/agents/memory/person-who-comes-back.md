# Someone who left or moved and came back (Nov 1)

Caleb's decision: link them to their old rows. Built for someone who left or moved: the new row points at the old one, and deleting the new person deletes the old row too. The link gives no access. A deleted person who returns stays a new person (the Master Agent's reading, put to Caleb, who can override).

**Why:** what someone left behind shouldn't outlive their deletion just because they rejoined. Keeping an identifier after deletion would contradict `/privacy`'s "deleted", and the purge leaves almost nothing to link to.

**How to apply:** `people.previous_person_id` and `left_identities` (a keyed hash, never the subject), read only by `api/src/modules/accounts/deletion.ts`. Don't use the link to grant access. Linking a deleted person needs a lawyer's read of `/privacy` first.
