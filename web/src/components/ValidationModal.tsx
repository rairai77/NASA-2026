import { HEADLINE, HORIZONS_NOTE, HORIZONS_ROWS, LIMITS, METHODS, PENDING, TERRAIN_NOTE } from '../lib/validationText.ts';
import { useStore } from '../store.ts';
import { useEscape } from './ui.tsx';

const Pending = () => <span className="pending">pending</span>;

export function ValidationModal() {
  const open = useStore((s) => s.validationOpen);
  const info = useStore((s) => s.info);
  const close = () => useStore.setState({ validationOpen: false });
  useEscape(open, close);
  if (!open) return null;
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal wide" role="dialog" aria-label="How we know it's right">
        <header><h2>How we know it{'’'}s right</h2><button className="icon-btn" onClick={close} aria-label="Close">{'×'}</button></header>
        <div className="modal-body prose">
          <p><b>{HEADLINE}</b></p>
          {info?.mode === 'mock' && <p className="notice">This build is running on synthetic demo data; the numbers on screen are not real.</p>}
          <h3>Methods</h3>
          <ol>{METHODS.map((m) => <li key={m.h}><b>{m.h}.</b> {m.t}</li>)}</ol>
          <h3>1. Sun and Earth vs JPL Horizons (done)</h3>
          <table className="mtable valid"><thead><tr><th>Site</th><th>Body</th><th>max |{'Δ'}az{'·'}cos el| ({'°'})</th><th>max |{'Δ'}el| ({'°'})</th></tr></thead>
            <tbody>{HORIZONS_ROWS.map((r, i) => <tr key={i}><th>{r[0]}</th><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td></tr>)}</tbody></table>
          <p className="hint">{HORIZONS_NOTE}</p>
          <h3>2. Terrain spot checks (done, internal consistency)</h3>
          <p className="hint">{TERRAIN_NOTE}</p>
          <h3>3. Mission replay</h3>
          <p>Open the <b>Replay</b> tab: each mission is replayed from landing and our predicted sunset is compared with the reported end of operations, live. <Pending /> for the summary table.</p>
          <h3>4. Pending checks <Pending /></h3>
          <table className="mtable"><tbody>{PENDING.map(([a, b], i) => <tr key={i}><th>{a}</th><td className="pendcell">{b} <Pending /></td></tr>)}</tbody></table>
          <h3>Limitations and assumptions</h3>
          <ul>{LIMITS.map((l, i) => <li key={i}>{l}</li>)}</ul>
          <h3>Current engine</h3>
          <p>Backend: <b>{info ? (info.mode === 'wasm' ? 'WebAssembly engine' : 'demo (synthetic) engine') : '…'}</b>{info?.dataVersion && info.dataVersion !== 'mock' ? ` · ephemeris ${info.dataVersion}` : ''}
            {info ? ` · cross-origin isolated: ${info.crossOriginIsolated ? 'yes' : 'no'}` : ''}</p>
          {info?.notes.map((n, i) => <p key={i} className="hint">{n}</p>)}
          <p className="hint">3D globe rendered with CesiumJS. No generative AI is used to rank or explain results; the chips are the contract.</p>
        </div>
      </div>
    </div>
  );
}
