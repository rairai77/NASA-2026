import { Cpu, FlaskConical, Mountain, Orbit, ShieldCheck, TriangleAlert, X, History, Ban, ListChecks } from 'lucide-react';
import { HEADLINE, HORIZONS_NOTE, HORIZONS_ROWS, LIMITS, METHODS, NOT_YET, REPLAY_NOTE, REPLAY_ROWS, RESULTS, TERRAIN_NOTE } from '../lib/validationText.ts';
import { useStore } from '../store.ts';
import { IconButton, Tag, useEscape, type IconType } from './ui.tsx';

function Sec({ icon: Ic, title, children }: { icon: IconType; title: string; children: React.ReactNode }) {
  return <section className="vsec"><h3><Ic aria-hidden />{title}</h3>{children}</section>;
}

export function ValidationModal() {
  const open = useStore((s) => s.validationOpen);
  const info = useStore((s) => s.info);
  const close = () => useStore.setState({ validationOpen: false });
  useEscape(open, close);
  if (!open) return null;
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal wide valid-modal" role="dialog" aria-label="How we know it's right">
        <header>
          <div><h2><ShieldCheck aria-hidden />How we know it{'’'}s right</h2><p className="modal-sub">What was checked against what, and what was not.</p></div>
          <IconButton icon={X} label="Close" tip="none" onClick={close} />
        </header>
        <div className="modal-body prose">
          <p className="callout"><b>{HEADLINE}</b></p>
          {info?.mode === 'mock' && <p className="notice"><TriangleAlert aria-hidden size={14} /> This build is running on synthetic demo data; the numbers on screen are not real.</p>}
          <Sec icon={FlaskConical} title="Methods">
            <ol className="vsteps">{METHODS.map((m) => <li key={m.h}><b>{m.h}.</b> {m.t}</li>)}</ol>
          </Sec>
          <Sec icon={Orbit} title="1. Sun and Earth vs JPL Horizons">
            <div className="tbl-wrap"><table className="mtable valid"><thead><tr><th>Site</th><th>Body</th><th>max |{'Δ'}az{'·'}cos el| ({'°'})</th><th>max |{'Δ'}el| ({'°'})</th></tr></thead>
              <tbody>{HORIZONS_ROWS.map((r, i) => <tr key={i}><th>{r[0]}</th><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td></tr>)}</tbody></table></div>
            <p className="hint">{HORIZONS_NOTE}</p>
          </Sec>
          <Sec icon={Mountain} title="2. Terrain spot checks (internal consistency)">
            <p className="hint">{TERRAIN_NOTE}</p>
          </Sec>
          <Sec icon={Cpu} title="3. Engine, PGDA and other checks">
            <div className="tbl-wrap"><table className="mtable valid kv"><tbody>{RESULTS.map((r) => <tr key={r.h}><th>{r.h}</th><td>{r.t} <Tag>{r.src}</Tag></td></tr>)}</tbody></table></div>
          </Sec>
          <Sec icon={History} title="4. Mission check">
            <div className="tbl-wrap"><table className="mtable valid"><thead><tr><th>Mission</th><th>{'Δ'}</th><th>Context</th></tr></thead>
              <tbody>{REPLAY_ROWS.map((r) => <tr key={r[0]}><th>{r[0]}</th><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody></table></div>
            <p className="hint">{REPLAY_NOTE} Open the <b>Mission check</b> tab to run them live.</p>
          </Sec>
          <Sec icon={ListChecks} title="Not yet checked">
            <ul>{NOT_YET.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </Sec>
          <Sec icon={Ban} title="Limitations and assumptions">
            <ul>{LIMITS.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </Sec>
          <Sec icon={Cpu} title="Current engine">
            <p>Backend: <b>{info ? (info.mode === 'wasm' ? 'WebAssembly engine' : 'demo (synthetic) engine') : '…'}</b>{info?.dataVersion && info.dataVersion !== 'mock' ? ` · ephemeris ${info.dataVersion}` : ''}
              {info ? ` · cross-origin isolated: ${info.crossOriginIsolated ? 'yes' : 'no'}` : ''}</p>
            {info?.notes.map((n, i) => <p key={i} className="hint">{n}</p>)}
            <p className="hint">3D globe rendered with CesiumJS. No generative AI is used to rank or explain results; the chips are the contract.</p>
          </Sec>
        </div>
      </div>
    </div>
  );
}
