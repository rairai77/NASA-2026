export const HOUR = 3600;
export const DAY = 86400;

export function parseWhen(s: string): number {
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s) / 1000;
}
export function toDay(t: number): string { return new Date(t * 1000).toISOString().slice(0, 10); }
export function fmtUTC(t: number): string {
  return new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}
export function fmtShort(t: number): string {
  return new Date(t * 1000).toISOString().slice(5, 16).replace('T', ' ');
}
/** "6 d 4 h", "3 h 20 m", "45 m" */
export function fmtDur(sec: number): string {
  sec = Math.max(0, Math.round(sec / 60) * 60);
  const d = Math.floor(sec / DAY), h = Math.floor((sec % DAY) / HOUR), m = Math.floor((sec % HOUR) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} m`;
  return `${m} m`;
}
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
