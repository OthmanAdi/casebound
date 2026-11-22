/**
 * The picture behind each book: a small generated landscape in the book's own colours. Sky, a low sun,
 * layers of ridges fading into haze, and a grain of short strokes so it reads as paint. No image files.
 */
import { hashString, seeded } from '../engine/core/math';

const mix = (a: string, b: string, t: number): string => {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const c = (s: number): number => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
};

export function paintBackdrop(base: string, seedText: string, width = 1408, height = 720): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  const rnd = seeded(hashString(seedText));

  const sky = g.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, mix(base, '#f3ead8', 0.72));
  sky.addColorStop(0.55, mix(base, '#e9d9c4', 0.5));
  sky.addColorStop(1, mix(base, '#2a2630', 0.25));
  g.fillStyle = sky;
  g.fillRect(0, 0, width, height);

  // Low sun.
  const sx = width * (0.2 + rnd() * 0.6);
  const sy = height * (0.28 + rnd() * 0.18);
  const glow = g.createRadialGradient(sx, sy, 0, sx, sy, height * 0.9);
  glow.addColorStop(0, 'rgba(255,244,214,0.75)');
  glow.addColorStop(0.25, 'rgba(255,230,190,0.28)');
  glow.addColorStop(1, 'rgba(255,230,190,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, width, height);

  // Ridges, far to near.
  const layers = 6;
  for (let i = 0; i < layers; i++) {
    const depth = i / (layers - 1);
    const baseY = height * (0.42 + depth * 0.5);
    const rough = height * (0.05 + depth * 0.06);
    g.beginPath();
    g.moveTo(0, height);
    let y = baseY + (rnd() - 0.5) * rough;
    g.lineTo(0, y);
    for (let x = 0; x <= width; x += width / (28 + i * 10)) {
      y += (rnd() - 0.5) * rough;
      y = baseY + (y - baseY) * 0.86;
      g.lineTo(x, y);
    }
    g.lineTo(width, height);
    g.closePath();
    g.fillStyle = mix(mix(base, '#efe6d6', 0.55 - depth * 0.45), '#17151b', depth * 0.5);
    g.globalAlpha = 0.9;
    g.fill();
  }
  g.globalAlpha = 1;

  // Brush grain: many short translucent strokes.
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * width;
    const y = rnd() * height;
    const len = 6 + rnd() * 26;
    const a = (rnd() - 0.5) * 0.9;
    g.strokeStyle = rnd() > 0.5 ? `rgba(255,255,255,${0.02 + rnd() * 0.05})` : `rgba(20,16,24,${0.02 + rnd() * 0.05})`;
    g.lineWidth = 1 + rnd() * 3;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  return canvas.toDataURL('image/jpeg', 0.86);
}
