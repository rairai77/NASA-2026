// Procedural grey "Moon" used until real imagery tiles exist in /data/imagery/color/.
export function makeMoonCanvas(W = 4096, H = 2048): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  let s = 20260;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  g.fillStyle = '#8c8c8c';
  g.fillRect(0, 0, W, H);
  // broad albedo variation (maria / highlands)
  for (let i = 0; i < 90; i++) {
    const x = rnd() * W, y = (0.15 + 0.7 * rnd()) * H, r = 60 + rnd() * 380;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = rnd() < 0.6;
    grd.addColorStop(0, dark ? 'rgba(40,40,44,0.28)' : 'rgba(210,210,210,0.18)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  // craters in sphere space (stretched by 1/cos(lat) in the equirectangular map)
  const n = 5200;
  for (let i = 0; i < n; i++) {
    const latDeg = Math.asin(rnd() * 2 - 1) * 180 / Math.PI;
    const lonDeg = rnd() * 360 - 180;
    const rDeg = 0.08 + Math.pow(rnd(), 3.2) * 3.2;
    const x = ((lonDeg + 180) / 360) * W, y = ((90 - latDeg) / 180) * H;
    const stretch = Math.min(14, 1 / Math.max(0.07, Math.cos((latDeg * Math.PI) / 180)));
    const ry = (rDeg / 180) * H, rx = Math.max(ry, (rDeg / 360) * W * stretch);
    for (const dx of [0, -W, W]) {
      if (x + dx + rx < 0 || x + dx - rx > W) continue;
      g.save();
      g.translate(x + dx, y);
      g.scale(rx / ry, 1);
      const grd = g.createRadialGradient(0, 0, ry * 0.25, 0, 0, ry * 1.15);
      grd.addColorStop(0, 'rgba(60,60,64,0.38)');
      grd.addColorStop(0.7, 'rgba(70,70,74,0.25)');
      grd.addColorStop(0.86, 'rgba(235,235,235,0.34)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(0, 0, ry * 1.15, 0, 7); g.fill();
      g.restore();
    }
  }
  // fine grain
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (rnd() - 0.5) * 22;
    img.data[i] += v; img.data[i + 1] += v; img.data[i + 2] += v;
  }
  g.putImageData(img, 0, 0);
  return c;
}
