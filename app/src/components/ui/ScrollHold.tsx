// Holding something down inside a scroll view (the cook's "Hold to talk" on Parent Home and in the
// "All updates" sheet) holds the page still: a thumb that drifts while it holds can't scroll the page.
// The scroll's owner:
//   const hold = useScrollHold();
//   <ScrollHold value={hold.set}><ScrollView scrollEnabled={!hold.held}>...</ScrollView></ScrollHold>
// The thing being held: const holdPage = useHoldPage(); holdPage(true) on press, holdPage(false) on
// release (and on unmount mid-hold). Outside any owner it does nothing.
import { createContext, useContext, useState } from 'react';

const HoldContext = createContext<(held: boolean) => void>(() => {});

export const ScrollHold = HoldContext.Provider;

export function useScrollHold() {
  const [held, set] = useState(false);
  return { held, set };
}

export const useHoldPage = () => useContext(HoldContext);
