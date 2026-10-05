// Перевод старого формата Ширмы (v1: graphData {nodes, links} с полями Name/PName/Desc/Pec/…)
// в формат v2 (отдельные items). Используется для старых ширм из Firestore и для world.json.
import {
  type FrameItem, type Item, type ItemMap, type LinkItem, type NodeItem, type Section,
  parseItem, uid,
} from './schema';

type V1Pec = { Name?: string; PName?: string[]; Desc?: string; Pec?: V1Pec[] };
type V1Node = {
  id?: string; Name?: string; PName?: string[]; Desc?: string; Tags?: { text?: string; color?: string }[];
  Pec?: V1Pec[]; shape?: string; scale?: number; borderColor?: string; titleColor?: string; imgUrl?: string;
  x?: number; y?: number; fx?: number; fy?: number; w?: number; h?: number; groupId?: string; isHidden?: boolean;
};
type V1Link = { source?: string | { id?: string }; target?: string | { id?: string }; label?: string; color?: string };
export type V1Graph = { nodes?: V1Node[]; links?: V1Link[] };

const HEX = /^#?[0-9a-fA-F]{3,8}$/;
const normColor = (c?: string, fallback = '#40E0D0') => {
  if (!c || !HEX.test(c.trim())) return fallback;
  const v = c.trim();
  return v.startsWith('#') ? v : '#' + v;
};

/** «{#hex}Имя{}» в названии → цвет заголовка + чистое имя */
function splitColoredName(name: string): { title: string; color?: string } {
  const m = name.match(/^\{(#?[0-9A-Fa-f]{3,6})\}(.*)$/s);
  if (!m) return { title: name };
  return { title: m[2].replace(/\{\}/g, '').trim(), color: normColor(m[1]) };
}

/** {https://картинка} → markdown-картинка. Цветовой синтаксис {#hex}текст{} остаётся — новый рендер его понимает. */
export function migrateBody(text?: string): string {
  if (!text) return '';
  return text.replace(/\{(https?:\/\/[^}\s]+)\}/g, (_m, url) => `\n![](${url})\n`);
}

function migratePec(p: V1Pec): Section {
  return {
    id: uid('s'),
    title: (p.Name ?? '').toString(),
    aliases: Array.isArray(p.PName) ? p.PName.map(String) : [],
    body: migrateBody(p.Desc),
    children: Array.isArray(p.Pec) ? p.Pec.map(migratePec) : [],
  };
}

export function migrateV1(graph: V1Graph | undefined | null): ItemMap {
  const out: ItemMap = {};
  if (!graph) return out;
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const links = Array.isArray(graph.links) ? graph.links : [];

  for (const n of nodes) {
    const id = n.id ? String(n.id) : uid('n');
    const cx = typeof n.fx === 'number' ? n.fx : typeof n.x === 'number' ? n.x : 0;
    const cy = typeof n.fy === 'number' ? n.fy : typeof n.y === 'number' ? n.y : 0;
    if (n.shape === 'group' || n.shape === 'bgImage') {
      const w = n.w || 200, h = n.h || 200;
      const f: FrameItem = {
        kind: 'frame', id, title: splitColoredName(n.Name ?? '').title,
        color: normColor(n.borderColor), variant: n.shape === 'bgImage' ? 'image' : 'frame',
        image: n.imgUrl || '', x: cx - w / 2, y: cy - h / 2, w, h, hidden: !!n.isHidden,
      };
      out[id] = f;
      continue;
    }
    const { title, color } = splitColoredName(n.Name ?? '');
    const node: NodeItem = {
      kind: 'node', id, title,
      titleColor: color ?? (n.titleColor ? normColor(n.titleColor) : undefined),
      aliases: Array.isArray(n.PName) ? n.PName.map(String) : [],
      tags: (n.Tags ?? []).filter((t) => t && t.text).map((t) => ({ text: String(t.text), color: normColor(t.color) })),
      body: migrateBody(n.Desc),
      sections: Array.isArray(n.Pec) ? n.Pec.map(migratePec) : [],
      shape: n.shape === 'square' ? 'square' : n.shape === 'custom' ? 'icon' : 'circle',
      color: normColor(n.borderColor),
      size: typeof n.scale === 'number' ? n.scale : 1,
      image: n.imgUrl || '', x: cx, y: cy,
      frameId: n.groupId ? String(n.groupId) : null,
      hidden: !!n.isHidden,
    };
    if (node.titleColor === undefined) delete node.titleColor;
    out[id] = node;
  }

  for (const l of links) {
    const from = typeof l.source === 'object' ? l.source?.id : l.source;
    const to = typeof l.target === 'object' ? l.target?.id : l.target;
    if (!from || !to || !out[from] || !out[to]) continue;
    const link: LinkItem = { kind: 'link', id: uid('l'), from: String(from), to: String(to), label: l.label || '', color: normColor(l.color, '#5f7f86'), hidden: false };
    out[link.id] = link;
  }

  // финальная проверка схемой
  for (const [k, v] of Object.entries(out)) {
    const p = parseItem(v);
    if (p) out[k] = p as Item; else delete out[k];
  }
  // рамка, которой нет, — сбрасываем привязку
  for (const v of Object.values(out)) {
    if (v.kind === 'node' && v.frameId && out[v.frameId]?.kind !== 'frame') v.frameId = null;
  }
  return out;
}
