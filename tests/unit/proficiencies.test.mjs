import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseClassProfs, profTalent, checkProfs, skillBonus } from '../../site/proficiencies.js';

const talents = (lang, f) => {
  const b = JSON.parse(readFileSync(new URL(`../../Assets/${lang}/characters/${f}.json`, import.meta.url), 'utf8'));
  return (b[0] || b).Talents;
};

describe('parseClassProfs', () => {
  it('Фиксер и Кровосос (RU и EN): по одному спасброску из двух групп, три навыка из восьми', () => {
    for (const lang of ['Rus', 'Eng']) for (const f of ['fixer', 'bloodfiend']) {
      expect(parseClassProfs(profTalent(talents(lang, f)).desc)).toEqual({
        saveGroups: [['wis', 'dex', 'con'], ['int', 'str', 'cha']],
        skillCount: 3,
        skillOptions: ['ath', 'acr', 'inv', 'sur', 'ste', 'per', 'prc', 'med'],
      });
    }
  });
  it('обязательные спасброски и группы с «или»', () => {
    expect(parseClassProfs('**Спасброски:** Сила и Телосложение').saveGroups).toEqual([['str'], ['con']]);
    expect(parseClassProfs('**Спасброски:** Сила, Телосложение').saveGroups).toEqual([['str'], ['con']]);
    expect(parseClassProfs('**Saving Throws:** Strength or Dexterity, and Wisdom').saveGroups).toEqual([['str', 'dex'], ['wis']]);
  });
  it('количество навыков словом или числом; нет текста — пусто', () => {
    expect(parseClassProfs('**Навыки:** выберите два из: Атлетика, Обман')).toMatchObject({ skillCount: 2, skillOptions: ['ath', 'dec'] });
    expect(parseClassProfs('**Skills:** Choose 4 from Stealth').skillCount).toBe(4);
    expect(parseClassProfs('')).toEqual({ saveGroups: [], skillCount: 0, skillOptions: [] });
  });
});

describe('checkProfs', () => {
  const rules = { saveGroups: [['wis', 'dex', 'con'], ['int', 'str', 'cha']], skillCount: 3, skillOptions: ['ath', 'acr', 'ste', 'prc'] };
  it('по правилам — без замечаний; навыки сверх класса не ошибка', () => {
    expect(checkProfs({ saves: ['dex', 'str'], skills: { ath: 1, ste: 1, prc: 2, arc: 1 } }, rules)).toEqual([]);
  });
  it('замечания: группа без выбора, два из одной группы, спасбросок не по классу, мало навыков', () => {
    expect(checkProfs({ saves: ['dex', 'wis'], skills: { ath: 1 } }, rules)).toEqual([
      { kind: 'saves', group: 0, n: 2 }, { kind: 'saves', group: 1, n: 0 }, { kind: 'skills', n: 1, need: 3 },
    ]);
    expect(checkProfs({ saves: ['dex', 'str'], skills: {} }, { ...rules, saveGroups: [['dex']], skillCount: 0 }))
      .toEqual([{ kind: 'saves-extra', keys: ['str'] }]);
  });
  it('бонус навыка', () => {
    expect(skillBonus(2, 3, 0)).toBe(2);
    expect(skillBonus(2, 3, 1)).toBe(5);
    expect(skillBonus(2, 3, 2)).toBe(8);
  });
});
