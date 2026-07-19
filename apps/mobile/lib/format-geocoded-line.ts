import type { LocationGeocodedAddress } from 'expo-location';

export function formatGeocodedLine(a: LocationGeocodedAddress): string {
  const parts: string[] = [];
  const streetLine = [a.streetNumber, a.street].filter(Boolean).join(' ').trim();
  if (streetLine) parts.push(streetLine);
  const cityLine = [a.district ?? a.subregion, a.city].filter(Boolean).join(', ');
  if (cityLine) parts.push(cityLine);
  if (a.region) parts.push(a.region);
  if (a.country) parts.push(a.country);
  const s = parts.join(', ').replace(/,\s*,/g, ',').trim();
  return s || 'Address unavailable';
}
