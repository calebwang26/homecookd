// Community distance (convex/lib/geo.ts). Locations are stored rounded to about 1 km and never shown; people only see a label like "Under a mile".
export type LatLng = { lat: number; lng: number };

// TODO(caleb): the venue's coordinates. Placeholder: Cambridge MA (MIT), already on the grid.
export const DEMO_LOCATION: LatLng = { lat: 42.36, lng: -71.09 };

/** Two decimals: about 1.1 km north–south, a little less east–west. */
export function roundToGrid({ lat, lng }: LatLng): LatLng {
  const r = (n: number) => Math.round(n * 100) / 100;
  return { lat: r(lat), lng: r(lng) };
}

/** A row's place (Postgres sends numeric as text), or the demo venue for someone who never set one. */
export function placeOf(row: { approx_lat: string | null; approx_lng: string | null } | null | undefined): LatLng {
  if (!row || row.approx_lat === null || row.approx_lng === null) return DEMO_LOCATION;
  return { lat: Number(row.approx_lat), lng: Number(row.approx_lng) };
}

/** Great-circle distance in miles (haversine). */
export function milesBetween(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

export function distanceLabel(miles: number): string {
  if (miles < 0.05) return "In your building";
  if (miles < 1) return "Under a mile";
  return `About ${Math.round(miles)} mi`;
}
