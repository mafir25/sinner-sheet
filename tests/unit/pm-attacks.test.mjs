import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDamage, parseStatuses, parseAction, weaponBase, docId, activityFor, statusEffectsData, srdWeaponSystem } from '../../site/pm-attacks.js';
import { bestiaryActor, equipmentItem } from '../../site/foundry-export.js';

describe('разбор текста', () => {
  it('урон: тип до и после слова «урона», несколько частей, отрицательный бонус', () => {
    expect(parseDamage('Попадание: 17 (2d12+4) колющего урона плюс 6 (1d12) некротического урона.')).toEqual([
      { number: 2, denomination: 12, bonus: '4', types: ['piercing'] }, { number: 1, denomination: 12, bonus: '', types: ['necrotic'] }]);
    expect(parseDamage('цель получает 26 (4d12) урона огнём')).toEqual([{ number: 4, denomination: 12, bonus: '', types: ['fire'] }]);
    expect(parseDamage('1 (1d4-1) колющего урона')[0].bonus).toBe('-1');
    expect(parseDamage('Hit: 23 (1d12 + 3) bludgeoning damage.')).toEqual([{ number: 1, denomination: 12, bonus: '3', types: ['bludgeoning'] }]);
    expect(parseDamage('10 (1d10+5) дробящего урона Зависти')[0].types).toEqual(['bludgeoning']);
  });
  it('статусы «накладывает N `Статуса`» — только известные модулю, с числом', () => {
    expect(parseStatuses('накладывает 3 `Тремора::Тремор`, 1 `Оковы::Оковы` и 1 `Паралич::Паралич`, 2 Гвоздя'))
      .toEqual([{ id: 'tremor', n: 3 }, { id: 'bind', n: 1 }, { id: 'paralysis', n: 1 }]);
    expect(parseStatuses('накладывает `Кровотечение::Кровотечение`, равное урону')).toEqual([]);
  });
  it('атака: ближняя/дальняя, бонус, досягаемость и дистанция', () => {
    expect(parseAction('Рукопашная атака оружием: +6 к попаданию, досягаемость 15 фт., одна цель. Попадание: 23 (1d12+3) дробящего урона. При попадании накладывает 5 `Потопления::Потопление`.'))
      .toEqual({ kind: 'attack', melee: true, bonus: 6, reach: 15, range: null,
        damage: [{ number: 1, denomination: 12, bonus: '3', types: ['bludgeoning'] }], statuses: [{ id: 'sinking', n: 5 }] });
    const r = parseAction('Дальнобойная атака оружием: +10 к попаданию, дистанция 60/80 фт., одна цель. Попадание: 17 (2d12+4) колющего урона');
    expect(r).toMatchObject({ melee: false, bonus: 10, range: { value: 60, long: 80 } });
    expect(parseAction('Коготь: Рукопашная атака оружием: +? к попаданию')).toBeNull();
  });
  it('спасбросок: характеристика, СЛ, половина урона', () => {
    expect(parseAction('Каждое существо в пределах 15 фт. должно совершить спасбросок Ловкости СЛ 15. При провале 13 (2d8+4) дробящего урона и 5 `Кровотечения::Кровотечение`, при успехе — половину.'))
      .toMatchObject({ kind: 'save', ability: 'dex', dc: 15, half: true, statuses: [{ id: 'bleed', n: 5 }] });
    expect(parseAction('спасбросок Телосложения со СЛ 26')).toMatchObject({ ability: 'con', dc: 26 });
    expect(parseAction('Мультиатака: совершает две атаки.')).toBeNull();
  });
});

describe('данные dnd5e', () => {
  it('id документа: 16 символов, детерминирован', () => {
    expect(docId('a')).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(docId('a')).toBe(docId('a'));
    expect(docId('a')).not.toBe(docId('b'));
  });
  it('действие атаки: плоский бонус, урон сверх первого — частями; эффекты статусов', () => {
    const p = parseAction('Дальнобойная атака оружием: +10 к попаданию. Попадание: 17 (2d12+4) колющего урона плюс 6 (1d12) некротического урона. Накладывает 2 `Хрупкость::Хрупкость`.');
    const eff = statusEffectsData(p.statuses, 's');
    expect(eff[0]).toMatchObject({ name: 'Хрупкость 2', transfer: false, statuses: ['pm5e-fragile'], flags: { pm5e: { status: { id: 'fragile', stacks: 2 } } } });
    const a = activityFor(p, 's', 'action', eff.map((e) => e._id));
    expect(a).toMatchObject({ type: 'attack', attack: { bonus: '10', flat: true, type: { value: 'ranged' } },
      damage: { includeBase: true, parts: [{ number: 1, denomination: 12, types: ['necrotic'] }] }, effects: [{ _id: eff[0]._id }] });
  });
  it('существа бестиария: атаки — оружие с броском, спасброски — особенности с действием', () => {
    const toad = JSON.parse(readFileSync(new URL('../../Assets/Rus/world/bestiary.json', import.meta.url), 'utf8'))[0];
    const a = bestiaryActor(toad, { cat: 'bestiary', key: 'k:Жаба' });
    const slap = a.items.find((i) => i.name === 'Плачущая оплеуха');
    expect(slap).toMatchObject({ type: 'weapon', system: { type: { value: 'natural' }, damage: { base: { number: 1, denomination: 12, bonus: '3' } }, range: { reach: 15 } } });
    expect(Object.values(slap.system.activities)[0]).toMatchObject({ type: 'attack', attack: { bonus: '6' } });
    expect(slap.effects[0].name).toBe('Потопление 5');
    expect(a.items.find((i) => i.name === 'Аномалия').system.activities).toBeUndefined();
  });
  it('оружие персонажа: база SRD по названию вида, атака по характеристике', () => {
    expect(weaponBase('*Оружие (длинный меч)*\n\nтекст')).toMatchObject({ base: 'longsword', dmg: [1, 8, 'slashing'] });
    expect(weaponBase('*Weapon (rapier)*')).toMatchObject({ base: 'rapier' });
    expect(weaponBase('*Оружие (пистолет)*')).toBeNull();
    expect(srdWeaponSystem(weaponBase('*Оружие (копьё)*'))).toMatchObject({ properties: ['thr', 'ver'], range: { value: 20, long: 60 }, damage: { versatile: { denomination: 8 } } });
    const sword = equipmentItem({ Name: 'Клинок', ItemType: 'Weapon', Desc: '*Оружие (длинный меч)*' }, { cat: 'equipment', key: 'k:Клинок' });
    expect(sword.system).toMatchObject({ type: { value: 'martialM', baseItem: 'longsword' }, damage: { base: { number: 1, denomination: 8 } } });
    expect(Object.values(sword.system.activities)[0]).toMatchObject({ type: 'attack', attack: { type: { value: 'melee' } } });
    const gun = equipmentItem({ Name: 'Пистолет', ItemType: 'Weapon', Desc: '*Оружие (пистолет)*' }, { cat: 'equipment', key: 'k:П' });
    expect(gun.system.damage).toBeUndefined();
    expect(Object.keys(gun.system.activities).length).toBe(1);
  });
});
