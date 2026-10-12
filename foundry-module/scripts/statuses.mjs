/* Статусы Project Moon в Foundry (docs/foundry.md, этап 3 — «Статусы»). Правила — pm-statuses.js (общий с сайтом, тесты).
   - Статус = Active Effect актёра: flags.pm5e.status = { id, stacks, turns?, turnEnds? }, statuses: ['pm5e-<id>'] (значок на токене),
     изменения dnd5e (КД, атаки, спасброски, скорость…) пересчитываются от числа стаков.
   - Меню токена: статусы в палитре (щелчок — 1 стак), стаки — на панели статусов выделенного токена.
   - Автоматика боя (у активного мастера): начало раунда, начало и конец хода — урон, убыль стаков, состояния; отчёт в чат.
   - Кровотечение: урон при использовании умения/предмета и при перемещении в бою (не больше 2 раз за раунд, реакции — всегда);
     исцеление снимает половину исцелённого. */
import { STATUSES, statusById, statusName, clampStacks, statusChanges, tick, tremorBurst, statusCondition } from './pm-statuses.js';

const ID = 'pm5e';
const t = (k, data) => (data ? game.i18n.format(k, data) : game.i18n.localize(k));
const lang = () => (game.i18n.lang === 'en' ? 'en' : 'ru');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const iconPath = (p) => (p.startsWith('icons/svg/') ? p : `modules/${ID}/${p}`);
const flagOf = (e) => e?.flags?.[ID]?.status;
const isActiveGM = () => (game.users.activeGM ? game.users.activeGM.isSelf : game.user.isGM);
const DMG_NAME = { fire: 'огнём', necrotic: 'некротической энергией', poison: 'ядом', psychic: 'психической энергией', thunder: 'звуком' };

/* ---------- стаки ---------- */
export const statusEffects = (actor) => (actor?.effects ? [...actor.effects].filter((e) => flagOf(e)?.id) : []);
const effectOf = (actor, id) => statusEffects(actor).find((e) => flagOf(e).id === id);
export const getStacks = (actor, id) => flagOf(effectOf(actor, id))?.stacks || 0;
const stacksMap = (actor) => Object.fromEntries(statusEffects(actor).map((e) => [flagOf(e).id, flagOf(e).stacks]));

/** Данные Active Effect статуса для stacks стаков. */
function effectData(st, s, extra = {}) {
  return {
    name: `${statusName(st, lang())} ${s}`,
    img: iconPath(st.icon),
    changes: statusChanges(st, s),
    statuses: [`${ID}-${st.id}`],
    flags: { [ID]: { status: { id: st.id, stacks: s, ...extra } } },
  };
}

/** Поставить число стаков (0 — снять). extra — служебные счётчики (turns, turnEnds). */
export async function setStacks(actor, id, n, extra) {
  const st = statusById(id);
  if (!st || !actor) return 0;
  const s = clampStacks(st, n);
  const eff = effectOf(actor, id);
  if (!s) { if (eff) await eff.delete(); }
  else if (eff) {
    const keep = extra ?? { turns: flagOf(eff).turns, turnEnds: flagOf(eff).turnEnds };
    await eff.update(effectData(st, s, Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined))));
  } else {
    await actor.createEmbeddedDocuments('ActiveEffect', [effectData(st, s, extra || {})]);
    for (const [other, k] of Object.entries(st.onApply || {})) await addStacks(actor, other, k);   // Оглушение → 2 Оков
  }
  await syncCondition(actor, st, s);
  return s;
}
export const addStacks = (actor, id, n) => setStacks(actor, id, getStacks(actor, id) + n);

/** Состояние dnd5e от статуса (Яд → отравленный, Оковы до скорости 0 → опутанный). */
async function syncCondition(actor, st, s) {
  if (!st.condition || typeof actor.toggleStatusEffect !== 'function') return;
  const walk = Number(actor.system?.attributes?.movement?.walk ?? 0) + 10 * getStacks(actor, 'bind');   // скорость без Оков
  const cond = statusCondition(st, s, { con: actor.system?.abilities?.con?.value, walk });
  const want = st.id === 'poison' ? 'poisoned' : 'restrained';
  const has = actor.statuses?.has?.(want);
  if (!!cond !== !!has) await actor.toggleStatusEffect(want, { active: !!cond });
}

/** Урон с типом dnd5e (сопротивления учитываются). */
async function hurt(actor, dmg) {
  if (!dmg?.value) return;
  try { await actor.applyDamage(dmg.type ? [{ value: dmg.value, type: dmg.type }] : dmg.value); }
  catch (e) { console.warn(`${ID} | applyDamage`, e); await actor.applyDamage(dmg.value); }
}

/** Применить результат правила (tick, кнопки) и вернуть строку для чата. */
async function apply(actor, r) {
  const st = statusById(r.id);
  const name = statusName(st, lang());
  if (r.damage) await hurt(actor, r.damage);
  const extra = {};
  if (r.turns !== undefined) extra.turns = r.turns;
  if (r.turnEnds !== undefined) extra.turnEnds = r.turnEnds;
  if (r.stacks !== undefined && (r.stacks !== r.from || Object.keys(extra).length)) await setStacks(actor, r.id, r.stacks, Object.keys(extra).length ? extra : undefined);
  const parts = [];
  if (r.damage) parts.push(t('PM5E.Status.Damage', { n: r.damage.value, type: lang() === 'en' ? (r.damage.type || '') : (DMG_NAME[r.damage.type] || '') }).trim());
  if (r.stacks !== r.from && r.from !== undefined) parts.push(r.stacks ? `${r.from} → ${r.stacks}` : t('PM5E.Status.Removed'));
  if (r.dc) parts.push(t('PM5E.Status.BurstSave', { dc: r.dc }));
  return parts.length ? `<li><b>${esc(name)}</b>: ${parts.map(esc).join(', ')}</li>` : '';
}

async function report(actor, title, lines) {
  const body = lines.filter(Boolean).join('');
  if (!body) return;
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="pm5e-chat"><h4>${esc(title)}</h4><ul>${body}</ul></div>` });
}

/** Момент боя для одного актёра: правила всех его статусов. */
export async function runTick(when, actor) {
  if (!actor) return;
  const list = statusEffects(actor).map((e) => ({ ...flagOf(e) }));
  if (!list.length) return;
  const res = tick(when, list, { con: actor.system?.abilities?.con?.value, stacks: stacksMap(actor) });
  const lines = [];
  for (const r of res) lines.push(await apply(actor, r));
  await report(actor, t(`PM5E.Status.${when}`, { name: actor.name }), lines);
}

/* ---------- автоматика боя ---------- */
const LAST = new Map();   // combat.id → { round, combatant }
async function onUpdateCombat(combat, changed, options) {
  if (!isActiveGM() || !game.settings.get(ID, 'statusAutomation')) return;
  if (!('turn' in changed) && !('round' in changed)) return;
  const prev = LAST.get(combat.id) || { round: 0, combatant: null };
  const now = { round: combat.round, combatant: combat.combatant?.id ?? null };
  LAST.set(combat.id, now);
  const back = options?.direction === -1 || now.round < prev.round;
  if (back) return;                                         // откат хода — без автоматики
  if (prev.combatant && prev.combatant !== now.combatant) await runTick('turnEnd', combat.combatants.get(prev.combatant)?.actor);
  if (now.round > prev.round) for (const c of combat.combatants) await runTick('roundStart', c.actor);
  if (now.combatant && now.combatant !== prev.combatant) await runTick('turnStart', combat.combatant.actor);
}

/* Кровотечение: не больше двух раз за раунд, реакции — всегда */
const BLEED = new Map();
async function bleedOnAct(actor, reaction = false) {
  const s = getStacks(actor, 'bleed');
  if (!s || !game.combat?.started || !game.settings.get(ID, 'statusAutomation')) return;
  const key = `${actor.uuid}:${game.combat.round}`;
  const n = BLEED.get(key) || 0;
  if (!reaction && n >= 2) return;
  if (!reaction) BLEED.set(key, n + 1);
  const r = { id: 'bleed', from: s, ...statusById('bleed').onAct(s) };
  await report(actor, t('PM5E.Status.Bleeding', { name: actor.name }), [await apply(actor, r)]);
}

/* ---------- палитра меню токена и панель статусов ---------- */
function registerStatusEffects() {
  if (!game.settings.get(ID, 'hudStatuses')) return;
  for (const st of STATUSES) {
    if (CONFIG.statusEffects.some((s) => s.id === `${ID}-${st.id}`)) continue;
    CONFIG.statusEffects.push({ id: `${ID}-${st.id}`, name: statusName(st, lang()), img: iconPath(st.icon) });
  }
}
/** Значок из меню токена создаёт голый эффект — превращаем его в статус с 1 стаком. */
function onPreCreateEffect(effect) {
  if (flagOf(effect)) return;
  const sid = [...(effect.statuses || [])].find((s) => String(s).startsWith(`${ID}-`));
  const st = sid && statusById(sid.slice(ID.length + 1));
  if (st) effect.updateSource(effectData(st, 1));
}

let TRAY = null;
const trayActor = () => { const list = canvas?.tokens?.controlled || []; return list.length === 1 ? list[0].actor : null; };
export function renderTray() {
  if (!game.settings.get(ID, 'statusTray')) { TRAY?.remove(); TRAY = null; return; }
  const actor = trayActor();
  if (!actor) { TRAY?.remove(); TRAY = null; return; }
  if (!TRAY) {
    TRAY = document.createElement('section');
    TRAY.id = 'pm5e-tray';
    document.body.append(TRAY);
    TRAY.addEventListener('click', onTrayClick);
  }
  const L = lang();
  const own = actor.isOwner;
  const rows = statusEffects(actor).map((e) => {
    const f = flagOf(e);
    const st = statusById(f.id);
    if (!st) return '';
    const extra = [
      ...(st.manual || []).map((m) => `<button type="button" data-act="manual" data-id="${st.id}" data-m="${m.id}">${esc(m[L])}</button>`),
      st.tremor ? `<button type="button" data-act="burst" data-id="${st.id}">${esc(t('PM5E.Status.Burst'))}</button>` : '',
    ].join('');
    return `<li><img src="${esc(iconPath(st.icon))}" alt=""><span class="n" title="${esc(statusName(st, L))}">${esc(statusName(st, L))}</span>
      <b>${f.stacks}</b>${own ? `<span class="b"><button type="button" data-act="dec" data-id="${st.id}">−</button><button type="button" data-act="inc" data-id="${st.id}">+</button><button type="button" data-act="del" data-id="${st.id}" title="${esc(t('PM5E.Status.Remove'))}">×</button></span>` : ''}
      ${own && extra ? `<div class="x">${extra}</div>` : ''}</li>`;
  }).join('');
  const options = STATUSES.map((s) => `<option value="${s.id}">${esc(statusName(s, L))}</option>`).join('');
  TRAY.innerHTML = `<header>${esc(actor.name)}</header><ul>${rows || `<li class="empty">${esc(t('PM5E.Status.None'))}</li>`}</ul>
    ${own ? `<footer><select>${options}</select><input type="number" value="1" min="1" max="99"><button type="button" data-act="add">${esc(t('PM5E.Status.Add'))}</button></footer>` : ''}`;
}
async function onTrayClick(ev) {
  const b = ev.target.closest('button[data-act]');
  const actor = trayActor();
  if (!b || !actor?.isOwner) return;
  const id = b.dataset.id;
  const s = getStacks(actor, id);
  switch (b.dataset.act) {
    case 'inc': await setStacks(actor, id, s + 1); break;
    case 'dec': await setStacks(actor, id, s - 1); break;
    case 'del': await setStacks(actor, id, 0); break;
    case 'add': {
      const sel = TRAY.querySelector('footer select').value;
      const n = Math.max(1, Number(TRAY.querySelector('footer input').value) || 1);
      await addStacks(actor, sel, n);
      break;
    }
    case 'manual': {
      const m = (statusById(id).manual || []).find((x) => x.id === b.dataset.m);
      if (m) await report(actor, `${m[lang()]} — ${actor.name}`, [await apply(actor, { id, from: s, ...m.run(s) })]);
      break;
    }
    case 'burst': {
      const r = tremorBurst(id, s, { stacks: stacksMap(actor) });
      if (!r) { ui.notifications.info(t('PM5E.Status.BurstLow')); break; }
      await report(actor, `${t('PM5E.Status.Burst')} — ${actor.name}`, [await apply(actor, { id, from: s, ...r })]);
      break;
    }
  }
  renderTray();
}

/** Наложить статус на выделенные токены (окно «База знаний», макросы). */
export async function applyToSelected(id, n = 1) {
  const tokens = canvas?.tokens?.controlled || [];
  if (!tokens.length) { ui.notifications.warn(t('PM5E.Status.NoTokens')); return 0; }
  for (const tok of tokens) if (tok.actor?.isOwner) await addStacks(tok.actor, id, n);
  return tokens.length;
}

export function registerStatusSettings() {
  game.settings.register(ID, 'statusAutomation', { name: 'PM5E.Settings.StatusAutomation', hint: 'PM5E.Settings.StatusAutomationHint',
    scope: 'world', config: true, type: Boolean, default: true });
  game.settings.register(ID, 'hudStatuses', { name: 'PM5E.Settings.HudStatuses', hint: 'PM5E.Settings.HudStatusesHint',
    scope: 'world', config: true, type: Boolean, default: true, requiresReload: true });
  game.settings.register(ID, 'statusTray', { name: 'PM5E.Settings.StatusTray', hint: 'PM5E.Settings.StatusTrayHint',
    scope: 'client', config: true, type: Boolean, default: true, onChange: () => renderTray() });
}

export function initStatuses() {
  registerStatusEffects();
  Hooks.on('preCreateActiveEffect', onPreCreateEffect);
  Hooks.on('updateCombat', onUpdateCombat);
  Hooks.on('controlToken', () => renderTray());
  for (const h of ['createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect', 'updateActor']) {
    Hooks.on(h, (doc) => { const a = doc.parent ?? doc; if (a?.id && a === trayActor()) renderTray(); });
  }
  // Кровотечение: умения и предметы (dnd5e 4+ — активности, 3.x — useItem), перемещение в бою, исцеление
  Hooks.on('dnd5e.postUseActivity', (activity) => {
    const actor = activity?.actor ?? activity?.item?.actor;
    if (actor?.isOwner) bleedOnAct(actor, activity?.activation?.type === 'reaction');
  });
  Hooks.on('dnd5e.useItem', (item) => { if (item?.actor?.isOwner) bleedOnAct(item.actor, item.system?.activation?.type === 'reaction'); });
  Hooks.on('updateToken', (doc, changes, options, userId) => {
    if (userId !== game.user.id || !('x' in changes || 'y' in changes) || !doc.actor) return;
    if (game.combat?.combatants?.some((c) => c.tokenId === doc.id)) bleedOnAct(doc.actor);
  });
  Hooks.on('preUpdateActor', (actor, changes, options) => {
    if (changes.system?.attributes?.hp?.value !== undefined) options.pm5eHp = actor.system?.attributes?.hp?.value;
  });
  Hooks.on('updateActor', async (actor, changes, options, userId) => {
    if (userId !== game.user.id || options.pm5eHp === undefined) return;
    const healed = (actor.system?.attributes?.hp?.value ?? 0) - options.pm5eHp;
    const s = getStacks(actor, 'bleed');
    if (healed > 0 && s) await setStacks(actor, 'bleed', statusById('bleed').onHeal(s, healed).stacks);
  });
}
