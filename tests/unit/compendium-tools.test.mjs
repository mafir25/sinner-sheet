import { describe, it, expect } from 'vitest';
import { fusionTier, parseChallenge, encounterBudget, rateEncounter } from '../../site/compendium-tools.js';

describe('fusionTier', () => {
  it('2 гифта — средний тир, округление вниз', () => {
    expect(fusionTier([1, 2])).toBe(1);
    expect(fusionTier([3, 3])).toBe(3);
    expect(fusionTier([2, 4])).toBe(3);
  });
  it('3 гифта — на тир выше среднего, округление вверх', () => {
    expect(fusionTier([1, 1, 1])).toBe(2);
    expect(fusionTier([1, 1, 2])).toBe(3);
    expect(fusionTier([2, 3, 3])).toBe(4);
  });
  it('не выше максимального тира', () => {
    expect(fusionTier([4, 4, 4])).toBe(5);
    expect(fusionTier([5, 5, 5])).toBe(5);
    expect(fusionTier([4, 4, 4], 4)).toBe(4);
  });
  it('один гифт, больше трёх или без тира — нет результата', () => {
    expect(fusionTier([2])).toBeNull();
    expect(fusionTier([1, 1, 1, 1])).toBeNull();
    expect(fusionTier([1, 'x'])).toBeNull();
  });
});

describe('parseChallenge', () => {
  it('берёт опыт из скобок, в том числе с неразрывными пробелами', () => {
    expect(parseChallenge('5 (1 800 опыта)')).toEqual({ cr: 5, label: '5', xp: 1800 });
    expect(parseChallenge('30 (50 000 опыта)')).toEqual({ cr: 30, label: '30', xp: 50000 });
  });
  it('дроби и опасность без опыта', () => {
    expect(parseChallenge('1/4 (50 опыта)')).toEqual({ cr: 0.25, label: '1/4', xp: 50 });
    expect(parseChallenge('7')).toEqual({ cr: 7, label: '7', xp: 2900 });
  });
  it('неизвестная опасность', () => {
    expect(parseChallenge('? (? опыта)')).toEqual({ cr: null, label: '? (? опыта)', xp: 0 });
    expect(parseChallenge('')).toEqual({ cr: null, label: '?', xp: 0 });
  });
});

describe('encounterBudget / rateEncounter', () => {
  it('группа одного уровня', () => {
    expect(encounterBudget(1, 4)).toEqual({ low: 200, moderate: 300, high: 400 });
    expect(encounterBudget(5, 4)).toEqual({ low: 2000, moderate: 3000, high: 4400 });
  });
  it('группа разных уровней, уровни за пределами 1–20 обрезаются', () => {
    expect(encounterBudget([1, 2, 25])).toEqual({ low: 50 + 100 + 6400, moderate: 75 + 150 + 13200, high: 100 + 200 + 22000 });
  });
  it('оценка сложности', () => {
    const b = encounterBudget(1, 4);
    expect(rateEncounter(0, b)).toBe('');
    expect(rateEncounter(200, b)).toBe('low');
    expect(rateEncounter(250, b)).toBe('moderate');
    expect(rateEncounter(400, b)).toBe('high');
    expect(rateEncounter(401, b)).toBe('over');
  });
});
