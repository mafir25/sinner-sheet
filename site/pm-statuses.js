/* Правила статусов Project Moon для dnd5e (docs/foundry.md, этап 3 — «Статусы»). Без DOM и без Foundry:
   модуль pm5e (foundry-module/scripts/statuses.mjs) берёт отсюда, что делает каждый стак и когда стаки меняются.
   Тексты статусов — канон сайта (mechanics/statuses.json); здесь только механика, по тем же формулировкам.
   Тесты — tests/unit/pm-statuses.test.mjs.

   Статус: { id, ru, en, max, icon (путь в модуле: icons/pm/… — иконки сеттинга, icons/svg/… — Foundry), changes(s) → изменения Active Effect dnd5e, triggers: { roundStart, turnStart, turnEnd }
   (s, ctx) → { damage?, stacks, note? }, manual: [кнопки], note }. stacks: 0 — снять статус. */

const ADD = 2, MULTIPLY = 1, OVERRIDE = 5;   // CONST.ACTIVE_EFFECT_MODES
const ATTACKS = ['mwak', 'rwak', 'msak', 'rsak'];
const ch = (key, value, mode = ADD) => ({ key, mode, value: String(value) });
const attack = (v) => ATTACKS.map((k) => ch(`system.bonuses.${k}.attack`, v));
const damage = (v) => ATTACKS.map((k) => ch(`system.bonuses.${k}.damage`, v));
const ac = (v) => [ch('system.attributes.ac.bonus', v)];
const speed = (v) => [ch('system.attributes.movement.walk', v)];
const init = (v) => [ch('system.attributes.init.bonus', v)];
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
const half = (s) => Math.floor(s / 2);

/** Убыль «в начале/конце хода»: потерять n стаков, всё или половину. */
const lose = (n) => (s) => ({ stacks: Math.max(0, s - n) });
const clear = () => ({ stacks: 0 });
const halve = (s) => ({ stacks: half(s) });

/** Тремор и его виды: −1 КД за каждые 10 стаков. */
const tremorChanges = (s) => (s >= 10 ? ac(-Math.floor(s / 10)) : []);

export const STATUSES = [
  { id: 'burn', ru: 'Горение', en: 'Burn', max: 99, icon: 'icons/pm/limbus/Basic Effects/Burn/Burn.webp',
    // «Стаки Горения делятся на 1/3 от текущего количества (с округлением вниз)» — остаётся треть: 9 → 3 (заказчик, 2026-10-12)
    triggers: { roundStart: (s) => ({ damage: { value: s, type: 'fire' }, stacks: Math.floor(s / 3) }) } },
  { id: 'bleed', ru: 'Кровотечение', en: 'Bleed', max: 40, icon: 'icons/pm/limbus/Basic Effects/Bleed/Bleed.webp',
    // урон при действии, бонусном действии, реакции или перемещении — не чаще 2 раз за раунд (кроме реакций)
    onAct: (s) => ({ damage: { value: s, type: 'necrotic' }, stacks: Math.max(0, s - 4) }),
    onHeal: (s, healed) => ({ stacks: Math.max(0, s - Math.floor(healed / 2)) }),
    manual: [{ id: 'staunch', ru: 'Остановить кровь (−8)', en: 'Staunch (−8)', run: (s) => ({ stacks: Math.max(0, s - 8) }) }] },
  { id: 'tremor', ru: 'Тремор', en: 'Tremor', max: 99, icon: 'icons/pm/limbus/Basic Effects/Tremor/Tremor.webp', changes: tremorChanges, tremor: true },
  { id: 'tremor-superposition', ru: 'Тремор — Суперпозиция', en: 'Tremor - Superposition', max: 99, icon: 'icons/pm/limbus/Basic Effects/Tremor/Tremor - Superposition.webp', changes: tremorChanges, tremor: true },
  { id: 'tremor-reverberation', ru: 'Тремор — Реверберация', en: 'Tremor - Reverberation', max: 99, icon: 'icons/pm/limbus/Basic Effects/Tremor/Tremor - Reverb.webp', changes: tremorChanges, tremor: true,
    burst: (s) => ({ damage: { value: s, type: 'thunder' } }) },
  { id: 'tremor-scorch', ru: 'Тремор — Опаление', en: 'Tremor - Scorch', max: 99, icon: 'icons/pm/limbus/Basic Effects/Tremor/Tremor - Scorch.webp', changes: tremorChanges, tremor: true,
    burst: (s, ctx) => ({ damage: { value: Math.floor(((ctx.stacks?.burn || 0) + s) / 2), type: 'fire' } }) },
  { id: 'tremor-distribution', ru: 'Тремор — Распределение', en: 'Tremor - Distribution', max: 99, icon: 'icons/pm/limbus/Basic Effects/Tremor/Tremor - Distribution.webp',
    triggers: { turnStart: halve } },
  { id: 'tremor-chain', ru: 'Тремор — Цепь', en: 'Tremor - Chain', max: 99, icon: 'icons/pm/limbus/Basic Effects/Tremor/Tremor - Chain.webp', changes: tremorChanges, tremor: true },
  { id: 'tremor-decay', ru: 'Тремор — Распад', en: 'Tremor - Decay', max: 99, icon: 'icons/pm/limbus/Basic Effects/Tremor/Tremor - Decay.webp', changes: tremorChanges, tremor: true },
  { id: 'stagger', ru: 'Оглушение', en: 'Staggered', max: 1, icon: 'icons/pm/Statuses/Staggered.webp',
    changes: () => [...ac(-3), ch('system.abilities.str.bonuses.save', -3), ch('system.abilities.dex.bonuses.save', -3),
      ch('system.attributes.movement.walk', 0.5, MULTIPLY)],
    onApply: { bind: 2 },
    // снимается в начале второго хода существа после оглушения
    expireTurns: 2 },
  { id: 'rupture', ru: 'Разрыв', en: 'Rupture', max: 99, icon: 'icons/pm/limbus/Basic Effects/Rupture/Rupture.webp',
    manual: [{ id: 'burst', ru: 'Взорвать (крит)', en: 'Burst (crit)',
      run: (s) => ({ damage: { value: Math.floor(s >= 45 ? s * 1.1 : s), type: 'thunder' }, stacks: 0 }) }] },
  { id: 'sinking', ru: 'Потопление', en: 'Sinking', max: 99, icon: 'icons/pm/limbus/Basic Effects/Sinking/Sinking.webp',
    changes: (s) => {
      const p = Math.min(9, Math.floor(s / 5));
      return p ? [...attack(-p), ch('system.bonuses.abilities.check', -p), ch('system.bonuses.abilities.save', -p)] : [];
    },
    triggers: { turnEnd: halve },
    manual: [{ id: 'deluge', ru: 'Потоп', en: 'Deluge', run: (s) => ({ damage: { value: Math.floor(s >= 45 ? s * 1.1 : s), type: 'psychic' }, stacks: s }) }] },
  { id: 'poison', ru: 'Яд', en: 'Poison', max: 99, icon: 'icons/pm/limbus/Basic Effects/Poison.webp',
    // «каждый ход» — в начале хода существа; у истекающего кровью убывает на 4, а не на 5
    triggers: { turnStart: (s, ctx) => ({ damage: { value: half(s), type: 'poison' }, stacks: Math.max(0, s - (ctx.stacks?.bleed ? 4 : 5)) }) },
    condition: (s, ctx) => (s > (ctx.con ?? 99) ? 'poisoned' : null) },
  { id: 'poise', ru: 'Самообладание', en: 'Poise', max: 99, icon: 'icons/pm/limbus/Basic Effects/Poise/Poise.webp',
    changes: (s) => (s >= 5 ? [ch('flags.dnd5e.weaponCriticalThreshold', 20 - Math.floor(s / 5), OVERRIDE)] : []),
    triggers: { turnEnd: lose(1) } },
  { id: 'charge', ru: 'Заряд', en: 'Charge', max: 99, icon: 'icons/pm/limbus/Basic Effects/Charge/Charge.webp', triggers: { turnEnd: lose(1) } },
  { id: 'protection', ru: 'Защита', en: 'Protection', max: 99, icon: 'icons/pm/limbus/Basic Effects/Protection/Protection.webp', changes: (s) => ac(s), triggers: { turnEnd: lose(1) } },
  { id: 'haste', ru: 'Спешка', en: 'Haste', max: 99, icon: 'icons/pm/limbus/Basic Effects/Haste.webp',
    changes: (s) => [...init(s), ...speed(10 * s)],
    // сбрасывается в конце следующего хода владельца
    expireTurnEnds: 2 },
  { id: 'attack-up', ru: 'Повышение бросков атаки', en: 'Attack Roll Up', max: 99, icon: 'icons/pm/limbus/Basic Effects/Power Up/Attack Power Up.webp', changes: (s) => attack(s), triggers: { turnStart: clear } },
  { id: 'damage-up', ru: 'Повышение бросков урона', en: 'Damage Roll Up', max: 99, icon: 'icons/pm/limbus/Basic Effects/DMG Up/Damage Up.webp', changes: (s) => damage(s), triggers: { turnStart: clear } },
  { id: 'clash-up', ru: 'Повышение бросков столкновения', en: 'Clash Roll Up', max: 99, icon: 'icons/pm/limbus/Basic Effects/Power Up/Clash Power Up.webp', triggers: { turnStart: clear } },
  { id: 'offense-up', ru: 'Повышение уровня нападения', en: 'Offense Level Up', max: 99, icon: 'icons/pm/limbus/Basic Effects/Power Up/Offense Level Up.webp', triggers: { turnStart: clear } },
  { id: 'defense-up', ru: 'Повышение уровня защиты', en: 'Defense Level Up', max: 99, icon: 'icons/pm/limbus/Basic Effects/Power Up/Defense Power Up.webp', triggers: { turnStart: clear } },
  { id: 'aggro', ru: 'Аггро', en: 'Aggro', max: 99, icon: 'icons/pm/limbus/Basic Effects/Aggro.webp', triggers: { turnStart: lose(1) } },
  { id: 'fragile', ru: 'Хрупкость', en: 'Fragile', max: 99, icon: 'icons/pm/limbus/Basic Effects/Fragility/Fragile.webp', changes: (s) => ac(-s), triggers: { turnEnd: clear } },
  { id: 'paralysis', ru: 'Паралич', en: 'Paralysis', max: 99, icon: 'icons/pm/limbus/Basic Effects/Paralyze.webp', triggers: { turnEnd: clear } },
  { id: 'bind', ru: 'Оковы', en: 'Bind', max: 99, icon: 'icons/pm/limbus/Basic Effects/Bind.webp',
    changes: (s) => [...init(-s), ...speed(-10 * s)], triggers: { turnEnd: clear },
    condition: (s, ctx) => (ctx.walk != null && ctx.walk - 10 * s <= 0 ? 'restrained' : null) },
  { id: 'attack-down', ru: 'Понижение бросков атаки', en: 'Attack Roll Down', max: 99, icon: 'icons/pm/limbus/Basic Effects/Power Down/Attack Power Down.webp', changes: (s) => attack(-s), triggers: { turnStart: clear } },
  { id: 'damage-down', ru: 'Понижение бросков урона', en: 'Damage Roll Down', max: 99, icon: 'icons/pm/limbus/Basic Effects/DMG Down/Damage Down.webp', changes: (s) => damage(-s), triggers: { turnStart: clear } },
  { id: 'clash-down', ru: 'Понижение бросков столкновения', en: 'Clash Roll Down', max: 99, icon: 'icons/pm/limbus/Basic Effects/Power Down/Clash Power Down.webp', triggers: { turnStart: clear } },
  { id: 'offense-down', ru: 'Понижение уровня нападения', en: 'Offense Level Down', max: 99, icon: 'icons/pm/limbus/Basic Effects/Power Down/Offense Level Down.webp', triggers: { turnStart: clear } },
  { id: 'defense-down', ru: 'Понижение уровня защиты', en: 'Defense Level Down', max: 99, icon: 'icons/pm/limbus/Basic Effects/Power Down/Defense Power Down.webp', triggers: { turnStart: clear } },
  { id: 'smoke', ru: 'Дым', en: 'Smoke', max: 30, icon: 'icons/pm/Statuses/Smoke.webp',
    changes: (s) => (s >= 10 ? attack(Math.floor(s / 10)) : []), triggers: { turnEnd: lose(1) } },
  { id: 'nullify', ru: 'Аннулирование силы', en: 'Nullify Power', max: 99, icon: 'icons/svg/cancel.svg' },
  { id: 'erosion', ru: 'Эрозия', en: 'Erosion', max: 99, icon: 'icons/svg/acid.svg',
    triggers: { turnEnd: (s) => ({ damage: { value: s }, stacks: s - 1 }) } },
  { id: 'fairy', ru: 'Фея', en: 'Fairy', max: 99, icon: 'icons/pm/limbus/Misc ID EGO Specific/Fairy Lure.webp',
    triggers: { turnEnd: (s) => ({ damage: { value: s }, stacks: half(s) }) } },
  { id: 'sheut-fracture', ru: 'Разлом Шеут', en: 'Sheut Fracture', max: 10, icon: 'icons/pm/limbus/Basic Effects/Sinking/Sheut Fracture.webp' },
  { id: 'blue-sand', ru: 'Синий песок', en: 'Blue Sand', max: 3, icon: 'icons/pm/limbus/Basic Effects/Sinking/Blue Sand.webp', changes: (s) => speed(-5 * s) },
  { id: 'blue-sandstorm', ru: 'Синяя песчаная буря', en: 'Blue Sandstorm', max: 3, icon: 'icons/pm/limbus/Basic Effects/Sinking/Blue Sand.webp', changes: (s) => speed(-10 * s) },
  { id: 'addiction', ru: 'Зависимость', en: 'Addiction', max: 99, icon: 'icons/svg/degen.svg' },
  { id: 'charred-smoke', ru: 'Обугленный дым', en: 'Charred Smoke', max: 4, icon: 'icons/pm/limbus/Walpurgis/Smoke.webp' },
  { id: 'smoke-overflow', ru: 'Дым — Переполнение', en: 'Smoke - Overflowing', max: 99, icon: 'icons/pm/Statuses/Smoke.webp' },
  { id: 'courier-trunk', ru: 'Курьерский сундук', en: 'Courier Trunk', max: 99, icon: 'icons/pm/limbus/Basic Effects/Factions/Devyat/Courier Trunk.webp' },
];
/** Не статусы, а мгновенные эффекты (Взрыв Тремора, Потоп, Преобразование…) — кнопки на строках статусов, не стаки. */
export const INSTANT = ['Взрыв Тремора', 'Tremor Burst', 'Потоп', 'Sinking Deluge', 'Преобразование амплитуды', 'Amplitude Conversion',
  'Сцепление амплитуды', 'Amplitude Entanglement'];

const BY_ID = new Map(STATUSES.map((s) => [s.id, s]));
const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[‐-―-]/g, '-').replace(/\s+/g, ' ').trim();
const BY_NAME = new Map(STATUSES.flatMap((s) => [[norm(s.ru), s], [norm(s.en), s]]));

export const statusById = (id) => BY_ID.get(id) || null;
/** Статус по названию из канона (рус. или англ.). */
export const statusByName = (name) => BY_NAME.get(norm(name)) || null;
export const statusName = (st, lang = 'ru') => (lang === 'en' ? st.en : st.ru);
export const clampStacks = (st, n) => Math.max(0, Math.min(st.max ?? 99, Math.floor(Number(n) || 0)));

/** Изменения Active Effect для текущего числа стаков. */
export const statusChanges = (st, s) => (s > 0 && st.changes ? st.changes(s) : []);

/**
 * Что делать в момент when ('roundStart' | 'turnStart' | 'turnEnd') со статусами существа.
 * list: [{ id, stacks, turns?, turnEnds? }], ctx: { con, walk, stacks: { id: n } }.
 * → [{ id, stacks (новые), damage?, expired? }] — только статусы, с которыми что-то происходит.
 */
export function tick(when, list, ctx = {}) {
  const stacks = { ...(ctx.stacks || Object.fromEntries(list.map((x) => [x.id, x.stacks]))) };
  const out = [];
  for (const x of list) {
    const st = statusById(x.id);
    if (!st || !(x.stacks > 0)) continue;
    const r = { id: x.id, from: x.stacks, stacks: x.stacks };
    const fn = st.triggers?.[when];
    if (fn) Object.assign(r, fn(x.stacks, { ...ctx, stacks }));
    if (when === 'turnStart' && st.expireTurns) { r.turns = (x.turns || 0) + 1; if (r.turns >= st.expireTurns) r.stacks = 0; }
    if (when === 'turnEnd' && st.expireTurnEnds) { r.turnEnds = (x.turnEnds || 0) + 1; if (r.turnEnds >= st.expireTurnEnds) r.stacks = 0; }
    r.stacks = clampStacks(st, r.stacks);
    if (r.damage && !(r.damage.value > 0)) delete r.damage;
    if (r.stacks !== x.stacks || r.damage || r.turns !== undefined || r.turnEnds !== undefined) out.push(r);
  }
  return out;
}

/**
 * Взрыв Тремора: СЛ спасброска Телосложения = стаки Тремора; урон вида Тремора (Реверберация, Опаление); Тремор — вдвое.
 * Нужно ≥ 10 стаков (+10 за каждый следующий взрыв — считает ДМ). → { dc, damage?, stacks } или null.
 */
export function tremorBurst(id, s, ctx = {}) {
  const st = statusById(id);
  if (!st?.tremor || s < (ctx.min ?? 10)) return null;
  return { dc: s, ...(st.burst ? st.burst(s, ctx) : {}), stacks: half(s) };
}

/** Состояния dnd5e, которые статус включает сейчас (Яд → отравленный, Оковы → опутанный). */
export const statusCondition = (st, s, ctx = {}) => (s > 0 && st.condition ? st.condition(s, ctx) : null);

export { signed };
