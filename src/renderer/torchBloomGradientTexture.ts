import { Rectangle, Texture } from "pixi.js";

/** Bump when radial art changes so dev HMR / long sessions pick up a new texture. */
const GRADIENT_REVISION = 9;

export const TORCH_BLOOM_TEX_SIZE = 96;
/** Cleared ring so GPU clamp + linear filter never blends non‑zero glow into the bitmap edge (thin dark lines over cloud/sky alpha). */
export const TORCH_BLOOM_BORDER_PX = 2;

let cached: Texture | null = null;
let cachedRevision = 0;
let spriteTextureCached: Texture | null = null;
let spriteTextureRevision = -1;

/** Center opacity (0–1) before mesh/sprite alpha and tint. */
const BLOOM_PEAK_ALPHA = 0.36;
/** Outer radius as fraction of half the bitmap size (inside the cleared border). */
const BLOOM_RADIUS_FRAC = 0.88;
/** Warm torch tint in linear-ish sRGB 0–1. */
const BLOOM_RGB: readonly [number, number, number] = [1, 0.95, 0.82];

function smoothstep01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** UV range for {@link buildTorchBloomUnderlayMesh}: inset so samples stay off the cleared border. */
export function getTorchBloomMeshUvs(): {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
} {
  const w = TORCH_BLOOM_TEX_SIZE;
  const b = TORCH_BLOOM_BORDER_PX;
  const u0 = (b + 0.5) / w;
  const u1 = (w - b - 0.5) / w;
  return { u0, u1, v0: u0, v1: u1 };
}

/**
 * Held torch bloom: same atlas, frame crops the border so sprites never sample the edge texels.
 */
export function getTorchBloomSpriteTexture(): Texture {
  const base = getTorchBloomGradientTexture();
  if (spriteTextureCached !== null && spriteTextureRevision === GRADIENT_REVISION) {
    return spriteTextureCached;
  }
  spriteTextureCached?.destroy(false);
  const b = TORCH_BLOOM_BORDER_PX;
  const fw = base.width - 2 * b;
  const fh = base.height - 2 * b;
  spriteTextureCached = new Texture({
    source: base.source,
    frame: new Rectangle(b, b, fw, fh),
  });
  spriteTextureRevision = GRADIENT_REVISION;
  return spriteTextureCached;
}

/**
 * Shared radial bloom for placed / held torches: peak opacity at center → zero at edge
 * (smoothstep), premultiplied RGBA for Pixi `blendMode: "add"`.
 */
export function getTorchBloomGradientTexture(): Texture {
  if (cached !== null && cachedRevision === GRADIENT_REVISION) {
    return cached;
  }
  if (cached !== null) {
    spriteTextureCached?.destroy(false);
    spriteTextureCached = null;
    spriteTextureRevision = -1;
    if (cached !== Texture.WHITE) {
      cached.destroy(true);
    }
    cached = null;
  }

  const size = TORCH_BLOOM_TEX_SIZE;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (g === null) {
    cached = Texture.WHITE;
    cachedRevision = GRADIENT_REVISION;
    return cached;
  }

  const cx = (size - 1) * 0.5;
  const cy = (size - 1) * 0.5;
  const innerHalf = (size - 1) * 0.5 - TORCH_BLOOM_BORDER_PX;
  const outerR = Math.max(1, innerHalf * BLOOM_RADIUS_FRAC);
  const [br, bg, bb] = BLOOM_RGB;

  const imageData = g.createImageData(size, size);
  const d = imageData.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (
        x < TORCH_BLOOM_BORDER_PX ||
        y < TORCH_BLOOM_BORDER_PX ||
        x >= size - TORCH_BLOOM_BORDER_PX ||
        y >= size - TORCH_BLOOM_BORDER_PX
      ) {
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = 0;
        continue;
      }
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const t = outerR > 1e-6 ? dist / outerR : 1;
      const a = BLOOM_PEAK_ALPHA * (1 - smoothstep01(t));
      if (a < 1 / 255) {
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = 0;
        continue;
      }
      d[i] = Math.min(255, Math.round(br * a * 255));
      d[i + 1] = Math.min(255, Math.round(bg * a * 255));
      d[i + 2] = Math.min(255, Math.round(bb * a * 255));
      d[i + 3] = Math.min(255, Math.round(a * 255));
    }
  }
  g.putImageData(imageData, 0, 0);

  const tex = Texture.from(c);
  // Nearest avoids sub-texel fringe where bloom meets varying backdrop (cloud α seams).
  tex.source.scaleMode = "nearest";
  tex.source.alphaMode = "premultiplied-alpha";
  cached = tex;
  cachedRevision = GRADIENT_REVISION;
  return tex;
}
