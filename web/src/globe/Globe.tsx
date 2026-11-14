import './cesiumSetup.ts';
import { useEffect, useRef, useState } from 'react';
import {
  BillboardGraphics, BoundingSphere, Cartesian2, Cartesian3, Color, ConstantPositionProperty, CustomDataSource, DirectionalLight,
  Ellipsoid, Entity, GeographicTilingScheme, HeadingPitchRange, HorizontalOrigin, Math as CMath, NearFarScalar,
  ScreenSpaceEventHandler, ScreenSpaceEventType, SingleTileImageryProvider, UrlTemplateImageryProvider, VerticalOrigin, Viewer,
  ImageryLayer, type ImageryProvider, Rectangle, HeightReference, ColorMaterialProperty,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { getEngine } from '../engine/client.ts';
import { flyTo, select, useStore } from '../store.ts';
import { createTerrainProvider } from './terrain.ts';
import { ShadowImageryProvider } from './shadowProvider.ts';
import type { ShadowPatch } from '../engine/api.ts';
import { makeMoonCanvas } from './moonTexture.ts';

const MOON = Ellipsoid.MOON;
Ellipsoid.default = MOON;

export const GROUP_COLORS: Record<string, string> = {
  Apollo: '#E69F00', Luna: '#56B4E9', "Chang'e": '#CC79A7', Chandrayaan: '#009E73', SLIM: '#F0E442',
  CLPS: '#4C8DFF', 'Artemis III regions': '#FF8A5B', Other: '#BBBBBB',
};

let latestCam: { p: number[]; d: number[]; u: number[] } | null = null;
export function getCameraState() { return latestCam; }

const r3 = (v: Cartesian3) => [v.x, v.y, v.z].map((x) => Math.round(x));
const r4 = (v: Cartesian3) => [v.x, v.y, v.z].map((x) => Math.round(x * 1e5) / 1e5);

// Exactly-nadir cameras make Cesium's depth plane normalise a zero vector; offset by a metre.
function poleCam() { return new Cartesian3(1, 1, -(MOON.maximumRadius + 2.1e6)); }

function pos(lat: number, lon: number, h = 0) { return Cartesian3.fromDegrees(lon, lat, h, MOON); }

function numberedPin(n: number, selected: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 56;
  const g = c.getContext('2d')!;
  g.beginPath(); g.arc(28, 28, 22, 0, 7);
  g.fillStyle = selected ? '#FFFFFF' : '#10141c'; g.fill();
  g.lineWidth = 4; g.strokeStyle = selected ? '#F5B700' : '#8fb4ff'; g.stroke();
  g.fillStyle = selected ? '#10141c' : '#ffffff';
  g.font = '700 26px ui-sans-serif, system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 28, 29);
  return c;
}

function glowCanvas(kind: 'sun' | 'earth'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  if (kind === 'sun') {
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,255,240,1)'); grd.addColorStop(0.07, 'rgba(255,245,200,1)'); grd.addColorStop(0.12, 'rgba(255,220,120,0.55)');
    grd.addColorStop(0.4, 'rgba(255,190,60,0.12)'); grd.addColorStop(1, 'rgba(255,170,40,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  } else {
    const grd = g.createRadialGradient(100, 100, 10, 128, 128, 120);
    grd.addColorStop(0, '#d9ecff'); grd.addColorStop(0.5, '#5aa0f0'); grd.addColorStop(1, '#1d4f9e');
    g.fillStyle = grd; g.beginPath(); g.arc(128, 128, 120, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (const [x, y, rx, ry, r] of [[100, 90, 60, 12, 0.4], [150, 160, 55, 10, -0.3], [130, 60, 45, 9, 0.1], [90, 170, 30, 8, 0.7]]) {
      g.beginPath(); g.ellipse(x, y, rx, ry, r, 0, 7); g.fill();
    }
  }
  return c;
}

interface Hover { id: string; x: number; y: number }

export default function Globe() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const dsRef = useRef<Record<string, CustomDataSource>>({});
  const skyRef = useRef<{ sun: Entity; earth: Entity } | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [ready, setReady] = useState(false);
  const targets = useStore((s) => s.targets);
  const sites = useStore((s) => s.sites);
  const results = useStore((s) => s.results);
  const selected = useStore((s) => s.selected);
  const cursor = useStore((s) => s.cursor);
  const layers = useStore((s) => s.layers);
  const fly = useStore((s) => s.fly);
  const ellipse = useStore((s) => s.ellipseDraw);
  const tokenRef = useRef(0);
  const layerDefs = useStore((st) => st.layerDefs);
  const layerState = useStore((st) => st.layerState);
  const exaggeration = useStore((st) => st.exaggeration);
  const mode = useStore((st) => st.info?.mode);
  const imgLayers = useRef<Record<string, ImageryLayer>>({});
  const shadowLayer = useRef<ImageryLayer | null>(null);
  const [regime, setRegime] = useState<'regional' | 'local'>('regional');
  const [shadowMock, setShadowMock] = useState(false);

  // ---- create viewer once ----------------------------------------------------------
  useEffect(() => {
    const host = hostRef.current!;
    const viewer = new Viewer(host, {
      baseLayer: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false, infoBox: false,
      selectionIndicator: false, scene3DOnly: true, requestRenderMode: true, maximumRenderTimeChange: Infinity,
      skyAtmosphere: false, shadows: false,
    });
    viewerRef.current = viewer;
    if (import.meta.env.DEV) (window as unknown as { __viewer: Viewer }).__viewer = viewer;
    const scene = viewer.scene;
    scene.globe.show = true;
    scene.globe.showGroundAtmosphere = false;
    scene.globe.enableLighting = true;
    scene.globe.depthTestAgainstTerrain = true;
    scene.globe.maximumScreenSpaceError = 3;
    scene.globe.dynamicAtmosphereLighting = false;
    scene.globe.baseColor = Color.fromCssColorString('#7d7d7d');
    scene.globe.terrainProvider = createTerrainProvider(getEngine());
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    scene.fog.enabled = false;
    scene.backgroundColor = Color.BLACK;
    scene.highDynamicRange = false;
    scene.light = new DirectionalLight({ direction: new Cartesian3(-1, 0, 0) });
    scene.screenSpaceCameraController.minimumZoomDistance = 300;
    scene.screenSpaceCameraController.maximumZoomDistance = 4e7;
    viewer.clock.shouldAnimate = false;
    viewer.cesiumWidget.creditContainer.classList.add('tiny-credit');

    for (const k of ['faults', 'sites', 'results', 'keepout', 'ellipse', 'sky', 'sel']) {
      const ds = new CustomDataSource(k);
      dsRef.current[k] = ds;
      viewer.dataSources.add(ds);
    }

    // Sun and Earth sprites at true directions; Earth ~1.9 deg across at 384,400 km.
    const sky = dsRef.current.sky;
    const sun = sky.entities.add({
      position: new ConstantPositionProperty(Cartesian3.fromElements(3.8e8, 0, 0)),
      billboard: new BillboardGraphics({ image: glowCanvas('sun'), width: 3.0e7, height: 3.0e7, sizeInMeters: true, color: Color.WHITE }),
    });
    const earth = sky.entities.add({
      position: new ConstantPositionProperty(Cartesian3.fromElements(3.844e8, 0, 0)),
      billboard: new BillboardGraphics({ image: glowCanvas('earth'), width: 1.27e7 * (256 / 240), height: 1.27e7 * (256 / 240), sizeInMeters: true }),
    });
    skyRef.current = { sun, earth };

    // imagery: real tiles if the pipeline produced them, else a procedural grey Moon
    (async () => {
      let provider: ImageryProvider | null = null;
      try {
        const res = await fetch('/data/imagery/color/meta.json');
        if (res.ok && !(res.headers.get('content-type') ?? '').includes('html')) {
          const meta = await res.json();
          provider = new UrlTemplateImageryProvider({
            url: '/data/imagery/color/{z}/{x}/{y}.jpg',
            tilingScheme: new GeographicTilingScheme({ ellipsoid: MOON }),
            maximumLevel: meta.maxLevel ?? meta.max_level ?? 5, ellipsoid: MOON,
          });
        }
      } catch { /* none */ }
      if (!provider) {
        const url = makeMoonCanvas().toDataURL('image/jpeg', 0.85);
        provider = await SingleTileImageryProvider.fromUrl(url, { rectangle: Rectangle.MAX_VALUE, tileWidth: 4096, tileHeight: 2048 } as never);
      }
      if (viewer.isDestroyed()) return;
      viewer.imageryLayers.add(new ImageryLayer(provider));
      scene.requestRender();
    })();

    // camera: restore or south pole hero
    const cam = useStore.getState().initialCam;
    if (cam) {
      viewer.camera.setView({ destination: new Cartesian3(cam.p[0] + 1, cam.p[1] + 1, cam.p[2]), orientation: { direction: new Cartesian3(...cam.d), up: new Cartesian3(...cam.u) } });
    } else {
      viewer.camera.setView({ destination: poleCam(), orientation: { heading: 0, pitch: -CMath.PI_OVER_TWO, roll: 0 } });
    }
    viewer.camera.percentageChanged = 0.005;
    const updCam = () => {
      const c = viewer.camera;
      latestCam = { p: r3(c.positionWC), d: r4(c.directionWC), u: r4(c.upWC) };
      setRegime(c.positionCartographic.height < 3.5e5 ? 'local' : 'regional');
    };
    viewer.camera.changed.addEventListener(updCam);
    updCam();

    // picking
    const handler = new ScreenSpaceEventHandler(scene.canvas);
    const pickId = (p: Cartesian2): string | null => {
      const o = scene.pick(p);
      const id = o?.id;
      return id instanceof Entity && typeof id.id === 'string' && !['sun', 'earth'].includes(id.id) && id.name !== 'sel' ? id.id.replace(/^res:/, '') : null;
    };
    handler.setInputAction((m: { endPosition: Cartesian2 }) => {
      const id = pickId(m.endPosition);
      scene.canvas.style.cursor = id ? 'pointer' : '';
      setHover((h) => (id ? { id, x: m.endPosition.x, y: m.endPosition.y } : h ? null : h));
    }, ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction((m: { position: Cartesian2 }) => {
      const id = pickId(m.position);
      if (id) select(id);
    }, ScreenSpaceEventType.LEFT_CLICK);

    const ro = new ResizeObserver(() => { viewer.resize(); scene.requestRender(); });
    ro.observe(host);
    setReady(true);
    return () => {
      ro.disconnect(); handler.destroy(); viewer.destroy(); viewerRef.current = null; setReady(false);
    };
  }, []);

  // ---- curated site pins -------------------------------------------------------------
  useEffect(() => {
    const ds = dsRef.current.sites;
    const viewer = viewerRef.current;
    if (!ds || !viewer) return;
    ds.entities.removeAll();
    if (layers.sites) {
      for (const s of sites) {
        ds.entities.add({
          id: s.id, name: s.name, position: pos(s.lat, s.lon),
          point: {
            pixelSize: 8, color: Color.fromCssColorString(GROUP_COLORS[s.group] ?? GROUP_COLORS.Other),
            outlineColor: Color.BLACK.withAlpha(0.8), outlineWidth: 1.5,
            heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 2e5, scaleByDistance: new NearFarScalar(2e5, 1.6, 2e7, 0.9),
          },
        });
      }
    }
    viewer.scene.requestRender();
  }, [sites, layers.sites, ready]);

  // ---- ranked result pins ---------------------------------------------------------------
  useEffect(() => {
    const ds = dsRef.current.results;
    const viewer = viewerRef.current;
    if (!ds || !viewer) return;
    ds.entities.removeAll();
    if (layers.results && results) {
      for (const r of results.results) {
        const id = r.id ?? `r:${r.lat.toFixed(4)},${r.lon.toFixed(4)}`;
        ds.entities.add({
          id: `res:${id}`, name: `#${r.rank}`, position: pos(r.lat, r.lon),
          billboard: {
            image: numberedPin(r.rank, id === selected), width: 30, height: 30, verticalOrigin: VerticalOrigin.CENTER, horizontalOrigin: HorizontalOrigin.CENTER,
            heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 2e5, eyeOffset: new Cartesian3(0, 0, -400), scaleByDistance: new NearFarScalar(1e5, 1.3, 2e7, 0.85),
          },
        });
      }
    }
    viewer.scene.requestRender();
  }, [results, layers.results, selected, ready]);

  // selection ring
  useEffect(() => {
    const ds = dsRef.current.sel;
    const viewer = viewerRef.current;
    if (!ds || !viewer) return;
    ds.entities.removeAll();
    const t = selected ? targets[selected] : undefined;
    if (t) {
      ds.entities.add({
        id: 'sel-ring', name: 'sel', position: pos(t.lat, t.lon),
        point: { pixelSize: 22, color: Color.TRANSPARENT, outlineColor: Color.fromCssColorString('#F5B700'), outlineWidth: 3, heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 2e5 },
      });
    }
    viewer.scene.requestRender();
  }, [selected, targets, ready]);

  // ---- fault scarps ------------------------------------------------------------------------
  useEffect(() => {
    const ds = dsRef.current.faults;
    const viewer = viewerRef.current;
    if (!ds || !viewer) return;
    ds.entities.removeAll();
    if (!layers.faults) { viewer.scene.requestRender(); return; }
    let live = true;
    getEngine().faults().then((fc) => {
      if (!live) return;
      const col = Color.fromCssColorString('#C792EA');
      for (const f of fc.features) {
        const g = f.geometry;
        const name = (f.properties?.name as string | null) ?? 'Lobate scarp';
        if (g?.type === 'LineString') {
          ds.entities.add({ name, polyline: { positions: g.coordinates.map(([lon, lat]) => pos(lat, lon)), width: 3, material: col, clampToGround: true } });
        } else if (g?.type === 'MultiLineString') {
          for (const line of g.coordinates) ds.entities.add({ name, polyline: { positions: line.map(([lon, lat]) => pos(lat, lon)), width: 3, material: col, clampToGround: true } });
        } else if (g?.type === 'Point') {
          ds.entities.add({ name, position: pos(g.coordinates[1], g.coordinates[0]), point: { pixelSize: 6, color: col, heightReference: HeightReference.CLAMP_TO_GROUND } });
        }
      }
      viewer.scene.requestRender();
    }).catch(() => {});
    return () => { live = false; };
  }, [layers.faults, ready]);

  // ---- keep-out circles --------------------------------------------------------------------
  useEffect(() => {
    const ds = dsRef.current.keepout;
    const viewer = viewerRef.current;
    if (!ds || !viewer) return;
    ds.entities.removeAll();
    if (layers.keepout) {
      const r = layers.keepoutKm * 1000;
      for (const s of sites.filter((x) => x.kind === 'landed')) {
        ds.entities.add({
          position: pos(s.lat, s.lon), name: `Keep-out ${s.name}`,
          ellipse: { semiMajorAxis: r, semiMinorAxis: r, material: Color.fromCssColorString('#FF4FD8').withAlpha(0.2) },
        });
      }
    }
    viewer.scene.requestRender();
  }, [layers.keepout, layers.keepoutKm, sites, ready]);

  // ---- landing ellipse -----------------------------------------------------------------------
  useEffect(() => {
    const ds = dsRef.current.ellipse;
    const viewer = viewerRef.current;
    if (!ds || !viewer) return;
    ds.entities.removeAll();
    if (ellipse) {
      const a = Math.max(ellipse.a, ellipse.b), b = Math.min(ellipse.a, ellipse.b);
      // semi-major axis azimuth = rot (clockwise from north); Cesium rotation is counter-clockwise from north
      const rot = ellipse.a >= ellipse.b ? -ellipse.rot : -(ellipse.rot + 90);
      ds.entities.add({
        position: pos(ellipse.lat, ellipse.lon), name: 'Landing ellipse',
        ellipse: { semiMajorAxis: a, semiMinorAxis: b, rotation: CMath.toRadians(rot), material: Color.fromCssColorString('#2EE6C5').withAlpha(0.4) },
      });
      viewer.camera.flyToBoundingSphere(new BoundingSphere(pos(ellipse.lat, ellipse.lon), a), { offset: new HeadingPitchRange(0, -CMath.PI_OVER_TWO * 0.85, a * 7), duration: 1.4 });
    }
    viewer.scene.requestRender();
  }, [ellipse, ready]);

  // ---- time cursor -> light direction, Sun and Earth billboards ------------------------------------
  const busy = useRef(false);
  const dirty = useRef<number | null>(null);
  const shadowToken = useRef(0);
  useEffect(() => {
    if (!ready) return;
    const apply = async (t: number) => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) return;
      const se = await getEngine().sunEarthAt(0, 0, t);
      if (viewer.isDestroyed()) return;
      const [sx, sy, sz] = se.sunVecMe;
      (viewer.scene.light as DirectionalLight).direction = new Cartesian3(-sx, -sy, -sz);
      const sp = skyRef.current!;
      sp.sun.position = new ConstantPositionProperty(Cartesian3.fromElements(sx * 3.8e8, sy * 3.8e8, sz * 3.8e8));
      const [ex, ey, ez] = se.earthVecMe;
      sp.earth.position = new ConstantPositionProperty(Cartesian3.fromElements(ex * 3.844e8, ey * 3.844e8, ez * 3.844e8));
      viewer.scene.requestRender();
    };
    const run = async (t: number) => {
      if (busy.current) { dirty.current = t; return; }
      busy.current = true;
      try { await apply(t); } catch (e) { console.warn(e); }
      busy.current = false;
      if (dirty.current !== null) { const n = dirty.current; dirty.current = null; run(n); }
    };
    run(cursor);
  }, [cursor, ready]);

  // ---- context layers from layers/manifest.json ----------------------------------------------
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    for (const d of layerDefs) {
      const st = layerState[d.id];
      let layer = imgLayers.current[d.id];
      if (st?.on && !layer) {
        const provider = new UrlTemplateImageryProvider({
          url: `/data/${d.path.replace('{z}', '{z}')}`,
          tilingScheme: new GeographicTilingScheme({ ellipsoid: MOON }), ellipsoid: MOON,
          rectangle: Rectangle.fromDegrees(...d.rectangle), maximumLevel: d.maxLevel, hasAlphaChannel: true,
        });
        // tiles north of tileLatLimits[level] do not exist: answer with a transparent tile instead of a 404
        const blank = document.createElement('canvas'); blank.width = blank.height = 1;
        const orig = provider.requestImage.bind(provider);
        provider.requestImage = (x: number, y: number, level: number, request?: never) => {
          const lim = d.tileLatLimits?.[String(level)];
          if (lim !== undefined) {
            const rect = provider.tilingScheme.tileXYToRectangle(x, y, level);
            if (CMath.toDegrees(rect.south) >= lim) return Promise.resolve(blank) as never;
          }
          const p = orig(x, y, level, request);
          return p ? (p as Promise<never>).catch(() => blank as never) : p;
        };
        layer = new ImageryLayer(provider, { alpha: st.opacity });
        imgLayers.current[d.id] = layer;
        viewer.imageryLayers.add(layer);
      }
      if (layer) { layer.show = !!st?.on; layer.alpha = st?.opacity ?? 1; }
    }
    viewer.scene.requestRender();
  }, [layerDefs, layerState, ready]);

  // ---- vertical exaggeration -----------------------------------------------------------------------
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.scene.verticalExaggeration = exaggeration;
    viewer.scene.requestRender();
  }, [exaggeration, ready]);

  // ---- terrain-true shadows (regional patch at the pole, local patch at the selected site) ------------
  const selTarget = selected ? targets[selected] : undefined;
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    const removeOld = () => { if (shadowLayer.current) { viewer.imageryLayers.remove(shadowLayer.current, true); shadowLayer.current = null; } viewer.scene.requestRender(); };
    if (!layers.shadows) { removeOld(); return; }
    const my = ++shadowToken.current;
    const timer = setTimeout(async () => {
      try {
        const local = regime === 'local';
        const cam = viewer.camera.positionCartographic;
        const lat = local ? (selTarget?.lat ?? CMath.toDegrees(cam.latitude)) : -90;
        const lon = local ? (selTarget?.lon ?? CMath.toDegrees(cam.longitude)) : 0;
        const patch: ShadowPatch = await getEngine().shadowPatch(lat, lon, local ? 30 : 650, 1024, cursor);
        if (my !== shadowToken.current || viewer.isDestroyed()) return;
        const layer = new ImageryLayer(new ShadowImageryProvider(patch) as unknown as ImageryProvider, { alpha: 1 });
        viewer.imageryLayers.add(layer);
        const old = shadowLayer.current;
        shadowLayer.current = layer;
        setShadowMock(!!patch.mock);
        setTimeout(() => { if (old && !viewer.isDestroyed()) { viewer.imageryLayers.remove(old, true); viewer.scene.requestRender(); } }, 250);
        viewer.scene.requestRender();
      } catch (e) { console.warn('[shadows]', e); }
    }, 120);
    return () => clearTimeout(timer);
  }, [layers.shadows, cursor, regime, selTarget?.lat, selTarget?.lon, ready]);

  // ---- fly requests ----------------------------------------------------------------------------------
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !fly || tokenRef.current === fly.nonce) return;
    tokenRef.current = fly.nonce;
    if (fly.global) {
      viewer.camera.flyTo({ destination: poleCam(), orientation: { heading: 0, pitch: -CMath.PI_OVER_TWO, roll: 0 }, duration: 1.6 });
      return;
    }
    const t = fly.id ? useStore.getState().targets[fly.id] : undefined;
    if (!t) return;
    viewer.camera.flyToBoundingSphere(new BoundingSphere(pos(t.lat, t.lon), 5000), {
      offset: new HeadingPitchRange(0, -CMath.PI_OVER_TWO * 0.8, 160000), duration: 1.6,
    });
  }, [fly]);

  const hv = hover ? targets[hover.id] : null;
  return (
    <div className="globe">
      <div ref={hostRef} className="globe-host" />
      {hover && hv && (
        <div className="tip" style={{ left: hover.x + 14, top: hover.y + 10 }}>
          <b>{hv.rank ? `#${hv.rank} ` : ''}{hv.name}</b>
          <span>{hv.lat.toFixed(3)}{'°'}, {hv.lon.toFixed(3)}{'°'}{hv.group ? ` · ${hv.group}` : ''}</span>
        </div>
      )}
      {layers.shadows && <div className={`shadow-flag ${shadowMock ? 'demo' : ''}`}>terrain-true shadows (LOLA){shadowMock ? ' \u00b7 demo patch' : ''} {'\u00b7'} {regime === 'local' ? '30 km' : '650 km'}{mode === 'mock' ? '' : ''}</div>}
      <div className="globe-btns">
        <button className="btn sm" onClick={() => flyTo(null, true)}>South pole / global</button>
        <button className="btn sm" disabled={!selected} onClick={() => selected && flyTo(selected)}>Fly to selection</button>
        <button className={`btn sm ${exaggeration > 1 ? 'on' : ''}`} title="Vertical exaggeration of terrain (hero shot)" onClick={() => useStore.setState({ exaggeration: exaggeration > 1 ? 1 : 3 })}>Relief {exaggeration}{'\u00d7'}</button>
        <button className={`btn sm ${layers.shadows ? 'on' : ''}`} onClick={() => useStore.setState({ layers: { ...layers, shadows: !layers.shadows } })}>Shadows</button>
      </div>
    </div>
  );
}
