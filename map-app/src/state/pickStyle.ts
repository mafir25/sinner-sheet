// «Взять стиль» (пипетка, I): настройки выбранного элемента карты переходят в его инструмент —
// дальше можно рисовать тем же полом, стенами, дверью, путём, светом, подписью или ставить тот же объект.
import type { Editor, SelItem } from './editor';
import { edgeOf } from './editor';
import { edgeStyle } from '../geom/walls';
import { tr } from '../i18n';

/** Применяет стиль элемента к настройкам инструмента и включает инструмент. Возвращает подпись для уведомления или null. */
export function pickStyle(ed: Editor, item: SelItem): string | null {
  const f = ed.floor, s = ed.state.settings;
  const find = <T extends { id: string }>(list: T[]) => list.find((x) => x.id === item.id);
  switch (item.kind) {
    case 'object': {
      const o = find(f.objects);
      if (!o) return null;
      ed.setSettings({ stamp: o.asset, stampSet: null, stampRot: o.rot, stampFlip: o.flipX });
      ed.setTool('stamp');
      return tr('Объект');
    }
    case 'room': {
      const r = find(f.rooms);
      if (!r) return null;
      ed.setSettings({ floor: r.floor, wall: { ...r.wall } });
      ed.setTool('room');
      return tr('Пол и стены комнаты');
    }
    case 'edge': {
      const e = edgeOf(f, item.id);
      if (!e) return null;
      ed.setSettings({ wall: { ...edgeStyle(e.room, e.a, e.b) } });
      ed.setTool('wall');
      return tr('Стена');
    }
    case 'wall': {
      const w = find(f.walls);
      if (!w) return null;
      ed.setSettings({ wall: { ...w.wall } });
      ed.setTool('wall');
      return tr('Стена');
    }
    case 'portal': {
      const p = find(f.portals);
      if (!p || p.kind === 'gap') return null;
      ed.setSettings(p.kind === 'door' ? { door: p.asset } : { window: p.asset });
      ed.setTool(p.kind);
      return p.kind === 'door' ? tr('Дверь') : tr('Окно');
    }
    case 'path': {
      const p = find(f.paths);
      if (!p) return null;
      ed.setSettings({ path: { style: structuredClone(p.style), smooth: p.smooth } });
      ed.setTool('path');
      return tr('Путь');
    }
    case 'light': {
      const l = find(f.lights);
      if (!l) return null;
      ed.setSettings({ light: { radius: l.radius, color: l.color, intensity: l.intensity, shadows: l.shadows } });
      ed.setTool('light');
      return tr('Свет');
    }
    case 'label': {
      const l = find(f.labels);
      if (!l) return null;
      ed.setSettings({ label: { ...s.label, size: l.size, color: l.color, font: l.font, box: l.box, gmOnly: l.gmOnly } });
      ed.setTool('label');
      return tr('Подпись');
    }
    case 'roof': {
      const r = find(f.roofs);
      if (!r) return null;
      ed.setSettings({ roof: { asset: r.asset, color: r.color } });
      ed.setTool('roof');
      return tr('Крыша');
    }
  }
  return null;
}
