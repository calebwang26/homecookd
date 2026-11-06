# A family ends with its last signed-in person (Nov 1)

Caleb's two answers (relayed by the Master Agent, "yes" to its recommendations):

1. A family member's phone may delete a phone-less person, but only a phone that already has its own person in that family, and the app warns first. A phone with no person of its own, from an opened invite or a family code, never gets a session.
2. When the last signed-in person deletes or leaves, the family is blanked (name, code, every join link) and the phone-less people left are deleted through the normal deletion, so their rows and files go too.

**Why:** a family of only phone-less faces has nobody who can act for it, and shouldn't outlive the last person who could.

**How to apply:** `api/src/modules/accounts/deletion.ts` (`endFamilyIfLast`) and `docs/build/SCHEMA.md` C2. Caleb chose this over a carve-out for code phones on Nov 1: the switch is off and 1.1 has no codes, so it has no App Review effect.
