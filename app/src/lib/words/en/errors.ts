// English words for what the AWS api refuses (1.1), one per error code (ACCOUNTS.md, "Errors"; keys errors.<code>).
// lib/aws/errorWords.ts picks one by the answer's code; a code with no word here falls back to the api's own
// English sentence. Short and kind: the reader is often a grandparent. Translations: ../tr/.
export const ERRORS = {
  // Nothing is wrong with what they did: try again soon.
  'errors.unavailable': 'Can’t reach homecookd right now. Trying again.',
  'errors.network': 'No internet right now. Check your connection.',
  'errors.timeout': 'That took too long. Try again.',
  'errors.rate_limited': 'That’s a lot of tries. Wait a minute, then try again.',
  'errors.server_error': 'Something went wrong on our side. Try again.',
  // Who they are.
  'errors.signed_out': 'This phone was signed out. Sign in again.',
  'errors.forbidden': 'You can’t do that here.',
  'errors.removed_from_family': 'That person isn’t in this family anymore. Pick who you are.',
  'errors.own_phone': 'They use their own phone now.',
  'errors.account_deleted': 'This account was deleted.',
  'errors.not_in_family': 'You’re not in this family anymore.',
  // What they asked for.
  'errors.not_found': 'That isn’t here anymore.',
  'errors.gone': 'This link expired. Ask for a new one.',
  'errors.invalid': 'Something’s missing. Check it and try again.',
  'errors.too_large': 'That’s too big to send.',
  'errors.conflict': 'That changed just now. Try again.',
  'errors.name_taken': 'Someone in the family already has that name. Try another.',
  'errors.idempotency_conflict': 'That was already sent.',
  'errors.not_moved': 'That isn’t ready yet.',
  // Refusals a person can act on.
  'errors.full': 'Every seat is taken.',
  'errors.already_asked': 'You already asked.',
  'errors.answered': 'You already answered.',
  'errors.own_family': 'This is your own family’s.',
  'errors.not_shared': 'Share this recipe first.',
  'errors.declined': 'They said not this time.',
  'errors.closed': 'This one is already answered.',
  'errors.words': 'Some of those words can’t be posted. Try other words.',
};
