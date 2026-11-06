// English words for the share sheet: sending a recipe or an invite (keys share.*). Translations: ../tr/.
// What goes out to someone else (the message with the link, the share sheet's title and an email's subject)
// stays English on purpose (components/share/shareLink.ts shareText): it isn't here.
export const SHARE = {
  // The recipe share sheet (components/share/ShareSheet.tsx, lib/share.tsx).
  'share.sheet.label': 'Share {title}',
  'share.sheet.labelNoTitle': 'Share this recipe',
  'share.sheet.notFound': 'We couldn’t find this recipe',
  'share.sheet.didntReach': 'That didn’t reach {name}. Try again.',
  'share.sheet.didntOpen': 'Sharing didn’t open',
  'share.sheet.closeAndRetry': 'Close this and try again.',
  'share.sheet.didntOpenToast': 'Sharing didn’t open. Try again.',

  // The family faces row (FamilyRow); "Sent to Leo" is also the toast above it.
  'share.family.label': 'Send to family',
  'share.family.sendTo': 'Send to {name}',
  'share.family.sendingTo': 'Sending to {name}',
  'share.family.sentTo': 'Sent to {name}',

  // Under a face once it went (RoundTarget).
  'share.target.sent': 'Sent',

  // The app row (ExternalRow): Copy link, Messages, Instagram, WhatsApp, More.
  'share.app.label': 'Send outside homecookd',
  'share.app.copy': 'Copy link',
  'share.app.messages': 'Messages',
  'share.app.messagesA11y': 'Send in Messages',
  'share.app.instagram': 'Instagram',
  'share.app.instagramA11y': 'Send on Instagram',
  'share.app.instagramHint': 'Copies the link and opens Instagram',
  'share.app.whatsapp': 'WhatsApp',
  'share.app.whatsappA11y': 'Send on WhatsApp',
  'share.app.more': 'More',
  'share.app.moreA11y': 'More ways to share',
  'share.app.noLink': 'Couldn’t make a link. Check your connection and try again.',
  'share.app.noCopy': 'That didn’t copy. Tap More to share it.',
  'share.app.copied': 'Copied',
  'share.app.linkCopied': 'Link copied',
  'share.app.pasteInText': 'Link copied. Paste it in a text.',
  'share.app.pasteInInstagram': 'Link copied. Paste it in Instagram.',
  'share.app.openInstagram': 'Open Instagram and paste the link.',
  'share.app.pasteInWhatsApp': 'Link copied. Paste it in WhatsApp.',
  'share.app.sent': 'Sent',

  // The recipe card at the top (ShareCard).
  'share.card.by': 'by {name}',
  'share.card.a11y': '{title}, on homecookd',
  'share.card.a11yFrom': '{title}, from {name}, on homecookd',
  'share.card.a11yByline': '{title}, {byline}, on homecookd',
  'share.card.a11yLoading': 'Recipe card',

  // The card colours under it (SwatchRow, swatches.ts).
  'share.swatch.label': 'Card colour',
  'share.swatch.peach': 'Peach card',
  'share.swatch.sage': 'Sage card',
  'share.swatch.ink': 'Ink card',

  // The family invite card (InviteCard). {family} is the family's name, as they wrote it.
  'share.invite.title': 'Join {family} on homecookd',
  'share.invite.titleNoName': 'Join our family table on homecookd',
  'share.invite.a11yNames': '{title} {names}.',
  'share.invite.a11yNamesMore': '{title} {names} and {count} more.',
  // The cook's "Share with people nearby" switch at the foot of her recipe (components/community/ShareNearbyRow).
  'share.nearby.label': 'Share with people nearby',
  'share.nearby.on': 'On',
  'share.nearby.off': 'Off',
  'share.nearby.offMap': 'Off the map',
  'share.nearby.offMapA11y': 'Off the map. {why}',
  'share.nearby.whatNeighborsSee': 'Neighbors see the recipe text, one line you said and an AI guess at where it’s from, never your video or voice.',
  'share.nearby.saveFailed': 'Couldn’t save that. Try again.',
} as const satisfies Record<`share.${string}`, string>;
