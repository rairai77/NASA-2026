import { useStore } from '../store.ts';
import { useEscape } from './ui.tsx';

const PH = <span className="ph">PLACEHOLDER</span>;

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
          <p className="notice">
            {info?.mode === 'mock'
              ? 'This build is running on synthetic demo data. The numbers below are not yet filled in.'
              : 'Validation numbers below are pending the final validation run.'}
          </p>
          <h3>1. Sun and Earth directions vs JPL Horizons {PH}</h3>
          <p>We compare our SPICE-derived (DE440, MOON_ME frame) topocentric Sun and Earth azimuth/elevation against JPL Horizons observer tables at the curated sites for 2026{'–'}2030.</p>
          <table className="mtable"><tbody>
            <tr><th>Sun azimuth, max error</th><td>[TBD] arcmin</td></tr>
            <tr><th>Sun elevation, max error</th><td>[TBD] arcmin</td></tr>
            <tr><th>Earth azimuth / elevation, max error</th><td>[TBD] arcmin</td></tr>
            <tr><th>Sunrise / sunset time, max error</th><td>[TBD] min</td></tr>
          </tbody></table>
          <h3>2. Native Rust vs WebAssembly parity {PH}</h3>
          <p>The same engine core runs in the browser (WASM) and in Python (native) for the offline index. We check that horizons and metrics agree bit-for-bit or within float tolerance.</p>
          <table className="mtable"><tbody>
            <tr><th>Horizon elevation, max |native {'−'} WASM|</th><td>[TBD] deg</td></tr>
            <tr><th>Window metrics, max relative difference</th><td>[TBD]</td></tr>
            <tr><th>Sites compared</th><td>[TBD]</td></tr>
          </tbody></table>
          <h3>3. Replay of real missions {PH}</h3>
          <p>We replay landed missions (e.g. IM-1, Chandrayaan-3, SLIM) and compare predicted local sunset with the reported end of operations.</p>
          <table className="mtable"><tbody>
            <tr><th>IM-1 predicted vs reported sunset</th><td>[TBD]</td></tr>
            <tr><th>Chandrayaan-3 predicted vs reported sunset</th><td>[TBD]</td></tr>
          </tbody></table>
          <h3>4. Terrain horizons vs LOLA {PH}</h3>
          <p>Horizon profiles are computed from LOLA digital elevation models (20 m near the pole) with exact curvature. We cross-check against independently published horizon masks.</p>
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
