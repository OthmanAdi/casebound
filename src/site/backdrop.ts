/**
 * The picture behind each book: a small generated landscape in the book's own hue. A pale sky, a low sun,
 * ridges that deepen in colour as they come closer, and a grain of short strokes so it reads as paint.
 * No image files.
 */
import { hashString, seeded } from '../engine/core/math';

/** Hue, saturation and lightness of a hex colour, each 0..1 (hue 0..360). */
function toHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

const hsl = (h: number, s: number, l: number, a = 1): string => `hsla(${((h % 360) + 360) % 360},${Math.round(Math.max(0, Math.min(1, s)) * 100)}%,${Math.round(Math.max(0, Math.min(1, l)) * 100)}%,${a})`;

export function paintBackdrop(base: string, seedText: string, width = 1408, height = 720): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  const rnd = seeded(hashString(seedText));
  const [h, s] = toHsl(base);
  const warm = h + (rnd() > 0.5 ? 28 : -24);

  // Sky: pale at the top, warming toward the horizon.
  const horizon = height * (0.5 + rnd() * 0.08);
  const sky = g.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, hsl(h, s * 0.35, 0.8));
  sky.addColorStop(0.6, hsl(h - 12, s * 0.3, 0.86));
  sky.addColorStop(1, hsl(warm + 20, 0.5, 0.88));
  g.fillStyle = sky;
  g.fillRect(0, 0, width, height);

  // Low sun and its glow.
  const sx = width * (0.18 + rnd() * 0.64);
  const sy = horizon - height * (0.04 + rnd() * 0.1);
  const glow = g.createRadialGradient(sx, sy, 0, sx, sy, height * 0.85);
  glow.addColorStop(0, 'rgba(255,246,222,0.95)');
  glow.addColorStop(0.08, 'rgba(255,238,205,0.6)');
  glow.addColorStop(0.4, 'rgba(255,226,190,0.16)');
  glow.addColorStop(1, 'rgba(255,226,190,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, width, height);

  // Soft cloud bands.
  for (let i = 0; i < 9; i++) {
    const y = horizon * (0.12 + rnd() * 0.7);
    const w = width * (0.25 + rnd() * 0.5);
    const x = rnd() * width;
    const band = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    band.addColorStop(0, 'rgba(255,255,255,0)');
    band.addColorStop(0.5, `rgba(255,252,244,${0.1 + rnd() * 0.16})`);
    band.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = band;
    g.fillRect(x - w / 2, y, w, 6 + rnd() * 22);
  }

  // Ridges, far to near: pale and grey in the distance, deep and full in front.
  const layers = 7;
  for (let i = 0; i < layers; i++) {
    const depth = i / (layers - 1);
    const baseY = horizon + (height - horizon) * (depth * 0.86) - height * 0.02;
    const rough = height * (0.035 + depth * 0.07);
    g.beginPath();
    g.moveTo(0, height);
    let y = baseY + (rnd() - 0.5) * rough;
    g.lineTo(0, y);
    const step = width / (22 + i * 9);
    for (let x = 0; x <= width + step; x += step) {
      y += (rnd() - 0.5) * rough;
      y = baseY + (y - baseY) * 0.84;
      g.lineTo(x, y);
    }
    g.lineTo(width, height);
    g.closePath();
    const fill = g.createLinearGradient(0, baseY - rough, 0, height);
    fill.addColorStop(0, hsl(h + depth * 10, s * (0.25 + depth * 0.6), 0.74 - depth * 0.46));
    fill.addColorStop(1, hsl(h + depth * 16, s * (0.3 + depth * 0.6), 0.66 - depth * 0.44));
    g.fillStyle = fill;
    g.fill();
  }

  // Brush grain: many short translucent strokes, lighter above the horizon, darker below.
  for (let i = 0; i < 3200; i++) {
    const x = rnd() * width;
    const y = rnd() * height;
    const len = 5 + rnd() * 24;
    const a = (rnd() - 0.5) * 0.8;
    const light = rnd() > (y < horizon ? 0.35 : 0.6);
    g.strokeStyle = light ? `rgba(255,250,240,${0.03 + rnd() * 0.06})` : `rgba(22,18,28,${0.03 + rnd() * 0.06})`;
    g.lineWidth = 1 + rnd() * 3;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  return canvas.toDataURL('image/jpeg', 0.88);
}
