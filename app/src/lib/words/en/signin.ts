// English words for sign-in, join links and "Join … instead?" (keys signin.*). Translations: ../tr/.
export const SIGNIN = {
  // Shared by the sign-in screens
  'signin.shared.continue': 'Continue',
  'signin.shared.youreIn': 'You’re in',
  'signin.shared.comeIn': 'Come in',
  'signin.shared.backToStart': 'Back to start',
  'signin.shared.notNow': 'Not now',
  'signin.shared.privacy': 'Privacy policy',
  'signin.shared.opensSite': 'Opens homecookd.app',
  'signin.error.ourSide': 'Something went wrong on our side. Try again in a minute.',
  'signin.terms.line': 'By continuing you agree to our {terms} and {privacy}.',
  'signin.terms.terms': 'Terms of use',

  // The first screen (join.tsx): starting a family, the one way in without a link
  'signin.join.appOnly': 'Sign-in works in the app.',
  'signin.join.title': 'Cook your family’s food.',
  'signin.join.line': 'Start your family’s kitchen. Everyone else joins from your link.',
  'signin.join.gotLink': 'Got a link from your family?',
  'signin.join.tapAgain': 'Tap it again.',
  'signin.name.title': 'What does your family call you?',
  'signin.name.placeholder': 'Mom, Leo, Auntie Lin…',
  'signin.name.label': 'Your name',
  'signin.role.title': 'What do you want to do first?',
  'signin.role.record': 'Record a dish',
  'signin.role.learn': 'Learn a dish',

  // Apple and Google
  'signin.provider.apple': 'Sign in with Apple',
  'signin.provider.google': 'Continue with Google',
  'signin.provider.busy': 'Signing in',

  // A join link's card (components/signin/JoinCard.tsx) and an old code link (i.tsx)
  'signin.joinCard.title': 'Join {family}',
  'signin.joinCard.titleYours': 'Join your family',
  'signin.joinCard.sent': '{name} sent this.',
  'signin.joinCard.ask': 'What do they call you?',
  'signin.joinCard.cook': 'I cook',
  'signin.joinCard.missFood': 'I miss the food',
  'signin.joinCard.roleLabel': 'What you do in the kitchen',
  'signin.joinCard.nameFirst': 'Type your name first.',
  'signin.joinCard.codeTitle': 'Tap the link instead',
  'signin.joinCard.codeLine': 'Codes don’t work anymore. Tap the link your family sent you.',

  // "Join … instead?" (components/signin/MoveCard.tsx)
  'signin.move.title': 'You’re in {from}. Join {to} instead?',
  'signin.move.line': 'Your messages stay with {from}. Nothing moves until you tap.',
  'signin.move.join': 'Join {to}',
  'signin.move.signInApple': 'Sign in with Apple to join {to}.',
  'signin.move.signInGoogle': 'Sign in with Google to join {to}.',

  // A join link or an older invite that doesn't work (i.tsx, components/signin/invite.ts)
  'signin.invite.opening': 'Opening your invite',
  'signin.invite.already': 'You’re already in.',
  'signin.invite.used': 'This invite was already used.',
  'signin.invite.expired': 'This invite expired.',
  'signin.invite.revoked': 'This invite was turned off.',
  'signin.invite.linkExpired': 'This link expired.',
  'signin.invite.linkRevoked': 'This link was turned off.',
  'signin.invite.askFor': 'Ask {name} for a new one.',
  'signin.invite.askFamily': 'Ask your family for a new one.',
  'signin.invite.notFound': 'That invite link doesn’t work.',
  'signin.invite.checkLink': 'Check the link, or ask for a new one.',
  'signin.invite.unreachable': 'We can’t reach homecookd.',
  'signin.invite.checkConnection': 'Check your connection and try again.',
  'signin.invite.ourSide': 'Something went wrong on our side.',
  'signin.invite.trySoon': 'Try again in a minute.',
  'signin.invite.tooMany': 'Too many tries for now.',
  'signin.invite.tryAgain': 'Try again',

  // A dish card's link (/miss, /a: components/signin/ClaimLink.tsx)
  'signin.link.dish': '{name}’s {dish}',
  'signin.link.opening': 'Opening it for you…',
  'signin.link.dead': 'This link doesn’t work anymore.',
  'signin.link.taken': 'This one’s already with {name}.',
  'signin.link.takenSomeone': 'This link already brought someone in.',
  'signin.link.askInvite': 'Ask them for an invite.',
  'signin.link.haveAccount': 'I already have an account',
} as const satisfies Record<`signin.${string}`, string>;
