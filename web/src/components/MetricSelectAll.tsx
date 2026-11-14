import { metricLabel } from '../query/metrics.ts';
import { useStore } from '../store.ts';

export function MetricSelectAll({ value, onChange, keys }: { value: string; onChange: (m: string) => void; keys: string[] }) {
  const edu = useStore((s) => s.educator);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Metric">
      {keys.map((k) => <option key={k} value={k}>{metricLabel(k, edu)}</option>)}
    </select>
  );
}
