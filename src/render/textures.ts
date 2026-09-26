import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();

function canvasTex(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, srgb = true) {
  if (cache.has(key)) return cache.get(key)!;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

export const glowTexture = () => canvasTex('glow', 128, (g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  r.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, s, s);
});

export const softTexture = () => canvasTex('soft', 64, (g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, s, s);
});

export const smokeTexture = () => canvasTex('smoke', 128, (g, s) => {
  for (let i = 0; i < 18; i++) {
    const x = s / 2 + (Math.random() - 0.5) * s * 0.4, y = s / 2 + (Math.random() - 0.5) * s * 0.4;
    const rad = s * (0.15 + Math.random() * 0.22);
    const r = g.createRadialGradient(x, y, 0, x, y, rad);
    r.addColorStop(0, 'rgba(255,255,255,0.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  }
});

export const ringTexture = () => canvasTex('ring', 256, (g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
  r.addColorStop(0, 'rgba(255,255,255,0)');
  r.addColorStop(0.72, 'rgba(255,255,255,0.15)');
  r.addColorStop(0.9, 'rgba(255,255,255,1)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, s, s);
});

export const sigilTexture = () => canvasTex('sigil', 256, (g, s) => {
  g.translate(s / 2, s / 2);
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 5;
  g.beginPath(); g.arc(0, 0, s * 0.46, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 3;
  g.beginPath(); g.arc(0, 0, s * 0.38, 0, Math.PI * 2); g.stroke();
  for (let k = 0; k < 2; k++) {
    g.beginPath();
    for (let i = 0; i <= 3; i++) {
      const a = (i / 3) * Math.PI * 2 + k * Math.PI / 3 - Math.PI / 2;
      const x = Math.cos(a) * s * 0.38, y = Math.sin(a) * s * 0.38;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
  }
  g.font = `${s * 0.07}px serif`;
  g.fillStyle = 'rgba(255,255,255,0.9)';
  const runes = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃ';
  for (let i = 0; i < 12; i++) {
    g.save(); g.rotate((i / 12) * Math.PI * 2); g.fillText(runes[i], -s * 0.02, -s * 0.405); g.restore();
  }
});

export const swirlTexture = () => canvasTex('swirl', 256, (g, s) => {
  g.translate(s / 2, s / 2);
  for (let arm = 0; arm < 4; arm++) {
    g.beginPath();
    for (let i = 0; i < 80; i++) {
      const t = i / 80;
      const a = arm * Math.PI / 2 + t * Math.PI * 2.2;
      const r = t * s * 0.48;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 10;
    g.stroke();
  }
  const r = g.createRadialGradient(0, 0, 0, 0, 0, s / 2);
  r.addColorStop(0, 'rgba(255,255,255,0.6)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = r; g.fillRect(-s / 2, -s / 2, s, s);
});

export const dashTexture = () => {
  const t = canvasTex('dash', 64, (g, s) => {
    g.clearRect(0, 0, s, s);
    const grd = g.createLinearGradient(0, 0, s, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.3, 'rgba(255,255,255,1)');
    grd.addColorStop(0.7, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, s * 0.25, s, s * 0.5);
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
};
