import { Cpu, FlaskConical, Mountain, Orbit, ShieldCheck, TriangleAlert, X, History, Ban, ListChecks } from 'lucide-react';
import { HEADLINE, HEADLINE_CARDS, HORIZONS_NOTE, HORIZONS_ROWS, LIMITS, METHODS, NOT_YET, REPLAY_NOTE, REPLAY_ROWS, RESULTS, TERRAIN_NOTE } from '../lib/validationText.ts';
import { useStore } from '../store.ts';
import { IconButton, Tag, useEscape, type IconType } from './ui.tsx';
import { PgdaScatter } from './PgdaScatter.tsx';

function Sec({ icon: Ic, title, children, fold }: { icon: IconType; title: string; children: React.ReactNode; fold?: boolean }) {
  if (fold) {
    return (
      <details className="vsec vfold">
        <summary><h3><Ic aria-hidden />{title}</h3></summary>
        <div className="vfold-body">{children}</div>
      </details>
    );
  }
  return <section className="vsec"><h3><Ic aria-hidden />{title}</h3>{children}</section>;
}

const CSS = `
.vcards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}@media (max-width:640px){.vcards{grid-template-columns:1fr}}
.vcard{background:var(--surface-1);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 14px;display:grid;gap:4px;align-content:start}
.vcard .vk{font-size:var(--fs-xs);font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3)}
.vcard .vn{font-size:var(--fs-3xl);font-weight:700;line-height:1.1;color:var(--text);font-variant-numeric:tabular-nums}
.vcard .vm{font-size:var(--fs-md);color:var(--text-2);line-height:1.45}
.vcard .vc{font-size:var(--fs-xs);color:var(--text-3);line-height:1.4}
.vfig{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;background:var(--surface-1);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 14px}
.vfig p{flex:1 1 220px;margin:0}
.vfold{border:1px solid var(--border);border-radius:var(--r-md);padding:0}
.vfold>summary{cursor:pointer;padding:10px 14px;list-style:none}
.vfold>summary::-webkit-details-marker{display:none}
.vfold>summary h3{border-bottom:0;padding-bottom:0}
.vfold>summary h3::after{content:"+";margin-left:auto;font-size:15px}
.vfold[open]>summary h3::after{content:"\\2212"}
.vfold>summary:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:var(--r-md)}
.vfold-body{display:grid;gap:10px;padding:0 14px 14px}
`;

export function ValidationModal() {
  const open = useStore((s) => s.validationOpen);
  const info = useStore((s) => s.info);
  const close = () => useStore.setState({ validationOpen: false });
  useEscape(open, close);
  if (!open) return null;
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal wide valid-modal" role="dialog" aria-label="How we know it's right">
        <style>{CSS}</style>
        <header>
          <div><h2><ShieldCheck aria-hidden />How we know it{'’'}s right</h2><p className="modal-sub">What was checked against what, and what was not.</p></div>
          <IconButton icon={X} label="Close" tip="none" onClick={close} />
        </header>
        <div className="modal-body prose">
          <p className="callout"><b>{HEADLINE}</b></p>
          {info?.mode === 'mock' && <p className="notice"><TriangleAlert aria-hidden size={14} /> This build is running on synthetic demo data; the numbers on screen are not real.</p>}
          <div className="vcards">
            {HEADLINE_CARDS.map((c) => (
              <div className="vcard" key={c.k}>
                <span className="vk">{c.k}</span>
                <span className="vn">{c.n}</span>
                <span className="vm">{c.m}</span>
                <span className="vc">{c.c}</span>
              </div>
            ))}
          </div>
          <div className="vfig">
            <PgdaScatter />
            <p>Each square is a group of 1 km cells near the south pole. Left to right is what our engine says about how often the cell is sunlit; bottom to top is what NASA{'’'}s independent LOLA-based map says. Cells hugging the dashed line mean the two agree.</p>
          </div>
          <Sec icon={ListChecks} title="What we haven’t checked yet">
            <ul>{NOT_YET.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </Sec>
          <Sec icon={Cpu} title="All checks, with sources" fold>
            <div className="tbl-wrap"><table className="mtable valid kv"><tbody>{RESULTS.map((r) => <tr key={r.h}><th>{r.h}</th><td>{r.t} <Tag>{r.src}</Tag></td></tr>)}</tbody></table></div>
          </Sec>
          <Sec icon={History} title="Mission replay detail" fold>
            <div className="tbl-wrap"><table className="mtable valid"><thead><tr><th>Mission</th><th>{'Δ'}</th><th>Context</th></tr></thead>
              <tbody>{REPLAY_ROWS.map((r) => <tr key={r[0]}><th>{r[0]}</th><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody></table></div>
            <p className="hint">{REPLAY_NOTE} Open the <b>Mission check</b> tab to run them live.</p>
          </Sec>
          <Sec icon={Orbit} title="Sun and Earth vs JPL Horizons" fold>
            <div className="tbl-wrap"><table className="mtable valid"><thead><tr><th>Site</th><th>Body</th><th>max |{'Δ'}az{'·'}cos el| ({'°'})</th><th>max |{'Δ'}el| ({'°'})</th></tr></thead>
              <tbody>{HORIZONS_ROWS.map((r, i) => <tr key={i}><th>{r[0]}</th><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td></tr>)}</tbody></table></div>
            <p className="hint">{HORIZONS_NOTE}</p>
          </Sec>
          <Sec icon={Mountain} title="Terrain spot checks (internal consistency)" fold>
            <p className="hint">{TERRAIN_NOTE}</p>
          </Sec>
          <Sec icon={FlaskConical} title="Methods" fold>
            <ol className="vsteps">{METHODS.map((m) => <li key={m.h}><b>{m.h}.</b> {m.t}</li>)}</ol>
          </Sec>
          <Sec icon={Ban} title="Limitations and assumptions" fold>
            <ul>{LIMITS.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </Sec>
          <Sec icon={Cpu} title="Current engine" fold>
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
