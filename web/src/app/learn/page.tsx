// The kid version: for the one who misses the cooking (src/content/copy.ts).
import { Lander, landerMetadata } from '../lander';

export const metadata = landerMetadata('kid');

export default function LearnPage() {
  return <Lander audience="kid" />;
}
