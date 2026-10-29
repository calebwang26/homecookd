// Every English word of the cook's app, by area. Keys are `<area>.<name>`; {name}-style holes are filled by t().
// Add a word here (in its area's file), then draft its translations (scripts/draft-words.mjs).
import { COMMON } from './common';
import { CRAVING } from './craving';
import { MESSAGES } from './messages';
import { PARENT } from './parent';
import { PROFILES } from './profiles';
import { REQUEST } from './request';
import { SHARE } from './share';
import { SIGNIN } from './signin';

export const EN = { ...COMMON, ...SIGNIN, ...PROFILES, ...PARENT, ...MESSAGES, ...SHARE, ...CRAVING, ...REQUEST };
export type WordKey = keyof typeof EN;
