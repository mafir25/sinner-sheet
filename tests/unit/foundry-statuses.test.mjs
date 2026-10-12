import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import JSZip from 'jszip';

const root = new URL('../..', import.meta.url).pathname;

/** Мини-Foundry: актёр с Active Effects, хуки, бой, чат. */
function fakeWorld() {
  const hooks = {}, chat = [], damage = [], toggled = [];
  let id = 0;
  class Effect {
    constructor(data, parent) { Object.assign(this, structuredClone(data)); this.id = `e${++id}`; this.parent = parent; this.statuses = new Set(data.statuses || []); }
    async update(d) { Object.assign(this, structuredClone(d)); this.statuses = new Set(d.statuses || [...this.statuses]); }
    async delete() { this.parent.effects.delete(this.id); }
    updateSource(d) { Object.assign(this, structuredClone(d)); }
  }
  const actor = (name, con = 14) => {
    const a = {
      name, uuid: `Actor.${name}`, isOwner: true, effects: new Map(), statuses: new Set(),
      system: { abilities: { con: { value: con } }, attributes: { hp: { value: 50 }, movement: { walk: 30 } } },
      async createEmbeddedDocuments(type, list) { for (const d of list) { const e = new Effect(d, a); a.effects.set(e.id, e); } },
      async applyDamage(d) { damage.push([name, d]); },
      async toggleStatusEffect(s, { active }) { toggled.push([name, s, active]); if (active) a.statuses.add(s); else a.statuses.delete(s); },
    };
    a.effects[Symbol.iterator] = function* () { yield* a.effects.values(); };
    return a;
  };
  const g = {
    Hooks: { on: (h, f) => { (hooks[h] ||= []).push(f); }, once: (h, f) => { (hooks[h] ||= []).push(f); } },
    game: { i18n: { lang: 'ru', localize: (k) => k, format: (k, d) => `${k}${JSON.stringify(d)}` },
      settings: { get: () => true, register() {} }, user: { id: 'u1', isGM: true }, users: { activeGM: { isSelf: true } }, combat: null },
    CONFIG: { statusEffects: [{ id: 'poisoned' }] },
    ChatMessage: { create: async (m) => chat.push(m.content), getSpeaker: () => ({}) },
    ui: { notifications: { info() {}, warn() {} } },
    canvas: { tokens: { controlled: [] } },
  };
  return { g, hooks, chat, damage, toggled, actor };
}

describe('модуль: статусы на имитации Foundry', () => {
  let S, W;
  beforeAll(async () => {
    execFileSync('node', [join(root, 'scripts/build-foundry-module.mjs'), '9.9.9'], { cwd: root });
    const zip = await JSZip.loadAsync(readFileSync(join(root, 'dist-foundry/pm5e.zip')));
    const dir = join(root, 'dist-foundry', 'unpacked-st');
    for (const [name, f] of Object.entries(zip.files)) {
      if (f.dir) continue;
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), await f.async('nodebuffer'));
    }
    W = fakeWorld();
    Object.assign(globalThis, W.g);
    S = await import(/* @vite-ignore */ join(dir, 'scripts/statuses.mjs'));
    S.initStatuses();
  });

  it('стаки: эффект с изменениями и значком; Оглушение добавляет 2 Оков; 0 — снимает', async () => {
    const a = W.actor('Жаба');
    await S.setStacks(a, 'tremor', 25);
    const e = [...a.effects.values()][0];
    expect(e).toMatchObject({ name: 'Тремор 25', img: 'modules/pm5e/icons/Tremor.png', flags: { pm5e: { status: { id: 'tremor', stacks: 25 } } } });
    expect([...e.statuses]).toEqual(['pm5e-tremor']);
    expect(e.changes).toEqual([{ key: 'system.attributes.ac.bonus', mode: 2, value: '-2' }]);
    await S.addStacks(a, 'tremor', 100);
    expect(S.getStacks(a, 'tremor')).toBe(99);
    await S.setStacks(a, 'stagger', 1);
    expect(S.getStacks(a, 'bind')).toBe(2);
    await S.setStacks(a, 'tremor', 0);
    expect(S.getStacks(a, 'tremor')).toBe(0);
    expect(CONFIG.statusEffects.some((s) => s.id === 'pm5e-burn' && s.img === 'modules/pm5e/icons/Burn.png')).toBe(true);
  });

  it('значок из меню токена становится статусом с 1 стаком', () => {
    const eff = { statuses: new Set(['pm5e-sinking']), flags: {}, updateSource(d) { Object.assign(this, d); } };
    W.hooks.preCreateActiveEffect[0](eff);
    expect(eff.flags.pm5e.status).toEqual({ id: 'sinking', stacks: 1 });
    expect(eff.name).toBe('Потопление 1');
  });

  it('бой: начало раунда, конец и начало хода — урон, убыль, отчёт в чат; Яд включает «отравленный»', async () => {
    const a = W.actor('А', 10), b = W.actor('Б');
    await S.setStacks(a, 'burn', 9); await S.setStacks(a, 'sinking', 11);
    await S.setStacks(b, 'poison', 20);
    expect(W.toggled).toContainEqual(['Б', 'poisoned', true]);
    const combatants = new Map([['c1', { id: 'c1', actor: a }], ['c2', { id: 'c2', actor: b }]]);
    combatants[Symbol.iterator] = function* () { yield* combatants.values(); };
    const combat = { id: 'cb', round: 1, combatant: combatants.get('c1'), combatants };
    const upd = W.hooks.updateCombat[0];
    W.damage.length = 0; W.chat.length = 0;
    await upd(combat, { round: 1, turn: 0 }, {});                 // начало боя: раунд 1, ход А
    expect(W.damage).toEqual([['А', [{ value: 9, type: 'fire' }]]]);
    expect(S.getStacks(a, 'burn')).toBe(6);
    combat.combatant = combatants.get('c2');
    await upd(combat, { turn: 1 }, {});                           // конец хода А, начало хода Б
    expect(S.getStacks(a, 'sinking')).toBe(5);
    expect(W.damage.at(-1)).toEqual(['Б', [{ value: 10, type: 'poison' }]]);
    expect(S.getStacks(b, 'poison')).toBe(15);
    expect(W.chat.some((c) => c.includes('Горение') && c.includes('9 → 6'))).toBe(true);
    const n = W.damage.length;
    await upd(combat, { turn: 0 }, { direction: -1 });            // откат — без автоматики
    expect(W.damage.length).toBe(n);
  });
});
