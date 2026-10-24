// The old "Get these ready" screen. Its checkable ingredient list now lives on the recipe overview
// (mockup direction A, kid QA round 2), and "Start cooking" goes straight to step 1, so this route
// only stays for old links: it replaces itself with the dish's overview.
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function IngredientsRedirect() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = rawId ? String(rawId) : '';
  return id ? <Redirect href={{ pathname: '/recipe/[id]', params: { id } }} /> : <Redirect href="/" />;
}
