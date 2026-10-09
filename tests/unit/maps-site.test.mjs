// Этап 5 редактора карт: Районы из world.json, ссылки Ширма ↔ карты ↔ База знаний, генерация с Районом.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDistricts, districtMatches, districtPalette, mix } from '../../map-app/src/data/world.ts';
import { mapMarkdown, mapUrl, parseMapHash, siteLink, kbMarkdown } from '../../site/site-links.js';
import { createDoc, parseDoc } from '../../map-app/src/model/doc.ts';
import { makeKit } from '../../map-app/src/gen/kit.ts';
import { building, streets } from '../../map-app/src/gen/generate.ts';
import { normRules } from '../../map-app/src/assets/tree.js';

const ru = parseDistricts(JSON.parse(readFileSync('Assets/Rus/world/world.json', 'utf8')));
const en = parseDistricts(JSON.parse(readFileSync('Assets/Eng/world/world.json', 'utf8')));

describe('Районы из world.json', () => {
  it('26 Районов и области; цвет и Крыло', () => {
    expect(ru.length).toBeGreaterThanOrEqual(26);
    const d12 = ru.find((d) => d.name === 'РАЙОН 12');
    expect(d12).toMatchObject({ color: '#C0392B', wing: 'L' });
    expect(d12.aliases).toEqual(expect.arrayContaining(['район 12', 'district 12', 'крыло l', 'l-corp']));
    expect(ru.find((d) => d.name === 'Окраины')).toMatchObject({ color: '#A04000' });
    expect(en.find((d) => d.name === 'DISTRICT 12')).toMatchObject({ wing: 'L' });
  });
  it('правила districts: любое имя Района, без учёта регистра; без Района — подходит всё', () => {
    const d12 = ru.find((d) => d.name === 'РАЙОН 12');
    expect(districtMatches(d12, ['L-Corp'])).toBe(true);
    expect(districtMatches(d12, ['Район 12'])).toBe(true);
    expect(districtMatches(d12, ['Район 11'])).toBe(false);
    expect(districtMatches(undefined, ['Район 11'])).toBe(true);
    expect(districtMatches(d12, [])).toBe(true);
  });
  it('палитра', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(districtPalette('#C0392B').background).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('ссылки', () => {
  const origin = 'https://pm.example';
  it('ссылка на карту и её разбор', () => {
    expect(mapUrl('m1', 'Склад')).toBe('/maps.html#map=m1&name=%D0%A1%D0%BA%D0%BB%D0%B0%D0%B4');
    expect(parseMapHash('#map=m1&name=%D0%A1%D0%BA%D0%BB%D0%B0%D0%B4')).toEqual({ id: 'm1', name: 'Склад' });
    expect(parseMapHash('#feats')).toBeNull();
    expect(mapMarkdown('m1', 'Склад [1]')).toBe('[🗺 Склад 1](/maps.html#map=m1&name=%D0%A1%D0%BA%D0%BB%D0%B0%D0%B4%20%5B1%5D)');
  });
  it('ссылка из Базы знаний → путь от корня и имя записи', () => {
    expect(siteLink(`${origin}/navigation.html#bestiary/%D0%A1%D0%BB%D0%B8%D0%B7%D0%B5%D0%BD%D1%8C`, origin))
      .toEqual({ title: 'Слизень', url: '/navigation.html#bestiary/%D0%A1%D0%BB%D0%B8%D0%B7%D0%B5%D0%BD%D1%8C' });
    expect(siteLink('navigation.html#feats/c:abc', origin)).toEqual({ title: 'abc', url: '/navigation.html#feats/c:abc' });
    expect(siteLink('https://other.site/page', origin)).toEqual({ title: 'page', url: 'https://other.site/page' });
    expect(siteLink('javascript:alert(1)', origin)).toBeNull();
    expect(siteLink('', origin)).toBeNull();
    expect(kbMarkdown('')).toBeNull();
  });
});

describe('карта с Районом и ссылками', () => {
  it('файл хранит Район, ссылки карты и ссылку подписи', () => {
    const d = createDoc({ name: 'X', width: 10, height: 8, grid: 'square', floorName: 'F' });
    const raw = JSON.parse(JSON.stringify({ ...d, district: ru[11], links: [{ title: 'Слизень', url: '/navigation.html#bestiary/x' }] }));
    raw.floors[0].labels = [{ id: 'l', x: 1, y: 1, text: '1', link: '/navigation.html#lore/y' }];
    const p = parseDoc(raw);
    expect(p.district.name).toBe(ru[11].name);
    expect(p.links).toHaveLength(1);
    expect(p.floors[0].labels[0].link).toBe('/navigation.html#lore/y');
    expect(parseDoc(JSON.parse(JSON.stringify(d))).district).toBeUndefined();
  });
  const manifest = JSON.parse(readFileSync('Assets/Maps/manifest.json', 'utf8'));
  const fill = { furnish: true, density: 1, cover: 0, traps: 0, weather: false, lights: true, numbers: false, condition: 'style' };
  it('генерация в Районе: вывеска Крыла у входа, стены и свет в его цвете, правила districts', () => {
    const d12 = ru.find((d) => d.name === 'РАЙОН 12');
    const d = createDoc({ name: 'T', width: 40, height: 30, grid: 'square', floorName: 'F' });
    const kit = makeKit([{ id: 'canon', assets: manifest.assets, sets: manifest.sets }]);
    building(d, d.floors[0].id, kit, { seed: 'w', clear: true, fill: { ...fill, district: d12 }, type: 'warehouse', width: 16, height: 12, rooms: 4, style: 'backstreets', roof: false });
    const f = d.floors[0];
    expect(f.objects.some((o) => o.asset === 'canon:scalable/signs/wings/l-corp/sign.svg')).toBe(true);
    expect(f.lights.every((l) => l.color === districtPalette(d12.color).light)).toBe(true);
    expect(f.rooms[0].wall.color).toBe(districtPalette(d12.color).wall('#2a1d18'));
    // объект только для Района 11 в Районе 12 не появляется
    const only11 = manifest.assets.map((a) => (a.path.includes('containers/crate') ? { ...a, rules: normRules({ ...a.rules, districts: ['Район 11'] }) } : a));
    const kit2 = makeKit([{ id: 'canon', assets: only11, sets: manifest.sets }]);
    const g = createDoc({ name: 'T', width: 60, height: 40, grid: 'square', floorName: 'F' });
    streets(g, g.floors[0].id, kit2, { seed: 's', clear: true, fill: { ...fill, district: d12 }, block: 16, plazas: 0, buildings: true, roofs: false, style: 'backstreets' });
    expect(g.floors[0].objects.some((o) => o.asset.includes('containers/crate'))).toBe(false);
  });
});
