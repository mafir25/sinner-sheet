// Экспорт: PNG / JPG / WebP и Universal VTT (.dd2vtt). docs/map-editor.md §6.
import JSZip from 'jszip';
import type { AssetStore } from '../assets/store';
import type { Floor, MapDoc, Portal } from '../model/types';
import { renderMap } from '../render/render';
import { wallChains } from '../geom/walls';
import { safeName, usedAssetKeys } from '../storage/file';

export type ExportFormat = 'png' | 'jpg' | 'webp' | 'dd2vtt';
export type WindowMode = 'gap' | 'wall' | 'door';
export type ExportOpts = {
  format: ExportFormat; ppc: number; grid: boolean; floors: 'current' | 'all'; windows: WindowMode; quality: number;
  /** Крыши поверх карты (вид снаружи). */
  roofs: boolean;
  /** Запечь освещение в картинку. Для VTT с динамическим светом обычно выключают. */
  bakeLight: boolean;
  /** Мастерская версия: с подписями и слоями «только для мастера». */
  gm: boolean;
};
export type RenderFlags = Pick<ExportOpts, 'roofs' | 'bakeLight' | 'gm'>;

/** Ограничение браузеров на размер холста. */
export const MAX_SIDE = 16384;
export const MAX_AREA = 268_000_000;
export const fits = (doc: MapDoc, ppc: number) =>
  doc.width * ppc <= MAX_SIDE && doc.height * ppc <= MAX_SIDE && doc.width * doc.height * ppc * ppc <= MAX_AREA;

const MIME: Record<Exclude<ExportFormat, 'dd2vtt'>, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

export async function renderFloorCanvas(doc: MapDoc, floorId: string, assets: AssetStore, ppc: number, grid: boolean, flags: RenderFlags): Promise<HTMLCanvasElement> {
  await assets.whenLoaded([...usedAssetKeys(doc)]);
  const c = document.createElement('canvas');
  c.width = Math.round(doc.width * ppc);
  c.height = Math.round(doc.height * ppc);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.setTransform(ppc, 0, 0, ppc, 0, 0);
  renderMap(ctx, doc, floorId, assets, {
    scale: ppc, view: { x0: 0, y0: 0, x1: doc.width, y1: doc.height }, grid, ghost: false,
    gridPx: Math.max(1, Math.round(ppc / 70)),
    roofs: flags.roofs ? 'show' : 'hide', lighting: flags.bakeLight, gm: flags.gm, exporting: true,
  });
  return c;
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), type, q));

const blobToBase64 = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

const P = (x: number, y: number) => ({ x: Math.round(x * 1e4) / 1e4, y: Math.round(y * 1e4) / 1e4 });

function vttPortal(p: Portal, closed: boolean) {
  return {
    position: P((p.a.x + p.b.x) / 2, (p.a.y + p.b.y) / 2),
    bounds: [P(p.a.x, p.a.y), P(p.b.x, p.b.y)],
    rotation: Math.atan2(p.b.y - p.a.y, p.b.x - p.a.x),
    closed,
    freestanding: false,
  };
}

const argb = (hex: string, alpha = 'ff') => `${alpha}${(/^#?([\da-f]{6})$/i.exec(hex.trim())?.[1] ?? 'ffffff').toLowerCase()}`;

/** Документ Universal VTT для этажа. image — PNG в base64. baked — освещение уже запечено в картинку. */
export function buildDd2vtt(doc: MapDoc, f: Floor, ppc: number, image: string, windows: WindowMode, baked = false) {
  const gaps = new Set<Portal['kind']>(windows === 'wall' ? ['door'] : ['door', 'window']);
  const los = wallChains(f, gaps).map((c) => { const pts = c.pts.map((q) => P(q.x, q.y)); return c.closed ? [...pts, pts[0]] : pts; });
  const portals = f.portals
    .filter((p) => !!p.asset && (p.kind === 'door' || (p.kind === 'window' && windows === 'door')))
    .map((p) => vttPortal(p, true));
  return {
    format: 0.3,
    resolution: { map_origin: P(0, 0), map_size: P(doc.width, doc.height), pixels_per_grid: ppc },
    line_of_sight: los,
    objects_line_of_sight: [],
    portals,
    environment: { baked_lighting: baked, ambient_light: ambient(doc) },
    lights: f.lights.map((l) => ({
      position: P(l.x, l.y), range: Math.round(l.radius * 100) / 100, intensity: l.intensity, color: argb(l.color), shadows: l.shadows,
    })),
    image,
  };
}

/** Общий свет карты для VTT: без освещения — полный день. */
function ambient(doc: MapDoc): string {
  if (!doc.lighting.enabled) return 'ffffffff';
  const v = Math.round(255 * (1 - doc.lighting.darkness)).toString(16).padStart(2, '0');
  return `ff${v}${v}${v}`;
}

async function exportFloor(doc: MapDoc, f: Floor, assets: AssetStore, o: ExportOpts): Promise<{ blob: Blob; ext: string }> {
  const canvas = await renderFloorCanvas(doc, f.id, assets, o.ppc, o.grid, o);
  if (o.format === 'dd2vtt') {
    const png = await toBlob(canvas, 'image/png');
    const json = buildDd2vtt(doc, f, o.ppc, await blobToBase64(png), o.windows, o.bakeLight && doc.lighting.enabled);
    return { blob: new Blob([JSON.stringify(json)], { type: 'application/json' }), ext: 'dd2vtt' };
  }
  let c = canvas;
  if (o.format === 'jpg') {
    // у JPG нет прозрачности — подкладываем фон карты
    c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(canvas, 0, 0);
  }
  return { blob: await toBlob(c, MIME[o.format], o.quality), ext: o.format };
}

export async function exportMap(doc: MapDoc, floorId: string, assets: AssetStore, o: ExportOpts): Promise<{ blob: Blob; filename: string }> {
  const base = safeName(doc.name);
  if (o.floors === 'current' || doc.floors.length === 1) {
    const f = doc.floors.find((x) => x.id === floorId) ?? doc.floors[0];
    const r = await exportFloor(doc, f, assets, o);
    const suffix = doc.floors.length > 1 ? ` - ${safeName(f.name)}` : '';
    return { blob: r.blob, filename: `${base}${suffix}.${r.ext}` };
  }
  const zip = new JSZip();
  for (let i = 0; i < doc.floors.length; i++) {
    const f = doc.floors[i];
    const r = await exportFloor(doc, f, assets, o);
    zip.file(`${String(i + 1).padStart(2, '0')} ${safeName(f.name)}.${r.ext}`, r.blob);
  }
  return { blob: await zip.generateAsync({ type: 'blob' }), filename: `${base}.zip` };
}

/** Миниатюра для списка карт. */
export function thumbnail(doc: MapDoc, assets: AssetStore, size = 220): string {
  const k = size / Math.max(doc.width, doc.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(doc.width * k));
  c.height = Math.max(1, Math.round(doc.height * k));
  const ctx = c.getContext('2d')!;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  renderMap(ctx, doc, doc.floors[0].id, assets, {
    scale: k, view: { x0: 0, y0: 0, x1: doc.width, y1: doc.height }, grid: false, ghost: false,
    roofs: 'hide', lighting: true, gm: true, exporting: true,
  });
  return c.toDataURL('image/webp', 0.7);
}
