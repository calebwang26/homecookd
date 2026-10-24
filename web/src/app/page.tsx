// / : the parent version, the default home page (no chooser). A kid's link or pick goes to /learn
// before paint (ROUTE_GATE, src/lib/audience-gate.ts); the hero's second button switches by hand.
import { Lander, landerMetadata } from './lander';

export const metadata = landerMetadata('parent');

export default function Home() {
  return <Lander audience="parent" />;
}
