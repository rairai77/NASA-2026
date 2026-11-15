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
/** Within this distance a result is titled "Near X"; farther out it gets "20 km NE of X". */
export const CLOSE_KM = 5;

const DIRS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const DIRS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
/** Compass point for an azimuth in degrees (16 points: "NNW"). */
export function compass16(az: number): string { return DIRS16[Math.round((((az % 360) + 360) % 360) / 22.5) % 16]; }

/** 8-point compass bearing of `to` as seen from `from` (initial great-circle bearing). */
export function compass8(from: { lat: number; lon: number }, to: { lat: number; lon: number }): string {
  const dl = (to.lon - from.lon) * D2R;
  const y = Math.sin(dl) * Math.cos(to.lat * D2R);
  const x = Math.cos(from.lat * D2R) * Math.sin(to.lat * D2R) - Math.sin(from.lat * D2R) * Math.cos(to.lat * D2R) * Math.cos(dl);
  const b = ((Math.atan2(y, x) / D2R) + 360) % 360;
  return DIRS8[Math.round(b / 45) % 8];
}

/** "Apollo 11 (Tranquility Base)" -> "Apollo 11"; "Chang'e 7 (planned, Shackleton rim)" -> "Chang'e 7". */
export function shortName(name: string): string {
  return name.replace(/\s*\([^)]*\)/g, '').trim() || name;
}

export function fmtKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export function fmtLat(lat: number): string { return `${Math.abs(lat).toFixed(1)}° ${lat < 0 ? 'S' : 'N'}`; }

export interface Place {
  /** headline, e.g. "Near Malapert Massif", "20 km NE of Griffin-1" or "Unnamed site, 88.7° S" */
  title: string;
  /** nearest catalog site and distance (any distance), if the catalog is loaded */
  nearest: { id: string; name: string; km: number } | null;
  /** within NEAR_KM of a named site */
  near: boolean;
  /** distance label such as "20 km from Griffin-1" when near, else "" */
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

export function placeFor(lat: number, lon: number, sites: (Named)[]): Place {
  const nearest = nearestSite(lat, lon, sites);
  if (nearest && nearest.km <= NEAR_KM) {
    const nm = shortName(nearest.name);
    if (nearest.km < 0.2) return { title: nm, nearest, near: true, distLabel: 'at the site', fromLabel: `at ${nm}` };
    const from = `${fmtKm(nearest.km)} from ${nm}`;
    const named = sites.find((x) => x.id === nearest.id);
    const title = nearest.km <= CLOSE_KM || !named ? `Near ${nm}` : `${fmtKm(nearest.km)} ${compass8(named, { lat, lon })} of ${nm}`;
    return { title, nearest, near: true, distLabel: from, fromLabel: from };
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

/** "Sun 3.6° high, toward NNW" / "Earth +0.7° above skyline, toward NNW". Earth is reported against the local skyline, never as a negative elevation. */
export function sunPhrase(el: number, up: boolean, az?: number): string {
  const to = up && az !== undefined ? `, toward ${compass16(az)}` : '';
  return up ? (el < 0.5 ? `Sun just above the skyline${to}` : `Sun ${el.toFixed(1)}° high${to}`) : el >= 0 ? `Sun ${el.toFixed(1)}° · behind terrain` : 'Sun · behind terrain';
}
export function earthPhrase(el: number, rel: number, up: boolean, az?: number): string {
  const to = up && az !== undefined ? `, toward ${compass16(az)}` : '';
  return up ? `Earth +${Math.max(0, rel).toFixed(1)}° above skyline${to}` : el >= 0 ? `Earth ${el.toFixed(1)}° · behind terrain` : 'Earth · behind terrain';
}
