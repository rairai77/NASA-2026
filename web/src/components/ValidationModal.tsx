import { HEADLINE, HORIZONS_NOTE, HORIZONS_ROWS, LIMITS, METHODS, NOT_YET, REPLAY_NOTE, REPLAY_ROWS, RESULTS, TERRAIN_NOTE } from '../lib/validationText.ts';
import { useStore } from '../store.ts';
import { useEscape } from './ui.tsx';

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
          <h3>1. Sun and Earth vs JPL Horizons </h3>
          <table className="mtable valid"><thead><tr><th>Site</th><th>Body</th><th>max |{'Δ'}az{'·'}cos el| ({'°'})</th><th>max |{'Δ'}el| ({'°'})</th></tr></thead>
            <tbody>{HORIZONS_ROWS.map((r, i) => <tr key={i}><th>{r[0]}</th><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td></tr>)}</tbody></table>
          <p className="hint">{HORIZONS_NOTE}</p>
          <h3>2. Terrain spot checks (internal consistency)</h3>
          <p className="hint">{TERRAIN_NOTE}</p>
          <h3>3. Engine, PGDA and other checks</h3>
          <table className="mtable valid"><tbody>{RESULTS.map((r) => <tr key={r.h}><th>{r.h}</th><td>{r.t} <span className="hint">[{r.src}]</span></td></tr>)}</tbody></table>
          <h3>4. Mission replay</h3>
          <table className="mtable valid"><thead><tr><th>Mission</th><th>{'Δ'}</th><th>Context</th></tr></thead>
            <tbody>{REPLAY_ROWS.map((r) => <tr key={r[0]}><th>{r[0]}</th><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody></table>
          <p className="hint">{REPLAY_NOTE} Open the <b>Replay</b> tab to run them live.</p>
          <h3>Not yet checked</h3>
          <ul>{NOT_YET.map((n, i) => <li key={i}>{n}</li>)}</ul>
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
