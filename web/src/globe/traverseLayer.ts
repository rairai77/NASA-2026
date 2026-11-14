// Traverse planner drawing: start/goal pins and the planned path as a terrain-clamped polyline.
// Hooked into Globe.tsx with installTraverseLayer(viewer); everything else (state, picking) lives here and in store.ts.
import {
  Cartesian2, Cartesian3, Cartographic, Color, CustomDataSource, Ellipsoid, HeightReference, LabelStyle, Math as CMath,
  PolylineGlowMaterialProperty, ScreenSpaceEventHandler, ScreenSpaceEventType, VerticalOrigin, type Viewer,
} from 'cesium';
import { setTraverse, useStore } from '../store.ts';

const MOON = Ellipsoid.MOON;
const pos = (lat: number, lon: number) => Cartesian3.fromDegrees(lon, lat, 0, MOON);

export function installTraverseLayer(viewer: Viewer): () => void {
  const ds = new CustomDataSource('traverse');
  viewer.dataSources.add(ds);
  const scene = viewer.scene;
  const canvas = scene.canvas;

  const redraw = () => {
    ds.entities.removeAll();
    const s = useStore.getState();
    const { goal, result, startId } = s.traverse;
    const start = s.selected ? s.targets[s.selected] : undefined;
    if (start && (goal || result)) {
      ds.entities.add({
        id: 'trv:start', name: 'sel', position: pos(start.lat, start.lon),
        point: { pixelSize: 9, color: Color.fromCssColorString('#3ddc97'), outlineColor: Color.BLACK, outlineWidth: 2, heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { text: 'start', font: '600 12px ui-sans-serif, system-ui, sans-serif', fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: new Cartesian2(0, -10), heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      });
    }
    if (goal) {
      ds.entities.add({
        id: 'trv:goal', name: 'sel', position: pos(goal.lat, goal.lon),
        point: { pixelSize: 9, color: Color.fromCssColorString('#ff6b6b'), outlineColor: Color.BLACK, outlineWidth: 2, heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { text: 'goal', font: '600 12px ui-sans-serif, system-ui, sans-serif', fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: new Cartesian2(0, -10), heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      });
    }
    if (result && result.path.length > 1 && startId === s.selected) {
      ds.entities.add({
        id: 'trv:path', name: 'sel',
        polyline: {
          positions: result.path.map((p) => pos(p.lat, p.lon)), width: 5, clampToGround: true,
          material: new PolylineGlowMaterialProperty({ glowPower: 0.25, color: Color.fromCssColorString(result.status === 'ok' ? '#22d3ee' : '#f59e0b') }),
        },
      });
    }
    scene.requestRender();
  };

  // click on the globe while "pick goal" is armed
  const handler = new ScreenSpaceEventHandler(canvas);
  handler.setInputAction((m: { position: Cartesian2 }) => {
    if (!useStore.getState().traverse.picking) return;
    const ray = viewer.camera.getPickRay(m.position);
    const hit = ray ? scene.globe.pick(ray, scene) : undefined;
    if (!hit) return;
    const c = Cartographic.fromCartesian(hit, MOON);
    setTraverse({ goal: { lat: CMath.toDegrees(c.latitude), lon: CMath.toDegrees(c.longitude) }, picking: false, result: null, error: null });
  }, ScreenSpaceEventType.LEFT_CLICK);

  const unsub = useStore.subscribe((s, p) => {
    if (s.traverse.goal !== p.traverse.goal || s.traverse.result !== p.traverse.result || s.selected !== p.selected || s.traverse.startId !== p.traverse.startId) redraw();
    if (s.traverse.picking !== p.traverse.picking) canvas.style.cursor = s.traverse.picking ? 'crosshair' : '';
    // while picking a goal, clicks on pins must not change the selected start
    if (s.traverse.picking && s.selected !== p.selected) useStore.setState({ selected: p.selected });
  });
  redraw();
  return () => {
    unsub(); handler.destroy();
    try { viewer.dataSources.remove(ds, true); } catch { /* viewer already destroyed */ }
  };
}
