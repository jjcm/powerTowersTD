// Packs the diffui PBR terrain set into two texture arrays so the terrain shader can blend
// nine full material layers with only two samplers:
//   colors[i] = albedo (sRGB)
//   data[i]   = normal.x, normal.y, roughness, height
import * as THREE from 'three';
import type { Assets } from './assets';

export const LAYERS = ['grass', 'forest', 'trampled', 'dirt', 'mud', 'rock', 'sand', 'scorched', 'cobble'] as const;
export type LayerId = (typeof LAYERS)[number];
const SIZE = 1024;

const FALLBACK: Record<LayerId, [number, number, number]> = {
  grass: [78, 154, 46], forest: [70, 120, 50], trampled: [150, 150, 80], dirt: [138, 106, 68], mud: [80, 62, 44],
  rock: [107, 113, 133], sand: [194, 173, 122], scorched: [58, 46, 36], cobble: [140, 140, 140],
};

async function pixels(url: string | undefined, fallback: number[]): Promise<Uint8ClampedArray> {
  if (url) {
    try {
      const blob = await (await fetch(url)).blob();
      const bmp = await createImageBitmap(blob, { resizeWidth: SIZE, resizeHeight: SIZE, resizeQuality: 'high' });
      const c = new OffscreenCanvas(SIZE, SIZE);
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(bmp, 0, 0);
      return g.getImageData(0, 0, SIZE, SIZE).data;
    } catch (e) { console.warn('terrain texture failed', url, e); }
  }
  const out = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) out.set([fallback[0], fallback[1], fallback[2], 255], i * 4);
  return out;
}

export interface TerrainArrays { colors: THREE.DataArrayTexture; data: THREE.DataArrayTexture }

let cache: Promise<TerrainArrays> | null = null;

export function loadTerrainArrays(assets: Assets, anisotropy: number): Promise<TerrainArrays> {
  if (cache) return cache;
  cache = (async () => {
    const n = LAYERS.length;
    const colors = new Uint8Array(SIZE * SIZE * 4 * n);
    const data = new Uint8Array(SIZE * SIZE * 4 * n);
    await Promise.all(LAYERS.map(async (id, li) => {
      const t = assets.manifest.textures[id] as Record<string, string> | undefined;
      const [c, nm, r, h] = await Promise.all([
        pixels(t?.color, FALLBACK[id]),
        pixels(t?.normal, [128, 128, 255]),
        pixels(t?.roughness, [215, 215, 215]),
        pixels(t?.height, [128, 128, 128]),
      ]);
      const off = li * SIZE * SIZE * 4;
      for (let i = 0; i < SIZE * SIZE; i++) {
        const k = i * 4;
        colors[off + k] = c[k]; colors[off + k + 1] = c[k + 1]; colors[off + k + 2] = c[k + 2]; colors[off + k + 3] = 255;
        data[off + k] = nm[k]; data[off + k + 1] = nm[k + 1]; data[off + k + 2] = r[k]; data[off + k + 3] = h[k];
      }
    }));
    const mk = (arr: Uint8Array, srgb: boolean) => {
      const t = new THREE.DataArrayTexture(arr, SIZE, SIZE, n);
      t.format = THREE.RGBAFormat;
      t.type = THREE.UnsignedByteType;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = anisotropy;
      t.needsUpdate = true;
      return t;
    };
    return { colors: mk(colors, true), data: mk(data, false) };
  })();
  return cache;
}
