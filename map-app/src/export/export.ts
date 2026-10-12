// Экспорт: PNG / JPG / WebP, Universal VTT (.dd2vtt) и сцена Foundry VTT (.json + картинка). docs/map-editor.md §6.
import JSZip from 'jszip';
import type { AssetStore } from '../assets/store';
import type { Floor, MapDoc, Portal, WallStyle } from '../model/types';
import { renderMap } from '../render/render';
import { portalWall, wallChains } from '../geom/walls';
import { safeName, usedAssetKeysWithVariants } from '../storage/file';
import { tr } from '../i18n';

export type ExportFormat = 'png' | 'jpg' | 'webp' | 'dd2vtt' | 'foundry';
export type WindowMode = 'gap' | 'wall' | 'door';
export type ExportOpts = {
  format: ExportFormat; ppc: number; grid: boolean; floors: 'current' | 'all'; windows: WindowMode; quality: number;
  /** Крыши поверх карты (вид снаружи). */
  roofs: boolean;
  /** Только крыши на прозрачном фоне (PNG/WebP): кладётся поверх карты «верхним» тайлом в Foundry, Owlbear и др. */
  roofsOnly?: boolean;
  /** Запечь освещение в картинку. Для VTT с динамическим светом обычно выключают. */
  bakeLight: boolean;
  /** Мастерская версия: с подписями и слоями «только для мастера». */
  gm: boolean;
};
export type RenderFlags = Pick<ExportOpts, 'roofs' | 'roofsOnly' | 'bakeLight' | 'gm'>;

/** Ограничение браузеров на размер холста. */
export const MAX_SIDE = 16384;
export const MAX_AREA = 268_000_000;
export const fits = (doc: MapDoc, ppc: number) =>
  doc.width * ppc <= MAX_SIDE && doc.height * ppc <= MAX_SIDE && doc.width * doc.height * ppc * ppc <= MAX_AREA;

const MIME: Record<Exclude<ExportFormat, 'dd2vtt' | 'foundry'>, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

export async function renderFloorCanvas(doc: MapDoc, floorId: string, assets: AssetStore, ppc: number, grid: boolean, flags: RenderFlags): Promise<HTMLCanvasElement> {
  await assets.whenLoaded([...usedAssetKeysWithVariants(doc, assets)]);
  const c = document.createElement('canvas');
  c.width = Math.round(doc.width * ppc);
  c.height = Math.round(doc.height * ppc);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.setTransform(ppc, 0, 0, ppc, 0, 0);
  renderMap(ctx, doc, floorId, assets, {
    scale: ppc, view: { x0: 0, y0: 0, x1: doc.width, y1: doc.height }, grid, ghost: false,
    gridPx: Math.max(1, Math.round(ppc / 70)),
    roofs: flags.roofs ? 'show' : 'hide', lighting: flags.bakeLight, gm: flags.gm, exporting: true, onlyRoofs: flags.roofsOnly,
    storeys: !!(flags.roofs || flags.roofsOnly),
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

/** Окно в VTT: своё (Portal.vtt) или как выбрано при экспорте. */
export const windowMode = (p: Portal, windows: WindowMode): WindowMode => p.vtt ?? windows;
const isSecret = (p: Portal) => p.kind === 'door' && !!p.secret;

/**
 * Документ Universal VTT для этажа. image — PNG в base64. baked — освещение уже запечено в картинку.
 * Тайные двери в формате не описываются — там сплошная стена; прозрачные стены (стекло) взгляд не закрывают.
 */
export function buildDd2vtt(doc: MapDoc, f: Floor, ppc: number, image: string, windows: WindowMode, baked = false) {
  // разрыв в линии взгляда: проём без стены, пустой проём, дверь (портал) и окна «видно сквозь» / «как дверь»
  const cut = (p: Portal) => p.kind === 'gap' || (!isSecret(p) && p.kind !== 'insert' && (!p.asset || p.kind === 'door'
    || (p.kind === 'window' && windowMode(p, windows) !== 'wall')));
  // низкие стены (ограждения, перила) и прозрачные не закрывают обзор — в VTT их нет
  const los = wallChains(f, undefined, true, cut).filter((c) => !c.style.low && c.style.vtt !== 'clear')
    .map((c) => { const pts = c.pts.map((q) => P(q.x, q.y)); return c.closed ? [...pts, pts[0]] : pts; });
  const portals = f.portals
    .filter((p) => !!p.asset && !isSecret(p) && (p.kind === 'door' || (p.kind === 'window' && windowMode(p, windows) === 'door'))
      && !portalWall(f, p)?.style.low)
    .map((p) => vttPortal(p, p.state !== 'open'));
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

// ---------- Foundry VTT
// Константы Foundry (CONST.WALL_SENSE_TYPES, WALL_MOVEMENT_TYPES, WALL_DOOR_TYPES, WALL_DOOR_STATES).
const NONE = 0, LIMITED = 10, NORMAL = 20;
type Senses = { move: number; sight: number; light: number; sound: number };
const SENSES: Record<NonNullable<WallStyle['vtt']>, Senses> = {
  normal: { move: NORMAL, sight: NORMAL, light: NORMAL, sound: NORMAL },
  clear: { move: NORMAL, sight: NONE, light: NONE, sound: NORMAL },
  ethereal: { move: NONE, sight: NORMAL, light: NORMAL, sound: NONE },
  terrain: { move: NORMAL, sight: LIMITED, light: LIMITED, sound: LIMITED },
};
const WINDOW_SENSES: Senses = { move: NORMAL, sight: NONE, light: NONE, sound: LIMITED };
const DOOR_STATE = { closed: 0, open: 1, locked: 2 } as const;
/** Сетка Foundry (CONST.GRID_TYPES): без сетки, квадрат, гексы «строками» (острые) и «столбцами» (плоские). */
const GRID_TYPE: Record<MapDoc['grid']['type'], number> = { none: 0, square: 1, 'hex-pointy': 2, 'hex-flat': 4 };
const FEET_PER_CELL = 5;

/**
 * Сцена Foundry VTT (v10–v13) для «Import Data»: стены с типами (прозрачные, эфирные, ограничивающие обзор), двери
 * с состоянием (закрыта / открыта / заперта), тайные двери, окна, свет (яркий/тусклый радиус, конус, анимация),
 * сетка и темнота. image — имя файла картинки (кладётся рядом). Отступ сцены (padding) — 0, координаты в пикселях.
 */
export function buildFoundryScene(doc: MapDoc, f: Floor, ppc: number, image: string, windows: WindowMode, baked = false) {
  const px = (v: number) => Math.round(v * ppc * 10) / 10;
  const wall = (a: { x: number; y: number }, b: { x: number; y: number }, s: Senses, door = 0, ds = 0) => ({
    c: [px(a.x), px(a.y), px(b.x), px(b.y)], ...s, dir: 0, door, ds,
    threshold: { light: null, sight: null, sound: null, attenuation: false }, flags: {},
  });
  const walls: ReturnType<typeof wall>[] = [];
  // стены режутся всеми настоящими проёмами — их отрезки добавляются отдельно, со своим типом
  const isOpening = (p: Portal) => p.kind === 'gap' || (p.kind !== 'insert' && !p.asset && !isSecret(p));
  for (const c of wallChains(f, undefined, true, (p) => p.kind !== 'insert')) {
    if (c.style.low) continue;
    const s = SENSES[c.style.vtt ?? 'normal'];
    const pts = c.closed ? [...c.pts, c.pts[0]] : c.pts;
    for (let i = 0; i < pts.length - 1; i++) walls.push(wall(pts[i], pts[i + 1], s));
  }
  for (const p of f.portals) {
    if (p.kind === 'insert' || isOpening(p)) continue;
    const host = portalWall(f, p);
    if (host?.style.low) continue;
    const ds = DOOR_STATE[p.state ?? 'closed'];
    if (p.kind === 'door') walls.push(wall(p.a, p.b, SENSES.normal, p.secret ? 2 : 1, ds));
    else if (p.kind === 'window') {
      const m = windowMode(p, windows);
      walls.push(m === 'door' ? wall(p.a, p.b, SENSES.normal, 1, ds) : wall(p.a, p.b, m === 'wall' ? SENSES[host?.style.vtt ?? 'normal'] : WINDOW_SENSES));
    }
  }
  const lights = f.lights.map((l) => ({
    x: px(l.x), y: px(l.y), rotation: Math.round((((l.rot ?? 0) % 360) + 360) % 360), walls: l.shadows, vision: false, hidden: false,
    config: {
      dim: Math.round(l.radius * FEET_PER_CELL * 10) / 10,
      bright: Math.round(l.radius * (l.bright ?? 0.5) * FEET_PER_CELL * 10) / 10,
      angle: Math.round(l.angle ?? 360), color: l.color, alpha: Math.round(Math.min(1, 0.6 * l.intensity) * 100) / 100,
      coloration: 1, luminosity: 0.5, attenuation: 0.5, saturation: 0, contrast: 0, shadows: 0,
      animation: { type: l.anim && l.anim !== 'none' ? l.anim : null, speed: 5, intensity: 5, reverse: false },
      darkness: { min: 0, max: 1 },
    },
    flags: {},
  }));
  // свет запечён в картинку — у Foundry своей темноты нет (иначе двойная)
  const dark = doc.lighting.enabled && !baked ? Math.round(doc.lighting.darkness * 100) / 100 : 0;
  const globalLight = !doc.lighting.enabled || baked;
  return {
    name: f.name && doc.floors.length > 1 ? `${doc.name} — ${f.name}` : doc.name,
    navigation: false,
    width: Math.round(doc.width * ppc), height: Math.round(doc.height * ppc), padding: 0,
    backgroundColor: doc.background,
    background: { src: image }, img: image,
    grid: {
      type: GRID_TYPE[doc.grid.type], size: Math.round(ppc), distance: FEET_PER_CELL, units: 'ft',
      color: doc.grid.color, alpha: doc.grid.show ? doc.grid.opacity : 0,
    },
    tokenVision: true, fogExploration: true,
    environment: { darknessLevel: dark, globalLight: { enabled: globalLight } },
    darkness: dark, globalLight,
    walls, lights, notes: [], tokens: [], drawings: [], tiles: [], sounds: [], templates: [],
    flags: { 'pm-maps': { map: doc.id, floor: f.id } },
  };
}

/** Общий свет карты для VTT: без освещения — полный день. */
function ambient(doc: MapDoc): string {
  if (!doc.lighting.enabled) return 'ffffffff';
  const v = Math.round(255 * (1 - doc.lighting.darkness)).toString(16).padStart(2, '0');
  return `ff${v}${v}${v}`;
}

async function exportFloor(doc: MapDoc, f: Floor, assets: AssetStore, o: ExportOpts): Promise<{ blob: Blob; ext: string }> {
  if (o.roofsOnly) {
    // прозрачный фон: только PNG или WebP, без сетки
    const canvas = await renderFloorCanvas(doc, f.id, assets, o.ppc, false, o);
    const fmt = o.format === 'webp' ? 'webp' : 'png';
    return { blob: await toBlob(canvas, MIME[fmt], o.quality), ext: fmt };
  }
  const canvas = await renderFloorCanvas(doc, f.id, assets, o.ppc, o.grid, o);
  if (o.format === 'foundry') throw new Error('foundry: exportFoundry');
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

/**
 * Foundry: ZIP с картинкой этажа (WebP) и сценой (.json) рядом — на каждый выбранный этаж. В сцене фон — имя файла
 * картинки: её загружают в Foundry и, если путь другой, выбирают фоном сцены после «Import Data».
 */
async function exportFoundry(doc: MapDoc, floorId: string, assets: AssetStore, o: ExportOpts): Promise<{ blob: Blob; filename: string }> {
  const base = safeName(doc.name);
  const list = o.floors === 'current' || doc.floors.length === 1 ? [doc.floors.find((x) => x.id === floorId) ?? doc.floors[0]] : doc.floors;
  const zip = new JSZip();
  for (const f of list) {
    const name = list.length > 1 || doc.floors.length > 1 ? `${base} - ${safeName(f.name)}` : base;
    const canvas = await renderFloorCanvas(doc, f.id, assets, o.ppc, o.grid, o);
    zip.file(`${name}.webp`, await toBlob(canvas, 'image/webp', o.quality));
    const scene = buildFoundryScene(doc, f, o.ppc, `${name}.webp`, o.windows, o.bakeLight && doc.lighting.enabled);
    zip.file(`${name}.json`, JSON.stringify(scene, null, 2));
  }
  return { blob: await zip.generateAsync({ type: 'blob' }), filename: `${base} - Foundry.zip` };
}

export async function exportMap(doc: MapDoc, floorId: string, assets: AssetStore, o: ExportOpts): Promise<{ blob: Blob; filename: string }> {
  if (o.format === 'foundry' && !o.roofsOnly) return exportFoundry(doc, floorId, assets, o);
  const base = safeName(doc.name) + (o.roofsOnly ? ` - ${safeName(tr('крыши'))}` : '');
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
