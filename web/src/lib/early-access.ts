// How the lander's early-access form behaves (#early-access, components/sections/FinalCta/EarlyAccessForm.tsx).
// Bug hunt, Nov 10: on the live site NEXT_PUBLIC_EARLY_ACCESS_URL was never set, so the form sent every address
// nowhere and still said "You're on the list." A form that can't keep an address isn't shown at all now; what goes
// in its place is Caleb's call (his list: an App Store link and its words).
//   post  the endpoint is set: the form posts there and thanks only when it went
//   demo  a dev build with no endpoint: the thank-you shows without a request (brief 8.12 accept 4, for demos)
//   off   a production build with no endpoint: no form
export type EarlyAccessMode = 'post' | 'demo' | 'off';

export function earlyAccessMode(endpoint: string | undefined, nodeEnv: string | undefined): EarlyAccessMode {
  if (endpoint?.trim()) return 'post';
  return nodeEnv === 'production' ? 'off' : 'demo';
}
