import { describe, it, expect } from 'vitest';
import { lightOf, lightUpdate, giftsOf, egosOf, fusion } from '../../site/pm-ego.js';

const gift = (id, name, level, types = [], viaFlags = true) => ({ id, name, type: 'feat',
  flags: viaFlags ? { pm5e: { cat: 'gifts', level, types } } : {},
  system: { requirements: viaFlags ? 'Э.Г.О. гифт' : `Э.Г.О. гифт, уровень ${['I', 'II', 'III', 'IV', 'V'][level - 1]}` } });

describe('Свет', () => {
  it('из флага, иначе из ресурса «Свет»; обновление пишет оба', () => {
    expect(lightOf({ flags: { pm5e: { light: { value: 3, max: 8 } } } })).toEqual({ value: 3, max: 8, resource: 'primary' });
    expect(lightOf({ system: { resources: { secondary: { label: 'Свет', value: 5, max: 6 } } } })).toEqual({ value: 5, max: 6, resource: 'secondary' });
    expect(lightOf({})).toEqual({ value: 0, max: 0, resource: 'primary' });
    const a = { flags: { pm5e: { light: { value: 3, max: 8 } } } };
    expect(lightUpdate(a, 12)).toEqual({ 'flags.pm5e.light': { value: 8, max: 8 }, 'system.resources.primary': { label: 'Свет', value: 8, max: 8 } });
    expect(lightUpdate(a, -2, 10, 'en')['system.resources.primary']).toEqual({ label: 'Light', value: 0, max: 10 });
  });
});

describe('дары и Э.Г.О. актёра', () => {
  const items = [
    gift('a', 'Извращение', 1, ['Charge']), gift('b', 'Бурлящая сфера', 2, ['Sinking'], false),
    { id: 'c', name: 'Гарпун', type: 'feat', flags: { pm5e: { cat: 'ego' } }, system: { requirements: 'Атака Э.Г.О. | ZAYIN' } },
    { id: 'd', name: 'Старое Э.Г.О.', type: 'feat', system: { requirements: 'Расцветающее Э.Г.О. | Экипировка' } },
    { id: 'e', name: 'Черта', type: 'feat', system: { requirements: '' } }, { id: 'f', name: 'Меч', type: 'weapon', system: {} },
  ];
  it('дары — по флагам или требованиям, с уровнем; Э.Г.О. — по флагу или строке вида', () => {
    expect(giftsOf(items)).toEqual([
      { id: 'a', name: 'Извращение', level: 1, types: ['Charge'] }, { id: 'b', name: 'Бурлящая сфера', level: 2, types: [] }]);
    expect(egosOf(items).map((e) => e.name)).toEqual(['Гарпун', 'Старое Э.Г.О.']);
  });
  it('слияние: тир по правилу сайта, варианты из Базы знаний без уже имеющихся, фильтр по типам', () => {
    const kb = [
      { uid: 'g1', it: { Name: 'Огонь', Level: 2, Type: ['Burn'] } }, { uid: 'g2', it: { Name: 'Заряд-2', Level: 2, Type: ['Charge'] } },
      { uid: 'g3', it: { Name: 'Бурлящая сфера', Level: 2, Type: ['Sinking'] } }, { uid: 'g4', it: { Name: 'Тир 3', Level: 3, Type: [] } },
    ];
    const sel = [{ name: 'Извращение', level: 2, types: ['Charge'] }, { name: 'Х', level: 3, types: [] }];
    expect(fusion(sel, kb, { owned: ['Бурлящая сфера'] })).toEqual({ tier: 2, options: [kb[0], kb[1]] });
    expect(fusion(sel, kb, { sameTypes: true }).options.map((e) => e.it.Name)).toEqual(['Заряд-2']);
    expect(fusion([...sel, { name: 'Y', level: 3 }], kb).tier).toBe(4);
    expect(fusion([sel[0]], kb)).toBeNull();
  });
});
