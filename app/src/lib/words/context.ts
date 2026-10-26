// The current t() and reading direction for components/ui (Txt's right-to-left, BackPill's "Back"), in their own tiny
// module so those can read them without importing the session. UiLanguageProvider (useWords.tsx) sets both.
import { createContext } from 'react';

import { english, type T } from './words';

export const RtlContext = createContext(false);
export const TContext = createContext<T>(english);
