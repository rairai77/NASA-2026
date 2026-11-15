import { PGDA_BINS, PGDA_HIST, PGDA_N } from './pgdaHist.ts';

// Density plot (20 x 20 histogram) of our 2026-2030 sunlit fraction vs NASA PGDA average illumination.
// Counts come from pipeline/work/pgda_grid.npz + web/public/data/index/static.f32 (see pgdaHist.ts). r = 0.976 is from docs/VALIDATION.md.
const S = 220, M = { l: 38, b: 34, t: 8, r: 8 };
export function PgdaScatter() {
  const w = S + M.l + M.r, h = S + M.t + M.b, c = S / PGDA_BINS;
  const max = Math.max(...PGDA_HIST.flat());
  const X = (v: number) => M.l + v * S, Y = (v: number) => M.t + (1 - v) * S;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <figure style={{ margin: 0, display: 'grid', gap: 6, justifyItems: 'start' }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ maxWidth: 320, height: 'auto' }} role="img" aria-labelledby="pgda-t pgda-d">
        <title id="pgda-t">Our illumination fraction against NASA PGDA illumination</title>
        <desc id="pgda-d">{`Density of ${PGDA_N.toLocaleString('en-US')} one-kilometre cells south of 85 degrees south. Points follow the 1 to 1 line closely; Pearson r is 0.976 and our values run slightly lower (bias minus 0.023).`}</desc>
        <rect x={M.l} y={M.t} width={S} height={S} fill="var(--surface-2)" stroke="var(--border-strong)" />
        {PGDA_HIST.map((row, py) => row.map((n, ox) => n > 0 && (
          <rect key={`${py}-${ox}`} x={X(ox / PGDA_BINS)} y={Y((py + 1) / PGDA_BINS)} width={c} height={c} fill="var(--info)" fillOpacity={0.12 + 0.88 * Math.sqrt(n / max)} />
        )))}
        <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} stroke="var(--text)" strokeWidth={1} strokeDasharray="4 3" />
        {ticks.map((t) => (
          <g key={t} fontSize={9} fill="var(--text-3)">
            <text x={X(t)} y={M.t + S + 12} textAnchor="middle">{t}</text>
            <text x={M.l - 5} y={Y(t) + 3} textAnchor="end">{t}</text>
          </g>
        ))}
        <text x={M.l + S / 2} y={h - 4} textAnchor="middle" fontSize={10} fill="var(--text-2)">Our sunlit fraction, 2026{'–'}2030</text>
        <text transform={`translate(9 ${M.t + S / 2}) rotate(-90)`} textAnchor="middle" fontSize={10} fill="var(--text-2)">PGDA average illumination</text>
        <text x={X(0.04)} y={Y(0.93)} fontSize={12} fontWeight={600} fill="var(--text)">r = 0.976</text>
        <text x={X(0.04)} y={Y(0.85)} fontSize={9} fill="var(--text-3)">dashed: 1:1</text>
      </svg>
      <figcaption className="hint">Each square counts 1 km cells ({PGDA_N.toLocaleString('en-US')} in total, 85{'–'}90{'°'}S); stronger colour means more cells.</figcaption>
    </figure>
  );
}
