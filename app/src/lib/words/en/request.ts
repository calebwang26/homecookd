// English words for a kid's ask (Phase 5, keys request.*): the Home card, the request screen, the reminder
// sheet and its notification, the 2-minute voice recipe and "Sent". Names, never roles: "{kid}", never "him"
// or "your son". Translations: ../tr/.
export const REQUEST = {
  // Parent Home's card (components/request/AskCard) and the request screen's title (app/request/[id].tsx).
  'request.wantsYour': '{kid} wants your',
  'request.wants': '{kid} wants your {dish}',
  'request.answer': 'Answer {kid}',
  'request.close': 'Close',
  'request.missing': 'We couldn’t find this ask.',

  // His voice note, played first.
  'request.voiceNote': '{kid}’s voice note',
  'request.voiceNoteLength': '{kid}’s voice note · {time}',
  'request.voiceNotePlay': 'Play {kid}’s voice note',
  'request.voiceNotePause': 'Pause {kid}’s voice note',

  // His guess: "about 1 lb pork belly", so she wants to correct it.
  'request.guess.title': '{kid} thinks it’s',
  'request.guess.close': 'Is {kid} close?',

  // The two doors.
  'request.film.title': 'Film it next time you make it',
  'request.film.line': 'We’ll remind you on the day.',
  'request.tell.title': 'Tell {kid} how you make it now',
  'request.tell.line': '2 minutes, out loud. {kid} can cook it tonight.',
  // Once a reminder is set, and when her voice recipe couldn't be heard.
  'request.reminded': 'We’ll remind you {day}',
  'request.remindedHint': 'Change the day',
  'request.quick.title': 'Tell {kid} a quick version tonight',
  'request.failed.line': 'We couldn’t hear that one. Try once more.',
  'request.failed.again': 'Tell {kid} again',

  // When do you make it? (components/request/ReminderSheet)
  'request.reminder.title': 'When do you make it?',
  'request.reminder.day': 'Day',
  'request.reminder.time': 'Time',
  'request.reminder.short.0': 'Sun',
  'request.reminder.short.1': 'Mon',
  'request.reminder.short.2': 'Tue',
  'request.reminder.short.3': 'Wed',
  'request.reminder.short.4': 'Thu',
  'request.reminder.short.5': 'Fri',
  'request.reminder.short.6': 'Sat',
  'request.reminder.days.0': 'Sundays',
  'request.reminder.days.1': 'Mondays',
  'request.reminder.days.2': 'Tuesdays',
  'request.reminder.days.3': 'Wednesdays',
  'request.reminder.days.4': 'Thursdays',
  'request.reminder.days.5': 'Fridays',
  'request.reminder.days.6': 'Saturdays',
  'request.reminder.morning': 'Morning',
  'request.reminder.afternoon': 'Afternoon',
  'request.reminder.evening': 'Evening',
  'request.reminder.hourAm': '{h} am',
  'request.reminder.hourPm': '{h} pm',
  'request.reminder.remindOn': 'Remind me on {days}',
  'request.reminder.every': 'Every {day} at {time}',
  'request.reminder.turnOn': 'Turn on reminders',
  'request.reminder.turnOnHint': 'Opens Settings',
  'request.reminder.makingNow': 'I’m making it now',
  'request.reminder.phoneOnly': 'Reminders work in the app on your phone.',
  'request.reminder.failed': 'The reminder didn’t save. Try again.',
  // The notification itself (lib/reminders.ts reminderContent).
  'request.reminder.pushTitle': 'Making {dish} today?',
  'request.reminder.pushBody': 'Tap record for {kid}.',

  // Tell {kid} how you make it (app/request/voice.tsx).
  'request.voice.for': 'For {kid} · {dish}',
  'request.voice.title': 'Tell {kid} how you make it',
  'request.voice.prompt1': 'What goes in',
  'request.voice.prompt2': 'About how much',
  'request.voice.prompt3': 'How you know it’s ready',
  'request.voice.start': 'Tap to start',
  'request.voice.starting': 'Getting the mic ready',
  'request.voice.of': 'of {max}',
  'request.voice.stop': 'Tap to stop when you’re done',
  'request.voice.stopA11y': 'Stop recording',
  'request.voice.listen': 'Listen back · {time}',
  'request.voice.pause': 'Pause · {time}',
  'request.voice.send': 'Send to {kid}',
  'request.voice.sending': 'Sending',
  'request.voice.startOver': 'Start over',
  'request.voice.sendFailed': 'That didn’t send. Try again.',
  'request.voice.tooShort': 'That was too short. Tap to start again.',
  'request.voice.micOff': 'Turn on the microphone in Settings',
  'request.voice.micError': 'The mic didn’t start. Try again.',
  'request.voice.phoneOnly': 'Recording works in the app on your phone.',

  // Sent to {kid} (app/request/sent.tsx).
  'request.sent.title': 'Sent to {kid}',
  'request.sent.line': '{kid} can cook it tonight, in your words.',
  'request.sent.herDish': '{name}’s {dish}',
  'request.sent.upgrade': '{kid} misses the sound of your voice. Film it next time.',
  'request.sent.remind': 'Remind me',
  'request.sent.done': 'Done',
} as const satisfies Record<`request.${string}`, string>;
