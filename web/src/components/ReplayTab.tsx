import { useEffect, useState } from 'react';
import { CalendarClock, Play, TriangleAlert } from 'lucide-react';
import { fmtUTC, parseWhen } from '../lib/time.ts';
import { startReplay, useStore } from '../store.ts';
import { Tag } from './ui.tsx';

const KIND_LABEL: Record<string, string> = { sunset: 'Sunset', sleep_before_night: 'Slept before night', anomaly: 'Anomaly', crash: 'Crash', tipped: 'Tipped, ended early' };
/** Short reason shown instead of a number for missions whose end was not a sunset. */
const NOT_COMPARABLE: Record<string, string> = { anomaly: 'landing anomaly', crash: 'crashed on landing', tipped: 'tipped, ended early' };
/** Effective end kind. IM-1 is stored as "sunset" but its end_reason says it tipped and died before true sunset. */
const effKind = (kind: string, reason: string | undefined) => (kind === 'sunset' && /tipped/i.test(reason ?? '') ? 'tipped' : kind);
const kindOf = (m: unknown) => {
  const r = m as { end_kind?: string; end_reason?: string };
  return effKind(r.end_kind ?? '', r.end_reason);
};

interface Pred { predicted_sunset_utc?: string | null }
/** Precomputed predicted-sunset table (same file the replay uses); missions missing from it only get a delta once opened. */
function usePreds(): Record<string, Pred> | null {
  const [p, setP] = useState<Record<string, Pred> | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/data/missions_pred.json')
      .then(async (r) => (r.ok && !(r.headers.get('content-type') ?? '').includes('html') ? ((await r.json()) as Record<string, Pred>) : null))
      .then((j) => live && setP(j)).catch(() => {});
    return () => { live = false; };
  }, []);
  return p;
}

export function ReplayTab() {
  const preds = usePreds();
  const missions = useStore((s) => s.missions);
  const replay = useStore((s) => s.replay);
  const real = missions.filter((m) => m.landed_utc);
  const rKind = replay ? effKind(replay.endKind, replay.endReason) : '';
  const notSunset = !!replay && rKind in NOT_COMPARABLE;
  const delta = replay?.deltaH ?? null;
  const dTone = notSunset || delta === null ? undefined : Math.abs(delta) <= 12 ? 'ok' : 'warn';
  return (
    <div className="pn-body">
      <div className="pn-head">
        <h2 className="pn-h">Mission check</h2>
        <p className="pn-sub">Did the model predict when real landers lost sunlight? Pick a mission to compare our predicted sunset with when it actually stopped.</p>
      </div>
      {replay && (
        <section className="pn-replay" aria-live="polite">
          <header>
            <b>{replay.name}</b>
            <Tag>{KIND_LABEL[rKind] ?? (rKind || 'End')}</Tag>
          </header>
          <div className="pn-pvr">
            <div><span className="pn-k">Our predicted sunset</span><span className="pn-v mono">{replay.predSunset ? fmtUTC(replay.predSunset) : 'none in window'}</span></div>
            <div><span className="pn-k">Reported end</span><span className="pn-v mono">{replay.reportedEnd ? fmtUTC(replay.reportedEnd) : '—'}</span></div>
          </div>
          <div className="pn-delta">
            <span className="pn-delta-lbl"><span className="pn-v">Predicted sunset vs reported end:</span><span className="pn-k">{notSunset ? `Not comparable: ${NOT_COMPARABLE[rKind]}` : '+ means we predicted sunset later than reality'}</span></span>
            <span className={`pn-delta-b mono ${dTone ?? ''}`}>{notSunset ? 'Not comparable' : delta === null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} h`}</span>
          </div>
          <p className="pn-small"><CalendarClock aria-hidden /> Landed {fmtUTC(replay.landed)} {'·'} {replay.source === 'live' ? 'computed live in your browser' : 'precomputed (validation run)'}</p>
          {replay.outsideIndex && <p className="pn-note"><TriangleAlert aria-hidden />This mission predates the polar index (2026{'–'}2030), so no site ranking is run. The timeline shows the mission site only.</p>}
          {notSunset
            ? <p className="pn-note warn"><TriangleAlert aria-hidden />Not a sunset end: {replay.endReason}. The difference is not a prediction error.</p>
            : <p className="pn-small">{replay.endReason}</p>}
        </section>
      )}
      <h3 className="ui-section-title">Missions</h3>
      <p className="pn-hint">Predicted sunset minus reported end: <b>+</b> means we predicted later, <b>−</b> earlier. Missions that did not end at sunset are not compared.</p>
      <ul className="pn-mlist">
        {[...real].sort((a, b) => Number(kindOf(a) in NOT_COMPARABLE) - Number(kindOf(b) in NOT_COMPARABLE)).map((m) => {
          const ps = preds?.[m.id]?.predicted_sunset_utc;
          const dh = ps && m.end_utc ? (parseWhen(ps) - parseWhen(m.end_utc)) / 3600 : null;
          const notSun = kindOf(m) in NOT_COMPARABLE;
          return (
          <li key={m.id}>
            <button className={`pn-mission ${replay?.id === m.id ? 'is-sel' : ''}`} onClick={() => startReplay(m.id)}>
              <span className="pn-mission-t"><b>{m.name}</b><small className="mono">{m.landed_utc.slice(0, 10)} {'·'} {m.lat.toFixed(2)}{'°'}, {m.lon.toFixed(2)}{'°'}</small></span>
              <span className="pn-mission-r">
                <Tag>{KIND_LABEL[kindOf(m)] ?? (kindOf(m) || 'end')}</Tag>
                {notSun
                  ? <span className="pn-mission-d" title={`Not comparable: ${NOT_COMPARABLE[kindOf(m)]}. This mission did not end at sunset, so a sunset delta is not a prediction error`}>not compared</span>
                  : dh !== null && (
                  <span className={`pn-mission-d ${Math.abs(dh) <= 12 ? 'ok' : 'warn'}`} title="Predicted sunset minus reported end">
                    {dh >= 0 ? '+' : '−'}{Math.abs(dh).toFixed(1)} h
                  </span>
                )}
              </span>
              <Play aria-hidden className="pn-mission-go" />
            </button>
          </li>
          );
        })}
      </ul>
      {real.length === 0 && <p className="pn-hint">No missions loaded.</p>}
    </div>
  );
}
