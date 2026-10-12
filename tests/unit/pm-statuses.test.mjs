import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { STATUSES, INSTANT, statusByName, statusById, statusChanges, tick, tremorBurst, statusCondition, clampStacks } from '../../site/pm-statuses.js';

const canon = (lang) => JSON.parse(readFileSync(new URL(`../../Assets/${lang}/mechanics/statuses.json`, import.meta.url), 'utf8'));

describe('статусы канона', () => {
  it('каждый статус сайта (RU и EN) — либо правило, либо мгновенный эффект', () => {
    for (const lang of ['Rus', 'Eng']) {
      for (const s of canon(lang)) expect(statusByName(s.Name) || INSTANT.includes(s.Name), `${lang}: ${s.Name}`).toBeTruthy();
    }
  });
  it('id уникальны, у всех есть максимум и значок', () => {
    expect(new Set(STATUSES.map((s) => s.id)).size).toBe(STATUSES.length);
    for (const s of STATUSES) { expect(s.max).toBeGreaterThan(0); expect(s.icon).toMatch(/^icons\//); }
    expect(clampStacks(statusById('bleed'), 55)).toBe(40);
    expect(clampStacks(statusById('smoke'), -3)).toBe(0);
  });
});

describe('изменения по стакам', () => {
  const val = (list, key) => list.find((c) => c.key === key)?.value;
  it('Тремор: −1 КД за каждые 10', () => {
    expect(statusChanges(statusById('tremor'), 9)).toEqual([]);
    expect(val(statusChanges(statusById('tremor-chain'), 25), 'system.attributes.ac.bonus')).toBe('-2');
  });
  it('Потопление: −1 к атакам, проверкам и спасброскам за каждые 5, не больше −9', () => {
    const c = statusChanges(statusById('sinking'), 12);
    expect(val(c, 'system.bonuses.mwak.attack')).toBe('-2');
    expect(val(c, 'system.bonuses.abilities.save')).toBe('-2');
    expect(val(statusChanges(statusById('sinking'), 99), 'system.bonuses.rsak.attack')).toBe('-9');
  });
  it('Оглушение, Защита, Спешка, Оковы, Самообладание', () => {
    const st = statusChanges(statusById('stagger'), 1);
    expect(val(st, 'system.attributes.ac.bonus')).toBe('-3');
    expect(st.find((c) => c.key === 'system.attributes.movement.walk')).toMatchObject({ mode: 1, value: '0.5' });
    expect(val(statusChanges(statusById('protection'), 3), 'system.attributes.ac.bonus')).toBe('3');
    expect(val(statusChanges(statusById('haste'), 2), 'system.attributes.movement.walk')).toBe('20');
    expect(val(statusChanges(statusById('bind'), 2), 'system.attributes.init.bonus')).toBe('-2');
    expect(val(statusChanges(statusById('poise'), 10), 'flags.dnd5e.weaponCriticalThreshold')).toBe('18');
  });
});

describe('моменты боя', () => {
  it('начало раунда: Горение — урон огнём, теряется треть', () => {
    expect(tick('roundStart', [{ id: 'burn', stacks: 9 }])).toEqual([{ id: 'burn', from: 9, stacks: 6, damage: { value: 9, type: 'fire' } }]);
    expect(tick('roundStart', [{ id: 'poison', stacks: 9 }])).toEqual([]);
  });
  it('начало хода: Яд (−5, при Кровотечении −4), временные бонусы сгорают, Аггро −1', () => {
    expect(tick('turnStart', [{ id: 'poison', stacks: 9 }])[0]).toMatchObject({ stacks: 4, damage: { value: 4, type: 'poison' } });
    expect(tick('turnStart', [{ id: 'poison', stacks: 9 }, { id: 'bleed', stacks: 3 }])[0]).toMatchObject({ stacks: 5 });
    expect(tick('turnStart', [{ id: 'attack-up', stacks: 2 }, { id: 'aggro', stacks: 3 }]).map((r) => r.stacks)).toEqual([0, 2]);
  });
  it('конец хода: Потопление вдвое, Хрупкость и Оковы — всё, Эрозия и Фея наносят урон', () => {
    const r = tick('turnEnd', [{ id: 'sinking', stacks: 11 }, { id: 'fragile', stacks: 3 }, { id: 'bind', stacks: 2 },
      { id: 'erosion', stacks: 3 }, { id: 'fairy', stacks: 5 }, { id: 'tremor', stacks: 20 }]);
    expect(r.map((x) => [x.id, x.stacks, x.damage?.value ?? null])).toEqual([
      ['sinking', 5, null], ['fragile', 0, null], ['bind', 0, null], ['erosion', 2, 3], ['fairy', 2, 5]]);
  });
  it('Оглушение снимается в начале второго хода, Спешка — в конце второго', () => {
    const [a] = tick('turnStart', [{ id: 'stagger', stacks: 1 }]);
    expect(a).toMatchObject({ turns: 1, stacks: 1 });
    expect(tick('turnStart', [{ id: 'stagger', stacks: 1, turns: 1 }])[0]).toMatchObject({ turns: 2, stacks: 0 });
    expect(tick('turnEnd', [{ id: 'haste', stacks: 2 }])[0]).toMatchObject({ turnEnds: 1, stacks: 2 });
    expect(tick('turnEnd', [{ id: 'haste', stacks: 2, turnEnds: 1 }])[0]).toMatchObject({ stacks: 0 });
  });
  it('Взрыв Тремора: СЛ = стаки, Тремор вдвое, урон у Реверберации и Опаления; меньше 10 — нельзя', () => {
    expect(tremorBurst('tremor', 15)).toEqual({ dc: 15, stacks: 7 });
    expect(tremorBurst('tremor-reverberation', 20)).toEqual({ dc: 20, stacks: 10, damage: { value: 20, type: 'thunder' } });
    expect(tremorBurst('tremor-scorch', 20, { stacks: { burn: 10 } }).damage).toEqual({ value: 15, type: 'fire' });
    expect(tremorBurst('tremor', 9)).toBeNull();
    expect(tremorBurst('burn', 30)).toBeNull();
  });
  it('Кровотечение, Разрыв, Потоп, состояния', () => {
    expect(statusById('bleed').onAct(10)).toEqual({ damage: { value: 10, type: 'necrotic' }, stacks: 6 });
    expect(statusById('bleed').onHeal(10, 7)).toEqual({ stacks: 7 });
    expect(statusById('rupture').manual[0].run(50)).toEqual({ damage: { value: 55, type: 'thunder' }, stacks: 0 });
    expect(statusCondition(statusById('poison'), 15, { con: 14 })).toBe('poisoned');
    expect(statusCondition(statusById('poison'), 14, { con: 14 })).toBeNull();
    expect(statusCondition(statusById('bind'), 3, { walk: 30 })).toBe('restrained');
  });
});
