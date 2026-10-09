// Тексты нарушений правил размещения и подписи целей правил (#тег, @группа, файл, папка).
import type { AssetStore } from '../assets/store';
import { findDir, resolvePath } from '../assets/tree.js';
import { ROOM_TYPES, type Issue } from '../geom/place';
import { lang, nm, tr } from '../i18n';

export const roomTypeName = (id: string) => {
  const t = ROOM_TYPES.find((x) => x.id === id);
  return t ? t[lang] : id;
};

/** Понятное имя цели правила: «Стол», «#огонь», «Мебель/». dir — папка, от которой считаются пути. */
export function targetName(assets: AssetStore, target: string, dir = ''): string {
  if (target.startsWith('#') || target.startsWith('@')) return target;
  const path = resolvePath(dir, target);
  for (const p of assets.packs) {
    const e = p.byPath.get(path);
    if (e) return nm(e.name);
  }
  for (const p of assets.packs) {
    const d = findDir(p.tree, path);
    if (d && path) return `${nm(d.name)}/`;
  }
  return target;
}

export function issueText(assets: AssetStore, i: Issue): string {
  if (i.target) return tr(i.key, targetName(assets, i.target, i.dir));
  if (i.key === 'Не для комнаты «{0}»') return tr(i.key, roomTypeName(String(i.args?.[0] ?? '')));
  return tr(i.key, ...(i.args ?? []));
}

export const PLACE_LABEL = { free: 'Свободно', wall: 'У стены', corner: 'В углу', center: 'В центре комнаты', road: 'У дороги' } as const;
export const WHERE_LABEL = { any: 'Где угодно', inside: 'Только в комнате', outside: 'Только снаружи' } as const;
export const ROTATE_LABEL = { none: 'Без случайного поворота', '90': 'Случайно на 90°', any: 'Случайный угол' } as const;
export const COND_LABEL: Record<string, string> = { new: 'Новое', worn: 'Потёртое', ruined: 'Разрушенное' };
