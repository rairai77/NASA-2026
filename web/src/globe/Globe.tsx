import './cesiumSetup.ts';
import { useEffect, useRef, useState } from 'react';
import {
  BillboardGraphics, Cartesian2, Cartesian3, Color, ConstantPositionProperty, CustomDataSource, DirectionalLight,
  Ellipsoid, Entity, GeographicTilingScheme, HorizontalOrigin, Math as CMath, NearFarScalar,
  ScreenSpaceEventHandler, ScreenSpaceEventType, SingleTileImageryProvider, UrlTemplateImageryProvider, VerticalOrigin, Viewer,
  ImageryLayer, type ImageryProvider, Rectangle, HeightReference, ColorMaterialProperty, DistanceDisplayCondition, LabelStyle,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { cancelShadow, getEngine, isShadowCached, requestShadow, type ShadowReq } from '../engine/client.ts';
import { perfLog } from '../engine/perf.ts';
import { flyTo, select, useStore } from '../store.ts';
import { syncFirstPerson } from './firstPerson3d.ts'; // 3D first-person ("Stand here")
import { createTerrainProvider } from './terrain.ts';
import { getOrbitControls, installOrbitControls } from './orbitControls.ts';
import { installTraverseLayer } from './traverseLayer.ts';
import { ShadowImageryProvider } from './shadowProvider.ts';
import { POLE_PLAN, computePlans, formatRes, needsReplan, type ShadowPlan } from './shadowPlan.ts';
import { makeMoonCanvas } from './moonTexture.ts';
import { addDetailImagery } from './baseImagery.ts';
import { Crosshair, House, Layers as LayersIcon, Minus, Mountain, Plus, Rotate3d, Sun } from 'lucide-react';
import { IconButton, Spinner, Tag } from '../components/ui.tsx';
import { METRIC_BY_NAME } from '../query/metrics.ts';
import { placeFor, shortName } from '../lib/places.ts';

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

// Default / "Pole view": top-down over the south pole (see orbitControls.home()); the view axis passes through the Moon's centre.
// The altitude keeps the camera above the 350 km "local" threshold so the 650 km regional shadow patch is used.
const TILT_ON_DEG = 50;
const RELIEF_STEPS = [1, 2, 4];

function pos(lat: number, lon: number, h = 0) { return Cartesian3.fromDegrees(lon, lat, h, MOON); }

const GOLD = '#f5c542';
function numberedPin(n: number, selected: boolean, hovered: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gold = n === 1;
  g.beginPath(); g.arc(32, 32, 24, 0, 7);
  g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 6; g.shadowOffsetY = 1;
  g.fillStyle = gold ? GOLD : '#f1f4f9'; g.fill();
  g.shadowColor = 'transparent';
  g.lineWidth = 3; g.strokeStyle = selected ? GOLD : hovered ? '#ffffff' : 'rgba(10,13,19,0.9)'; g.stroke();
  if (selected) { g.beginPath(); g.arc(32, 32, 28.5, 0, 7); g.lineWidth = 3; g.strokeStyle = GOLD; g.stroke(); }
  g.fillStyle = '#10141c';
  g.font = '700 27px "Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 32, 33);
  return c;
}

function ringCanvas(color = GOLD): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.beginPath(); g.arc(32, 32, 27, 0, 7);
  g.lineWidth = 7; g.strokeStyle = 'rgba(10,13,19,0.7)'; g.stroke();
  g.beginPath(); g.arc(32, 32, 27, 0, 7);
  g.lineWidth = 3.5; g.strokeStyle = color; g.stroke();
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
  const [shadowBusy, setShadowBusy] = useState(false);
  const hoveredId = useStore((s) => s.hoveredId);
  const query = useStore((s) => s.query);
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
  const imgLayers = useRef<Record<string, ImageryLayer>>({});
  const [regime, setRegime] = useState<'regional' | 'local'>('regional');
  const [shadowMock, setShadowMock] = useState(false);
  const [tilted, setTilted] = useState(false);

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
    const disposeTraverse = installTraverseLayer(viewer);
    if (import.meta.env.DEV) (window as unknown as { __viewer: Viewer }).__viewer = viewer;
    const scene = viewer.scene;
    scene.globe.show = true;
    scene.globe.showGroundAtmosphere = false;
    scene.globe.enableLighting = true;
    scene.globe.depthTestAgainstTerrain = true;
    scene.globe.maximumScreenSpaceError = 2;
    // render at device resolution (crisp on retina screens), capped at 2x
    viewer.useBrowserRecommendedResolution = false;
    viewer.resolutionScale = Math.min(1, 2 / (window.devicePixelRatio || 1));
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
      viewer.imageryLayers.add(new ImageryLayer(provider), 0);
      addDetailImagery(viewer);
      scene.requestRender();
    })();

    // camera: restore or south pole hero
    const cam = useStore.getState().initialCam;
    if (cam) {
      viewer.camera.setView({ destination: new Cartesian3(cam.p[0] + 1, cam.p[1] + 1, cam.p[2]), orientation: { direction: new Cartesian3(...cam.d), up: new Cartesian3(...cam.u) } });
    }
    // Moon-centred orbit controls own all camera input; they adopt the restored camera, or start top-down over the pole.
    const orbit = installOrbitControls(viewer);
    if (!cam) orbit.home(true);
    viewer.camera.percentageChanged = 0.005;
    const updCam = () => {
      const c = viewer.camera;
      latestCam = { p: r3(c.positionWC), d: r4(c.directionWC), u: r4(c.upWC) };
      setRegime(c.positionCartographic.height < 3.5e5 ? 'local' : 'regional');
      setTilted((getOrbitControls()?.getTilt() ?? 0) > 10);
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
    let lastPick = 0, pendingMove: ReturnType<typeof setTimeout> | null = null;
    const onMove = (p: Cartesian2) => {
      if (getOrbitControls()?.isInteracting()) return;
      const id = pickId(p);
      scene.canvas.style.cursor = id ? 'pointer' : '';
      setHover((h) => (id ? { id, x: p.x, y: p.y } : h ? null : h));
    };
    handler.setInputAction((m: { endPosition: Cartesian2 }) => {
      const p = Cartesian2.clone(m.endPosition);
      const wait = 70 - (performance.now() - lastPick);
      if (pendingMove) clearTimeout(pendingMove);
      if (wait <= 0) { lastPick = performance.now(); onMove(p); pendingMove = null; }
      else pendingMove = setTimeout(() => { lastPick = performance.now(); pendingMove = null; onMove(p); }, wait);
    }, ScreenSpaceEventType.MOUSE_MOVE);
    const onLeave = () => { if (pendingMove) clearTimeout(pendingMove); setHover(null); };
    scene.canvas.addEventListener('mouseleave', onLeave);
    handler.setInputAction((m: { position: Cartesian2 }) => {
      const id = pickId(m.position);
      if (id) select(id);
    }, ScreenSpaceEventType.LEFT_CLICK);

    const ro = new ResizeObserver(() => { viewer.resize(); scene.requestRender(); });
    ro.observe(host);
    setReady(true);
    return () => {
      ro.disconnect(); scene.canvas.removeEventListener('mouseleave', onLeave); if (pendingMove) clearTimeout(pendingMove); handler.destroy(); orbit.destroy(); disposeTraverse(); viewer.destroy(); viewerRef.current = null; setReady(false);
    };
  }, []);

  // ---- curated site pins (catalog: small and quiet; ranked results below are the dominant markers) -----------
  useEffect(() => {
    const ds = dsRef.current.sites;
    const viewer = viewerRef.current;
    if (!ds || !viewer) return;
    ds.entities.removeAll();
    if (layers.sites) {
      const ranked = new Set((layers.results && results ? results.results : []).map((r) => r.id).filter(Boolean));
      for (const s of sites) {
        if (ranked.has(s.id)) continue; // drawn as a numbered pin instead
        ds.entities.add({
          id: s.id, name: s.name, position: pos(s.lat, s.lon),
          point: {
            pixelSize: 6, color: Color.fromCssColorString(GROUP_COLORS[s.group] ?? GROUP_COLORS.Other).withAlpha(0.7),
            outlineColor: Color.fromCssColorString('#0a0d13').withAlpha(0.8), outlineWidth: 1.5,
            heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 1.5e6,
            scaleByDistance: new NearFarScalar(3e4, 1.5, 1.5e7, 0.5),
            translucencyByDistance: new NearFarScalar(2e6, 0.9, 1.2e7, 0.4),
          },
        });
      }
    }
    viewer.scene.requestRender();
  }, [sites, results, selected, layers.sites, layers.results, ready]);

  // ---- ranked result pins ---------------------------------------------------------------
  useEffect(() => {
    const ds = dsRef.current.results;
    const viewer = viewerRef.current;
    if (!ds || !viewer) return;
    ds.entities.removeAll();
    if (layers.results && results) {
      for (const r of results.results) {
        const id = r.id ?? `r:${r.lat.toFixed(4)},${r.lon.toFixed(4)}`;
        const sel = id === selected;
        const hov = id === hoveredId;
        const size = sel ? 40 : hov ? 38 : 32;
        ds.entities.add({
          id: `res:${id}`, name: `#${r.rank}`, position: pos(r.lat, r.lon),
          billboard: {
            image: numberedPin(r.rank, sel, hov), width: size, height: size, verticalOrigin: VerticalOrigin.CENTER, horizontalOrigin: HorizontalOrigin.CENTER,
            heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 1.5e6, eyeOffset: new Cartesian3(0, 0, sel ? -900 : hov ? -700 : -400),
            scaleByDistance: new NearFarScalar(3e4, 1.35, 1.2e7, 0.75),
          },
        });
      }
    }
    viewer.scene.requestRender();
  }, [results, layers.results, selected, hoveredId, ready]);

  // selection ring + name: last data source, so it draws on top of every other pin
  useEffect(() => {
    const ds = dsRef.current.sel;
    const viewer = viewerRef.current;
    if (!ds || !viewer) return;
    ds.entities.removeAll();
    const ht = hoveredId && hoveredId !== selected ? targets[hoveredId] : undefined;
    if (ht) {
      ds.entities.add({
        id: 'hov-ring', name: 'sel', position: pos(ht.lat, ht.lon),
        billboard: { image: ringCanvas('#ffffff'), width: 46, height: 46, heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 1.5e6, eyeOffset: new Cartesian3(0, 0, -1000), scaleByDistance: new NearFarScalar(3e4, 1.2, 1.2e7, 0.8) },
      });
    }
    const t = selected ? targets[selected] : undefined;
    if (t) {
      ds.entities.add({
        id: 'sel-ring', name: 'sel', position: pos(t.lat, t.lon),
        billboard: {
          image: ringCanvas(), width: 46, height: 46, heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 1.5e6,
          eyeOffset: new Cartesian3(0, 0, -1200), scaleByDistance: new NearFarScalar(3e4, 1.2, 1.2e7, 0.8),
        },
        label: {
          text: `${t.rank ? `#${t.rank} ` : ''}${t.kind === 'site' ? shortName(t.name) : placeFor(t.lat, t.lon, useStore.getState().sites).title}`, font: '600 12px "Inter Variable", ui-sans-serif, system-ui, sans-serif', style: LabelStyle.FILL,
          fillColor: Color.fromCssColorString(GOLD), showBackground: true, backgroundColor: Color.fromCssColorString('rgba(10,13,19,0.86)'),
          backgroundPadding: new Cartesian2(8, 5), verticalOrigin: VerticalOrigin.BOTTOM, horizontalOrigin: HorizontalOrigin.LEFT, pixelOffset: new Cartesian2(26, -6), heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: 1.5e6, distanceDisplayCondition: new DistanceDisplayCondition(0, 6e6),
        },
      });
    }
    viewer.scene.requestRender();
  }, [selected, targets, hoveredId, ready]);

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
      getOrbitControls()?.flyTo({ lat: ellipse.lat, lon: ellipse.lon, range: a * 6, tilt: 0, duration: 1.4 });
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

  // ---- terrain-true shadows (regional patch at the pole; local patches that follow the view) ---------------------
  const selTarget = selected ? targets[selected] : undefined;
  const fpActive = useStore((s) => (s as unknown as { fpActive?: boolean }).fpActive === true);
  const lastShadowRun = useRef(0);
  const [plans, setPlans] = useState<ShadowPlan[]>([POLE_PLAN]);
  const planRef = useRef<ShadowPlan[]>([]);
  const shadowSlots = useRef<Record<string, { layer: ImageryLayer; provider: ShadowImageryProvider }>>({});
  const [shadowInfo, setShadowInfo] = useState<Record<string, { km: number; m: number }>>({});
  // Which patches to compute: re-evaluated when the camera stops moving; recomputed only once the view centre has
  // moved more than 30% of the patch radius (or the size/resolution step, selection or mode changed).
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready || !layers.shadows) return;
    const update = () => {
      if (viewer.isDestroyed()) return;
      const next = computePlans(viewer, selTarget, fpActive);
      if (!planRef.current.length || needsReplan(planRef.current, next)) { planRef.current = next; setPlans(next); }
    };
    update();
    viewer.camera.moveEnd.addEventListener(update);
    return () => { viewer.camera.moveEnd.removeEventListener(update); };
  }, [ready, layers.shadows, regime, selTarget?.lat, selTarget?.lon, fpActive]);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    const slots = shadowSlots.current;
    const dropSlot = (slot: string) => {
      const s = slots[slot];
      cancelShadow(slot);
      if (!s) return;
      delete slots[slot];
      if (!viewer.isDestroyed()) viewer.imageryLayers.remove(s.layer, true);
      s.provider.dispose();
      setShadowInfo((i) => { const n = { ...i }; delete n[slot]; return n; });
    };
    const my = ++shadowToken.current;
    if (!layers.shadows) {
      for (const k of Object.keys(slots)) dropSlot(k);
      setShadowBusy(false);
      if (!viewer.isDestroyed()) viewer.scene.requestRender();
      return;
    }
    for (const k of Object.keys(slots)) if (!plans.some((p) => p.slot === k)) dropSlot(k);
    const reqs: ShadowReq[] = plans.map((p) => ({ slot: p.slot, lat: p.lat, lon: p.lon, sizeKm: p.sizeKm, px: p.px, t: cursor }));
    setShadowBusy(true);
    // Throttled while scrubbing/playing (~2 patches per second); cached patches show immediately.
    const delay = reqs.every(isShadowCached) ? 0 : Math.max(120, 450 - (performance.now() - lastShadowRun.current));
    const timer = setTimeout(() => {
      lastShadowRun.current = performance.now();
      let left = reqs.length;
      for (const r of reqs) {
        const t0 = performance.now();
        requestShadow(r, ({ patch, final, cached }) => {
          if (viewer.isDestroyed()) return;
          perfLog('main.shadow', performance.now() - t0, { slot: r.slot, sizeKm: r.sizeKm, px: patch.px, final, cached });
          const provider = new ShadowImageryProvider(patch);
          const layer = new ImageryLayer(provider as unknown as ImageryProvider, { alpha: 1 });
          viewer.imageryLayers.add(layer);
          const old = slots[r.slot];
          slots[r.slot] = { layer, provider };
          setShadowMock(!!patch.mock);
          setShadowInfo((i) => ({ ...i, [r.slot]: { km: patch.sizeKm, m: (patch.sizeKm * 1000) / patch.px } }));
          if (old) setTimeout(() => { if (!viewer.isDestroyed()) { viewer.imageryLayers.remove(old.layer, true); viewer.scene.requestRender(); } old.provider.dispose(); }, 250);
          viewer.scene.requestRender();
        }).then(() => { if (--left === 0 && my === shadowToken.current) setShadowBusy(false); });
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [layers.shadows, cursor, plans, ready]);

  // ---- fly requests ----------------------------------------------------------------------------------
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !fly || tokenRef.current === fly.nonce) return;
    tokenRef.current = fly.nonce;
    if (fly.global) {
      getOrbitControls()?.home();
      return;
    }
    const t = fly.id ? useStore.getState().targets[fly.id] : undefined;
    if (!t) return;
    (async () => {
      // Pan to the site top-down and north-up: the target lands at screen centre on the line through the Moon's centre,
      // so dragging still rotates the Moon about its centre. The orbit controls keep the camera clear of the terrain.
      if (viewer.isDestroyed() || tokenRef.current !== fly.nonce) return;
      await getOrbitControls()?.flyTo({ lat: t.lat, lon: t.lon, range: 28000, tilt: 0, heading: 0, duration: 2 });
    })();
  }, [fly]);

  // ---- 3D first-person ("Stand here"): camera at the selected site; see firstPerson3d.ts -------------------
  const fpOpen = useStore((s) => s.fpOpen);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    void syncFirstPerson(viewer, fpOpen);
  }, [fpOpen, selected, ready]);
  useEffect(() => () => { const v = viewerRef.current; if (v && !v.isDestroyed()) void syncFirstPerson(v, false); }, []);

  const hv = hover ? targets[hover.id] : null;
  const objM = query.objectives?.[0]?.metric;
  const mdef = objM ? METRIC_BY_NAME[objM] : undefined;
  const mval = hv && objM ? hv.metrics?.[objM] : undefined;
  const keyMetric = mdef && typeof mval === 'number' ? `${mdef.label} ${mval.toFixed(mdef.digits)}${mdef.unit ? ' ' + mdef.unit : ''}` : null;
  const cycleRelief = () => {
    const i = RELIEF_STEPS.indexOf(exaggeration);
    useStore.setState({ exaggeration: RELIEF_STEPS[(i + 1) % RELIEF_STEPS.length] });
  };
  const nextRelief = RELIEF_STEPS[(RELIEF_STEPS.indexOf(exaggeration) + 1) % RELIEF_STEPS.length];
  return (
    <div className="globe">
      <div ref={hostRef} className="globe-host" />
      {hover && hv && (
        <div className="gl-tip" style={{ left: hover.x + 14, top: hover.y + 12 }}>
          <b>{hv.rank ? <span className={`gl-rank ${hv.rank === 1 ? 'gold' : ''}`}>{hv.rank}</span> : null}{hv.kind === 'site' ? shortName(hv.name) : placeFor(hv.lat, hv.lon, sites).title}</b>
          <span>{keyMetric ?? `${hv.lat.toFixed(2)}\u00b0, ${hv.lon.toFixed(2)}\u00b0${hv.group ? ` \u00b7 ${hv.group}` : ''}`}</span>
        </div>
      )}
      <div className="gl-toolbar" role="toolbar" aria-label="Map controls">
        <IconButton solid tip="left" icon={Plus} label="Zoom in" onClick={() => getOrbitControls()?.zoomBy(1.7)} />
        <IconButton solid tip="left" icon={Minus} label="Zoom out" onClick={() => getOrbitControls()?.zoomBy(1 / 1.7)} />
        <IconButton solid tip="left" icon={House} label="Pole view" onClick={() => flyTo(null, true)} />
        <IconButton solid tip="left" icon={Crosshair} label="Fly to selection" disabled={!selected} onClick={() => selected && flyTo(selected)} />
        <IconButton solid tip="left" icon={Rotate3d} label={tilted ? 'Top-down view' : 'Tilt view (oblique)'} active={tilted}
          onClick={() => { const oc = getOrbitControls(); if (oc) oc.setTilt(oc.getTilt() > 10 ? 0 : TILT_ON_DEG); }} />
        <IconButton solid tip="left" icon={Sun} label={layers.shadows ? 'Terrain-true shadows: on' : 'Terrain-true shadows: off'} active={layers.shadows}
          onClick={() => useStore.setState({ layers: { ...layers, shadows: !layers.shadows } })} />
        <span className="gl-relief">
          <IconButton solid tip="left" icon={Mountain} label={`Relief ${exaggeration}\u00d7 (click for ${nextRelief}\u00d7)`} active={exaggeration > 1} onClick={cycleRelief} />
          <i className="gl-badge" aria-hidden>{exaggeration}{'\u00d7'}</i>
        </span>
        <IconButton solid tip="left" icon={LayersIcon} label="Layers" onClick={() => useStore.setState({ leftTab: 'layers' })} />
      </div>
      {layers.shadows && (
        <div className="gl-status" role="status">
          {shadowBusy && <Spinner />}
          <span>Terrain-true shadows {'\u00b7'} {(['view', 'site'] as const).filter((k) => shadowInfo[k]).map((k) => `${k === 'site' ? '+ ' : ''}${shadowInfo[k].km} km @ ${formatRes(shadowInfo[k].m)}`).join(' ')} {'\u00b7'} LOLA</span>
          {shadowMock && <Tag tone="warn">demo patch</Tag>}
        </div>
      )}
    </div>
  );
}
