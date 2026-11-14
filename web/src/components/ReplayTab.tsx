import { fmtUTC } from '../lib/time.ts';
import { startReplay, useStore } from '../store.ts';

const KIND_LABEL: Record<string, string> = { sunset: 'sunset', sleep_before_night: 'sleep before night', anomaly: 'anomaly', crash: 'crash' };

export function ReplayTab() {
  const missions = useStore((s) => s.missions);
  const replay = useStore((s) => s.replay);
  const real = missions.filter((m) => m.landed_utc);
  return (
    <div className="tab-body">
      <p className="hint">Replay a real mission: we predict local sunset with our engine and compare with the reported end of operations.</p>
      {replay && (
        <div className="replay-card">
          <b>{replay.name}</b>
          <table className="mtable"><tbody>
            <tr><th>Landing</th><td>{fmtUTC(replay.landed)}</td></tr>
            <tr><th>Predicted sunset</th><td>{replay.predSunset ? fmtUTC(replay.predSunset) : 'none in window'}</td></tr>
            <tr><th>Reported end</th><td>{replay.reportedEnd ? fmtUTC(replay.reportedEnd) : '—'}</td></tr>
            <tr className="delta"><th>{'Δ'} (predicted {'−'} reported)</th><td>{replay.deltaH === null ? '—' : `${replay.deltaH >= 0 ? '+' : ''}${replay.deltaH.toFixed(1)} h`}</td></tr>
          </tbody></table>
          <p className="hint">End kind: <b>{KIND_LABEL[replay.endKind] ?? (replay.endKind || 'unknown')}</b> {'·'} {replay.source === 'live' ? 'computed live in your browser' : 'precomputed (validation run)'}</p>
          {replay.endKind === 'anomaly' || replay.endKind === 'crash'
            ? <p className="note warn">Not a sunset end: {replay.endReason}. The {'Δ'} is not a prediction error.</p>
            : <p className="note">{replay.endReason}</p>}
        </div>
      )}
      <ul className="mlist">
        {real.map((m) => (
          <li key={m.id} className={replay?.id === m.id ? 'sel' : ''}>
            <button onClick={() => startReplay(m.id)}>
              <b>{m.name}</b>
              <small>{m.landed_utc.slice(0, 10)} {'·'} {m.lat.toFixed(2)}{'°'}, {m.lon.toFixed(2)}{'°'}</small>
              <span className="badge">{(m as unknown as { end_kind?: string }).end_kind ?? 'end'}</span>
            </button>
          </li>
        ))}
      </ul>
      {real.length === 0 && <p className="empty">No missions loaded.</p>}
    </div>
  );
}
