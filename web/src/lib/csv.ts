import type { VisResult } from '../engine/api.ts';
import { METRICS } from '../query/metrics.ts';
import { describeRegion, regionIsCoarse } from '../query/query.ts';
import { useStore } from '../store.ts';

export interface CsvRow { id: string; name: string; lat: number; lon: number; vis: VisResult; extra?: Record<string, number | undefined> }

export function buildCsv(rows: CsvRow[], windowLabel: string): string {
  const lines: string[] = [];
  lines.push(`# Lunar Landing Site Navigator export`);
  lines.push(`# window,${windowLabel}`);
  const q = useStore.getState().query;
  lines.push(`# region,${JSON.stringify(describeRegion(q.region))}${regionIsCoarse(q.region) ? ',coarse 10 km global screening' : ''}`);
  lines.push(`# relay_orbiter_assumed,${q.relay ? 'yes' : 'no'}`);
  if (q.power) lines.push(`# power_panel,${JSON.stringify(q.power)}`);
  lines.push('# comms: comms_hours counts Earth in view AND a DSN complex seeing the Moon >= 10 deg' + (q.relay ? ' (relay assumed: whole window)' : '') + '; link_margin 0 none / 1 marginal / 2 clear; dsn_up bitmask 1 Goldstone, 2 Canberra, 4 Madrid');
  lines.push('# METRICS');
  lines.push(['metric', 'unit', ...rows.map((r) => JSON.stringify(r.name))].join(','));
  lines.push(['lat', 'deg', ...rows.map((r) => r.lat.toFixed(5))].join(','));
  lines.push(['lon', 'deg', ...rows.map((r) => r.lon.toFixed(5))].join(','));
  for (const m of METRICS.filter((m) => m.kind === 'window' && !m.needsPower)) {
    lines.push([m.name, m.unit || '-', ...rows.map((r) => fmt(r.vis.metrics[m.name]))].join(','));
  }
  for (const m of ['energy_wh', 'battery_wh_needed']) {
    if (q.power) lines.push([m, 'Wh', ...rows.map((r) => fmt(r.extra?.[m]))].join(','));
  }
  for (const m of ['elev_m', 'slope_deg', 'psr_dist_km', 'fault_dist_km']) {
    lines.push([m, '-', ...rows.map((r) => fmt(r.extra?.[m]))].join(','));
  }
  lines.push('# TIMELINE');
  const head = ['time_utc', 'unix'];
  for (const r of rows) for (const c of ['sun_az', 'sun_el', 'sun_visible_frac', 'earth_az', 'earth_el', 'earth_up', 'eclipse_frac', 'link_margin', 'dsn_up']) head.push(`${r.id}:${c}`);
  lines.push(head.join(','));
  const base = rows[0]?.vis;
  if (base) {
    for (let i = 0; i < base.t.length; i++) {
      const cells: string[] = [new Date(base.t[i] * 1000).toISOString(), String(base.t[i])];
      for (const r of rows) {
        const v = r.vis;
        if (i >= v.t.length) { cells.push('', '', '', '', '', '', '', '', ''); continue; }
        cells.push(v.sunAz[i].toFixed(2), v.sunEl[i].toFixed(2), v.sunFrac[i].toFixed(3), v.earthAz[i].toFixed(2), v.earthEl[i].toFixed(2), String(v.earthUp[i]), v.eclipseFrac[i].toFixed(3), v.linkMargin ? String(v.linkMargin[i]) : '', v.dsnUp ? String(v.dsnUp[i]) : '');
      }
      lines.push(cells.join(','));
    }
  }
  return lines.join('\n');
}
const fmt = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? '' : String(Math.round(v * 1000) / 1000));

export function download(name: string, text: string, mime = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
