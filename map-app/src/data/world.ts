// Районы Города из world.json (карта Ширмы): название, цвет, Крыло. Нужны для палитры карты
// и контекста генерации (этап 5, docs/map-editor.md §2). Редактор только читает статический файл.
import type { District } from '../model/types';

type WNode = { id: string; Name?: string; shape?: string; borderColor?: string; Tags?: { text: string }[] };
type WScreen = { id: string; graphData?: { nodes?: WNode[] } };

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');

/** Районы и области с карты Города («map» в world.json). */
export function parseDistricts(world: unknown): District[] {
  if (!Array.isArray(world)) return [];
  const screen = (world as WScreen[]).find((s) => s.id === 'map') ?? (world as WScreen[])[0];
  const nodes = screen?.graphData?.nodes ?? [];
  const out: District[] = [];
  for (const g of nodes) {
    if (g.shape !== 'group' || !g.Name) continue;
    const num = /(?:район|district)\s*(\d+)/i.exec(g.Name)?.[1];
    // узел-хозяин района: Крыло / корпорация с тегом «Район N»
    const owner = num ? nodes.find((n) => n.shape === 'circle' && (n.Tags ?? []).some((t) => new RegExp(`^(?:район|district)\\s*${num}$`, 'i').test(t.text.trim()))) : undefined;
    const wingTag = owner?.Tags?.find((t) => /^(?:крыло|wing)\s+[a-z]$/i.test(t.text.trim()))?.text.trim();
    const wing = wingTag ? wingTag.slice(-1).toUpperCase() : undefined;
    const aliases = [g.Name];
    if (num) aliases.push(`Район ${num}`, `District ${num}`);
    if (owner?.Name) aliases.push(owner.Name);
    if (wing) aliases.push(`Крыло ${wing}`, `Wing ${wing}`, `${wing} Corp`, `${wing.toLowerCase()}-corp`);
    out.push({
      id: g.id, name: g.Name, color: /^#[0-9a-f]{6}$/i.test(g.borderColor ?? '') ? g.borderColor! : '#40E0D0',
      ...(wing ? { wing } : {}), ...(owner?.Name ? { faction: owner.Name } : {}),
      aliases: [...new Set(aliases.map(norm))],
    });
  }
  return out;
}

/** Подходит ли значение из правил (`districts`) к Району: по любому из имён, без учёта регистра. */
export function districtMatches(d: { aliases: string[] } | undefined, values: string[]): boolean {
  if (!d || !values.length) return true;
  const set = new Set(d.aliases.map(norm));
  return values.some((v) => set.has(norm(v)));
}

let cache: Promise<District[]> | null = null;
/** Районы с сайта: Assets/<язык>/world/world.json (английского нет — русский). */
export function loadDistricts(lang: 'ru' | 'en'): Promise<District[]> {
  cache ??= (async () => {
    for (const dir of lang === 'en' ? ['Eng', 'Rus'] : ['Rus']) {
      try {
        const res = await fetch(`Assets/${dir}/world/world.json`);
        if (res.ok) { const list = parseDistricts(await res.json()); if (list.length) return list; }
      } catch { /* без сети — без Районов */ }
    }
    return [];
  })();
  return cache;
}

// ---------- палитра
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
/** Смесь двух цветов #rrggbb: t = 0 — первый, 1 — второй. */
export function mix(a: string, b: string, t: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return a;
  const x = hex(a), y = hex(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** Палитра карты по цвету Района: фон, цвет темноты, подписи, оттенок света и стен для генерации. */
export function districtPalette(color: string) {
  return {
    background: mix('#101012', color, 0.1),
    darkness: mix('#05060a', color, 0.18),
    label: mix('#ffffff', color, 0.55),
    light: mix('#ffd9a0', color, 0.35),
    wall: (base: string) => mix(base, color, 0.22),
  };
}
