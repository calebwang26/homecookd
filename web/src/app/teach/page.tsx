// /teach: the parent version again (the same page as /, canonical /). Invites and the app's
// "teach me" links open here (/teach?aud=parent&from=app); ROUTE_GATE never moves a /teach visit.
import { Lander, landerMetadata } from '../lander';

export const metadata = landerMetadata('parent');

export default function TeachPage() {
  return <Lander audience="parent" />;
}
