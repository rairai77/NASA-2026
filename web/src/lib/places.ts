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
  /** "295 m from de Gerlache ridge point C" when near, else "" */
  fromLabel: string;
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
    return { title: nearest.km < 0.2 ? nm : `Near ${nm}`, nearest, near: true, distLabel: nearest.km < 0.2 ? 'at the site' : `${fmtKm(nearest.km)} away`, fromLabel: nearest.km < 0.2 ? `at ${nm}` : `${fmtKm(nearest.km)} from ${nm}` };
  }
  return { title: `Unnamed site, ${fmtLat(lat)}`, nearest, near: false, distLabel: '', fromLabel: '' };
}

/** Shared wording: durations of 48 h or more read in days ("30.0 d"), shorter ones in hours ("14 h"). */
export function fmtHours(h: number): string {
  return Math.abs(h) >= 48 ? `${(h / 24).toFixed(1)} d` : `${Math.round(h)} h`;
}

/** Horizon elevation (deg) at an azimuth, linearly interpolated from the site's skyline samples. */
export function horizonAtAz(h: ArrayLike<number> | undefined, az: number): number {
  const n = h?.length ?? 0;
  if (!h || n === 0) return 0;
  const f = (((az % 360) + 360) % 360) / 360 * n;
  const i = Math.floor(f);
  return h[i % n] * (1 - (f - i)) + h[(i + 1) % n] * (f - i);
}

/** "Sun 0.4° · behind terrain" / "Earth +0.7° above skyline". Earth is reported against the local skyline, never as a negative elevation. */
export function sunPhrase(el: number, up: boolean): string {
  return up ? `Sun ${el.toFixed(1)}°` : el >= 0 ? `Sun ${el.toFixed(1)}° · behind terrain` : 'Sun · behind terrain';
}
export function earthPhrase(el: number, rel: number, up: boolean): string {
  return up ? `Earth +${Math.max(0, rel).toFixed(1)}° above skyline` : el >= 0 ? `Earth ${el.toFixed(1)}° · behind terrain` : 'Earth · behind terrain';
}
