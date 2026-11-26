import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const V2_DIR = join(ROOT, 'Assets', 'Rus', 'v2');

function readJson(rel) {
  const p = join(V2_DIR, rel);
  expect(existsSync(p), `Missing v2 JSON: ${rel}`).toBe(true);
  return JSON.parse(readFileSync(p, 'utf8'));
}

describe('Модуль v2 (2.0 Edition): данные JSON', () => {
  it('systems.json регистрирует все классы 2.0 и ссылается на существующие файлы', () => {
    const systems = readJson('characters/systems.json');
    expect(Array.isArray(systems)).toBe(true);
    expect(systems.length).toBeGreaterThanOrEqual(7);
    const ids = systems.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['fighter', 'vanguard', 'marksman', 'assassin', 'adept', 'brawler', 'controller']));
    for (const s of systems) {
      const base = readJson(`characters/${s.Base}`);
      expect(base.Name).toBeTruthy();
      expect(Array.isArray(base.Talents)).toBe(true);
      expect(base.Talents.length).toBeGreaterThan(0);
      const arch = readJson(`characters/${s.Archetypes}`);
      expect(Array.isArray(arch)).toBe(true);
    }
  });

  it('races.json и backgrounds.json содержат все расы и предыстории 2.0', () => {
    const races = readJson('characters/races.json');
    expect(races).toHaveLength(5);
    for (const r of races) {
      expect(r.Name).toBeTruthy();
      expect(r.Desc).toBeTruthy();
      expect(Array.isArray(r.Traits)).toBe(true);
    }

    const bgs = readJson('characters/backgrounds.json');
    expect(bgs).toHaveLength(5);
    for (const b of bgs) {
      expect(b.Name).toBeTruthy();
      expect(Array.isArray(b.Features)).toBe(true);
      expect(b.Features.length).toBeGreaterThan(0);
    }
  });

  it('feats.json, equipment.json, statuses.json, rules.json, ego2.json, lore.json валидны', () => {
    const feats = readJson('characters/feats.json');
    expect(feats).toHaveLength(7);
    expect(feats.every((f) => f.Name && f.desc && Array.isArray(f.Base))).toBe(true);

    const equip = readJson('items/equipment.json');
    expect(equip).toHaveLength(19);
    expect(equip.every((e) => e.Name && e.ItemType && e.Rarity && e.Desc)).toBe(true);

    const statuses = readJson('mechanics/statuses.json');
    expect(statuses).toHaveLength(28);
    const cats = new Set(['Negative', 'Positive', 'Buff', 'Debuff']);
    expect(statuses.every((s) => s.Name && s.Effect && cats.has(s.Category))).toBe(true);

    const rules = readJson('mechanics/rules.json');
    expect(rules).toHaveLength(5);
    expect(rules.every((r) => r.Name && Array.isArray(r.Blocks))).toBe(true);

    const ego2 = readJson('mechanics/ego2.json');
    expect(ego2.length).toBeGreaterThan(0);

    const lore = readJson('world/lore.json');
    expect(lore.length).toBeGreaterThan(0);
  });
});

describe('SiteModule: переключение v1 / v2 и маршрутизация fetchData', () => {
  function bootI18n(search = '', stored = {}) {
    const ls = new Map(Object.entries(stored));
    const fetched = [];
    const windowObj = {
      location: { href: `https://example.test/navigation.html${search}`, search, protocol: 'https:', hostname: 'example.test', replace: () => {} },
      localStorage: {
        getItem: (k) => (ls.has(k) ? ls.get(k) : null),
        setItem: (k, v) => ls.set(k, String(v)),
        removeItem: (k) => ls.delete(k),
      },
      document: {
        documentElement: { lang: 'ru', dataset: {} },
        currentScript: { src: 'https://example.test/site/i18n.js' },
        write: () => {},
      },
      fetch: async (url) => {
        fetched.push(url);
        if (url.includes('/v2/') && url.endsWith('races.json')) return { ok: true, json: async () => [] };
        if (!url.includes('/v2/') && url.endsWith('bestiary.json')) return { ok: true, json: async () => [] };
        return { ok: false, status: 404 };
      },
      URL,
      URLSearchParams,
    };
    windowObj.window = windowObj;
    const code = readFileSync(join(ROOT, 'site', 'i18n.js'), 'utf8');
    vm.runInNewContext(code, windowObj);
    return { window: windowObj, fetched, ls };
  }

  it('по умолчанию активна версия v1 и тестовый режим закрыт', () => {
    const { window } = bootI18n();
    expect(window.SiteModule.get()).toBe('v1');
    expect(window.SiteModule.isV2()).toBe(false);
    expect(window.SiteModule.isTestUnlocked()).toBe(false);
  });

  it('?module=v2 включает v2, открывает тестовый режим и направляет fetchData в Assets/Rus/v2/', async () => {
    const { window, fetched } = bootI18n('?module=v2');
    expect(window.SiteModule.get()).toBe('v2');
    expect(window.SiteModule.isV2()).toBe(true);
    expect(window.SiteModule.isTestUnlocked()).toBe(true);

    const r1 = await window.I18N.fetchData('races.json');
    expect(r1.ok).toBe(true);
    expect(fetched[0]).toBe('Assets/Rus/v2/characters/races.json');

    const r2 = await window.I18N.fetchData('bestiary.json');
    expect(r2.ok).toBe(true);
    expect(fetched).toContain('Assets/Rus/v2/world/bestiary.json');
    expect(fetched).toContain('Assets/Rus/world/bestiary.json');
  });
});
