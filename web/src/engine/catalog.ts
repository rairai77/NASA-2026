// Catalog loading shared by the real worker and the mock engine: fetch /data/*.json,
// fall back to a small embedded catalog (clearly "demo") when the pipeline output is absent.
import type { Mission, Site } from './api.ts';

export async function fetchJsonMaybe<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/html')) return null; // SPA fallback, i.e. file is absent
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type S = [string, string, string, number, number, string, boolean, string];
const S_: S[] = [
  ['apollo11', 'Apollo 11 (Tranquility Base)', 'Apollo', 0.67416, 23.47314, 'landed', false, ''],
  ['apollo12', 'Apollo 12 (Ocean of Storms)', 'Apollo', -3.01239, -23.42157, 'landed', false, ''],
  ['apollo14', 'Apollo 14 (Fra Mauro)', 'Apollo', -3.6453, -17.47136, 'landed', false, ''],
  ['apollo15', 'Apollo 15 (Hadley-Apennine)', 'Apollo', 26.13222, 3.63386, 'landed', false, ''],
  ['apollo16', 'Apollo 16 (Descartes)', 'Apollo', -8.97301, 15.50019, 'landed', false, ''],
  ['apollo17', 'Apollo 17 (Taurus-Littrow)', 'Apollo', 20.1908, 30.77168, 'landed', false, ''],
  ['luna24', 'Luna 24', 'Luna', 12.75, 62.2, 'landed', false, ''],
  ['change3', "Chang'e 3 (Mare Imbrium)", "Chang'e", 44.1214, -19.5116, 'landed', false, ''],
  ['change4', "Chang'e 4 (Von Karman)", "Chang'e", -45.4561, 177.5885, 'landed', false, ''],
  ['change5', "Chang'e 5 (Oceanus Procellarum)", "Chang'e", 43.06, -51.92, 'landed', false, ''],
  ['ch3', 'Chandrayaan-3 (Shiv Shakti)', 'Chandrayaan', -69.3733, 32.3189, 'landed', false, ''],
  ['slim', 'SLIM (Shioli crater)', 'SLIM', -13.3, 25.25, 'landed', false, ''],
  ['im1', 'IM-1 Odysseus (Malapert A)', 'CLPS', -80.13, 1.44, 'landed', false, ''],
  ['bg1', 'Blue Ghost M1 (Mare Crisium)', 'CLPS', 18.56, 61.81, 'landed', false, ''],
  ['im2', 'IM-2 (Mons Mouton)', 'CLPS', -84.79, 29.2, 'planned', false, ''],
  ['griffin', 'Griffin-1 (Nobile rim)', 'CLPS', -85.4, 31.1, 'planned', false, ''],
  ['shackleton', 'Shackleton rim', 'Artemis III regions', -89.54, 129.78, 'candidate_region', true, 'Representative point'],
  ['connect', 'Connecting Ridge', 'Artemis III regions', -89.45, -100.0, 'candidate_region', true, 'Representative point'],
  ['haworth', 'Haworth', 'Artemis III regions', -87.5, 5.0, 'candidate_region', true, 'Representative point'],
  ['malapert', 'Malapert Massif', 'Artemis III regions', -85.99, 0.0, 'candidate_region', true, 'Representative point'],
  ['faustini', 'Faustini rim A', 'Artemis III regions', -87.3, 77.0, 'candidate_region', true, 'Representative point'],
  ['leibnitz', 'Leibnitz beta plateau', 'Artemis III regions', -85.4, 32.0, 'candidate_region', true, 'Representative point'],
  ['degerlache', 'de Gerlache rim', 'Artemis III regions', -88.5, -87.0, 'candidate_region', true, 'Representative point'],
];

export const FALLBACK_SITES: Site[] = S_.map(([id, name, group, lat, lon, kind, representative, note]) => ({
  id, name, group, lat, lon, kind, representative, note, source: 'demo catalog (approximate)',
}));

export const FALLBACK_MISSIONS: Mission[] = [
  {
    id: 'im1', name: 'IM-1 Odysseus', lat: -80.13, lon: 1.44,
    landed_utc: '2024-02-22T23:23:00Z', end_utc: '2024-02-29T00:00:00Z',
    end_reason: 'Local sunset; battery depleted', reported_note: 'Demo catalog entry', sources: [],
  },
];

export const FALLBACK_FAULTS: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    [[-87.2, 20], [-87.8, 35], [-88.3, 50]],
    [[-86.2, -40], [-86.9, -28], [-87.5, -20]],
    [[-85.6, 60], [-86.1, 72], [-86.9, 80]],
    [[-88.8, -150], [-88.4, -135], [-88.0, -118]],
  ].map((c, i) => ({
    type: 'Feature' as const,
    properties: { name: `Demo scarp ${i + 1}`, kind: 'lobate_scarp', source: 'demo' },
    geometry: { type: 'LineString' as const, coordinates: c.map(([lat, lon]) => [lon, lat]) },
  })),
};

export async function loadSites(base: string): Promise<Site[]> {
  return (await fetchJsonMaybe<Site[]>(`${base}data/sites.json`)) ?? FALLBACK_SITES;
}
export async function loadMissions(base: string): Promise<Mission[]> {
  return (await fetchJsonMaybe<Mission[]>(`${base}data/missions.json`)) ?? FALLBACK_MISSIONS;
}
export async function loadFaults(base: string): Promise<GeoJSON.FeatureCollection> {
  return (await fetchJsonMaybe<GeoJSON.FeatureCollection>(`${base}data/faults.geojson`)) ?? FALLBACK_FAULTS;
}
