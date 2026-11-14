// Nearest named place for a lat/lon, from the curated site catalog.
export const MOON_R_KM = 1737.4;
const D2R = Math.PI / 180;

/** Great-circle distance on the lunar sphere, in km. */
export function greatCircleKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const h = Math.sin(((b.lat - a.lat) * D2R) / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(((b.lon - a.lon) * D2R) / 2) ** 2;
  return 2 * MOON_R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface Named { id: string; name: string; lat: number; lon: number }
export const NEAR_KM = 30;

/** "Apollo 11 (Tranquility Base)" -> "Apollo 11"; "Chang'e 7 (planned, Shackleton rim)" -> "Chang'e 7". */
export function shortName(name: string): string {
  return name.replace(/\s*\([^)]*\)/g, '').trim() || name;
}

export function fmtKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export function fmtLat(lat: number): string { return `${Math.abs(lat).toFixed(1)}° ${lat < 0 ? 'S' : 'N'}`; }

export interface Place {
  /** headline, e.g. "Near Malapert Massif" or "Unnamed site, 88.7° S" */
  title: string;
  /** nearest catalog site and distance (any distance), if the catalog is loaded */
  nearest: { id: string; name: string; km: number } | null;
  /** within NEAR_KM of a named site */
  near: boolean;
  /** distance label such as "4.2 km away" when near, else "" */
  distLabel: string;
}

export function nearestSite(lat: number, lon: number, sites: Named[]): { id: string; name: string; km: number } | null {
  let best: { id: string; name: string; km: number } | null = null;
  for (const s of sites) {
    const km = greatCircleKm({ lat, lon }, s);
    if (!best || km < best.km) best = { id: s.id, name: s.name, km };
  }
  return best;
}

export function placeFor(lat: number, lon: number, sites: Named[]): Place {
  const nearest = nearestSite(lat, lon, sites);
  if (nearest && nearest.km <= NEAR_KM) {
    const nm = shortName(nearest.name);
    return { title: nearest.km < 0.2 ? nm : `Near ${nm}`, nearest, near: true, distLabel: nearest.km < 0.2 ? 'at the site' : `${fmtKm(nearest.km)} away` };
  }
  return { title: `Unnamed site, ${fmtLat(lat)}`, nearest, near: false, distLabel: '' };
}
