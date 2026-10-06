/* Конструктор персонажа v2 (builder.html).
   Данные: feats / classes / bloodarch / fixer / bloodfiend / equipment / egogifts / statuses (.json)
   + метаданные Builder_feats.json, Builder_races.json, Builder_classes.json (scripts/gen-builder-data.mjs)
   + пользовательская база Firestore (custom_content) + JSON-файлы, загруженные вручную.

   Как устроено:
   1. Состояние персонажа S хранит только решения игрока: уровень, расу, класс, базовые характеристики,
      броски, содержимое слотов (S.slots), ответы на выборы (S.choices) и объекты «вне слотов» (S.extras).
   2. compute() каждый раз заново проходит по всем источникам (раса → архетип → основной класс → черты…)
      и их эффектам: собирает прибавки к характеристикам, слоты, точки выбора, скорость, хиты и т. д.
   3. Интерфейс рисуется из результата compute(). Все данные выводятся через esc() или DOMPurify. */

const T = (s) => (window.I18N ? window.I18N.t(s) : s);
const STATS = ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha'];
const STAT_NAME = { Str: 'Сила', Dex: 'Ловкость', Con: 'Телосложение', Int: 'Интеллект', Wis: 'Мудрость', Cha: 'Харизма' };
const STAT_SHORT = { Str: 'СИЛ', Dex: 'ЛОВ', Con: 'ТЕЛ', Int: 'ИНТ', Wis: 'МУД', Cha: 'ХАР' };
const CAT = {
  race: { label: 'Раса', color: '#C7243A', icon: 'fa-dna' },
  arch: { label: 'Принадлежность', color: '#45B3CB', icon: 'fa-building' },
  option: { label: 'Особенность класса', color: '#27AE60', icon: 'fa-star' },
  list: { label: 'Умение класса', color: '#40E0D0', icon: 'fa-bolt' },
  feat: { label: 'Черта', color: '#F1C40F', icon: 'fa-dumbbell' },
  asi: { label: 'Увеличение характеристик', color: '#D9772F', icon: 'fa-arrow-up-wide-short' },
  gear: { label: 'Снаряжение', color: '#9B59B6', icon: 'fa-shield-halved' },
  ego: { label: 'Э.Г.О.', color: '#D94285', icon: 'fa-gem' },
  gift: { label: 'Дар Э.Г.О.', color: '#E67E22', icon: 'fa-gift' },
  text: { label: 'Своё', color: '#B0B0B0', icon: 'fa-pen-nib' },
};
const ITEM_TYPE = { Weapon: 'Оружие', Armor: 'Броня', Mod: 'Артефакт' };
const POINT_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const STD_ARRAY = [15, 14, 13, 12, 10, 8];
const LS_STATE = 'builder.v2.state';
const LS_UPLOADS = 'builder.v2.uploads';
const LS_VIEW = 'builder.v2.view';

/* ---------------- утилиты ---------------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lower = (s) => String(s ?? '').trim().toLowerCase();
const mod = (v) => Math.floor((v - 10) / 2);
const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clone = (o) => JSON.parse(JSON.stringify(o));
const $ = (id) => document.getElementById(id);
const stripLinks = (s) => String(s ?? '').replace(/`([^`\n]*?)::[^`\n]*`/g, '$1');
const plain = (s) => stripLinks(s).replace(/\*\*/g, '').replace(/`/g, '');

function rnd(n) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0] % n) + 1;
}
function md(text) {
  const src = String(text ?? '').replace(/`([^`\n]*?)::([^`\n]*)`/g,
    (m, shown, target) => `<span class="lnk" data-link="${esc(target.trim())}">${esc(shown)}</span>`);
  try { return window.DOMPurify.sanitize(window.marked.parse(src)); } catch (e) { return `<p>${esc(plain(text))}</p>`; }
}

/* Списки из текста умения: «* Название: описание» и «**Название**» */
function parseBullets(text) {
  const out = [];
  String(text || '').split('\n').forEach((line) => {
    const m = /^\s*\*\s+(.+)$/.exec(line);
    if (!m) { if (out.length && line.trim() && !/^\s*\|/.test(line)) out[out.length - 1].desc += '\n' + line; return; }
    const body = stripLinks(m[1]).replace(/\*\*/g, '');
    const cut = body.search(/[:.]/);
    out.push(cut > 0 ? { name: body.slice(0, cut).trim(), desc: body.slice(cut + 1).trim() } : { name: body.trim(), desc: '' });
  });
  return out;
}
function parseBold(text) {
  const out = [];
  String(text || '').split('\n').forEach((line) => {
    const m = /^\s*\*\*(.+?)\*\*\s*$/.exec(line);
    if (m) out.push({ name: plain(m[1]).trim(), desc: '' });
    else if (out.length) out[out.length - 1].desc += (out[out.length - 1].desc ? '\n' : '') + line;
  });
  out.forEach((o) => { o.desc = o.desc.trim(); });
  return out;
}

/* Требования к характеристикам в тексте предмета (RU и EN) */
const STAT_WORDS = [
  ['Str', 'сил[аы]?|силой|strength'], ['Dex', 'ловкост[ьи]|dexterity'], ['Con', 'телосложени[ея]|constitution'],
  ['Int', 'интеллект[а]?|intelligence'], ['Wis', 'мудрост[ьи]|wisdom'], ['Cha', 'харизм[аы]|charisma'],
];
const STAT_RE_SRC = STAT_WORDS.map(([, w]) => w).join('|');
function statOf(word) {
  for (const [k, w] of STAT_WORDS) if (new RegExp(`^(${w})$`, 'i').test(word)) return k;
  return null;
}
function parseStatReqs(need) {
  const reqs = [];
  const text = String(need || '');
  const all = /(?:все характеристики|all (?:ability )?(?:scores|stats|characteristics))\s*(\d+)/i.exec(text);
  if (all) reqs.push({ any: STATS, min: +all[1], all: true });
  const re = new RegExp(`(${STAT_RE_SRC})(?:\\s+(?:или|or)\\s+(${STAT_RE_SRC}))?(?:\\s+(?:score\\s+)?(?:of\\s+)?)?\\s*(\\d+)(?:\\s*(?:или|or)\\s*(ниже|lower|less|below|выше|higher|more|above))?`, 'gi');
  let m;
  while ((m = re.exec(text))) {
    const a = statOf(m[1]); const b = m[2] ? statOf(m[2]) : null;
    if (!a) continue;
    const lowMode = m[4] && /ниже|lower|less|below/i.test(m[4]);
    reqs.push({ any: b ? [a, b] : [a], [lowMode ? 'max' : 'min']: +m[3] });
  }
  return reqs;
}

/* =====================================================================
   ДАННЫЕ
   ===================================================================== */
const DB = {
  ready: false, feats: [], featByKey: new Map(), featById: new Map(), equip: [], equipByKey: new Map(),
  gifts: [], giftByKey: new Map(), archs: [], archByKey: new Map(), statuses: [],
  races: [], bases: {}, archMeta: {}, gearOwner: new Map(), gearOf: {}, egoTiers: [],
  baseData: {}, customState: 'loading', customCount: 0,
};

async function getJson(name, fallback) {
  try {
    const r = await window.I18N.fetchData(name);
    if (!r.ok) return fallback;
    return await r.json();
  } catch (e) { console.error(e); return fallback; }
}

async function loadData() {
  const [feats, classes, bloodarch, fixer, bloodfiend, equipment, gifts, statuses, bFeats, bRaces, bClasses] = await Promise.all([
    getJson('feats.json', []), getJson('classes.json', []), getJson('bloodarch.json', []),
    getJson('fixer.json', { Talents: [] }), getJson('bloodfiend.json', { Talents: [] }),
    getJson('equipment.json', []), getJson('egogifts.json', []), getJson('statuses.json', []),
    getJson('Builder_feats.json', { feats: [] }), getJson('Builder_races.json', { races: [] }), getJson('Builder_classes.json', { bases: [], archetypes: {}, gear: {} }),
  ]);
  const metaByName = new Map(bFeats.feats.map((m) => [lower(m.name), m]));
  const metaByIndex = new Map(bFeats.feats.map((m) => [m.index, m]));
  DB.feats = feats.map((f, i) => {
    let m = metaByName.get(lower(f.Name));
    if (!m) { const byIdx = metaByIndex.get(i); if (byIdx && !feats.some((x) => lower(x.Name) === lower(byIdx.name))) m = byIdx; }
    return { t: 'feat', key: m ? `c:${m.id}` : `c#${i}`, id: m ? m.id : null, data: f, meta: m || null, src: 'canon' };
  });
  DB.feats.forEach((f) => { DB.featByKey.set(f.key, f); if (f.id) DB.featById.set(f.id, f); });

  DB.equip = equipment.map((x, i) => ({ t: 'equip', key: `c:${i}`, idx: i, data: x, src: 'canon' }));
  DB.equip.forEach((e) => DB.equipByKey.set(e.key, e));
  DB.gifts = gifts.map((x, i) => ({ t: 'gift', key: `c:${i}`, data: x, src: 'canon' }));
  DB.gifts.forEach((g) => DB.giftByKey.set(g.key, g));
  DB.statuses = statuses;

  DB.races = bRaces.races || [];
  DB.egoTiers = bClasses.egoTiers || [];
  (bClasses.bases || []).forEach((b) => { DB.bases[b.id] = b; });
  DB.archMeta = bClasses.archetypes || {};
  DB.baseData = { fixer, bloodfiend };
  Object.entries(bClasses.gear || {}).forEach(([no, items]) => {
    DB.gearOf[no] = items;
    items.forEach((it) => {
      const list = DB.gearOwner.get(it.index) || [];
      list.push(Number(no));
      DB.gearOwner.set(it.index, list);
    });
  });

  DB.archs = [
    ...classes.slice().sort((a, b) => (a.No ?? 999) - (b.No ?? 999)).map((c) => ({
      t: 'arch', key: `c:classes.json:${c.No}`, base: 'fixer', no: c.No, data: c, src: 'canon',
      meta: DB.archMeta['classes.json']?.[c.No] || null,
    })),
    ...bloodarch.map((c, i) => ({
      t: 'arch', key: `c:bloodarch.json:${i}`, base: 'bloodfiend', no: null, data: c, src: 'canon',
      meta: DB.archMeta['bloodarch.json']?.[i] || null,
    })),
  ];
  DB.archs.forEach((a) => DB.archByKey.set(a.key, a));
  loadUploads();
  DB.ready = true;
}

/* Пользовательская база Firestore — грузится отдельно и не ломает страницу, если недоступна */
async function loadCustom() {
  try {
    const [{ db }, { onAuth }, fs] = await Promise.all([
      import('./firebase.js'), import('./auth.js'),
      import('https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js'),
    ]);
    const { collection, getDocs, query, where } = fs;
    const pull = async (user, admin) => {
      const seen = new Map();
      const push = (snap) => snap.forEach((d) => seen.set(d.id, d));
      if (admin) push(await getDocs(collection(db, 'custom_content')));
      else {
        push(await getDocs(query(collection(db, 'custom_content'), where('isPrivate', '==', false))));
        if (user) push(await getDocs(query(collection(db, 'custom_content'), where('creatorEmail', '==', user.email))));
      }
      removeCustom();
      let n = 0;
      seen.forEach((d) => {
        const raw = d.data();
        if (addCustomEntry(raw.type, raw.data || {}, `u:${d.id}`, 'custom', raw.creator || '')) n++;
      });
      DB.customState = 'ok';
      DB.customCount = n;
      renderAll();
    };
    let started = false;
    onAuth((st) => {
      if (!st.ready) return;
      started = true;
      pull(st.user, st.isAdmin).catch((e) => { console.error(e); DB.customState = 'error'; renderAll(); });
    });
    setTimeout(() => { if (!started) pull(null, false).catch(() => { DB.customState = 'error'; renderAll(); }); }, 4000);
  } catch (e) {
    console.error(e);
    DB.customState = 'error';
    renderAll();
  }
}

function removeCustom() {
  for (const list of [DB.feats, DB.equip, DB.gifts, DB.archs]) {
    for (let i = list.length - 1; i >= 0; i--) if (list[i].src === 'custom') list.splice(i, 1);
  }
  for (const map of [DB.featByKey, DB.equipByKey, DB.giftByKey, DB.archByKey]) {
    for (const [k, v] of map) if (v.src === 'custom') map.delete(k);
  }
}

function addCustomEntry(type, data, key, src, creator) {
  if (!data || typeof data !== 'object' || !data.Name) return false;
  const e = { key, data, src, creator };
  if (type === 'feat') { Object.assign(e, { t: 'feat', id: null, meta: null }); DB.feats.push(e); DB.featByKey.set(key, e); }
  else if (type === 'equip') { Object.assign(e, { t: 'equip' }); DB.equip.push(e); DB.equipByKey.set(key, e); }
  else if (type === 'gift') { Object.assign(e, { t: 'gift' }); DB.gifts.push(e); DB.giftByKey.set(key, e); }
  else if (type === 'class') { Object.assign(e, { t: 'arch', base: 'any', no: null, meta: null }); DB.archs.push(e); DB.archByKey.set(key, e); }
  else return false;
  return true;
}

/* JSON, загруженные с диска: хранятся в браузере, чтобы ссылки на них переживали перезагрузку */
function detectType(o) {
  if (!o || typeof o !== 'object') return null;
  if (window.EgoCore && window.EgoCore.normalize(o)) return 'ego';
  if (Array.isArray(o.Talents)) return 'class';
  if (o.ItemType) return 'equip';
  if (o.Description != null && o.Level != null) return 'gift';
  if (o.desc != null || o.Base) return 'feat';
  return null;
}
function loadUploads() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(LS_UPLOADS) || '[]'); } catch (e) { list = []; }
  (Array.isArray(list) ? list : []).forEach((u) => addCustomEntry(u.type, u.data, u.key, 'file'));
}
function saveUpload(type, data) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(LS_UPLOADS) || '[]'); } catch (e) { list = []; }
  const key = `f:${uid()}`;
  list.push({ type, key, data });
  try { localStorage.setItem(LS_UPLOADS, JSON.stringify(list.slice(-200))); } catch (e) { /* переполнено */ }
  addCustomEntry(type, data, key, 'file');
  return key;
}

/* =====================================================================
   СОСТОЯНИЕ
   ===================================================================== */
function blankState() {
  return {
    v: 2, name: '', desc: '', level: 1, race: '', base: 'fixer', arch: null,
    stats: { method: 'pointbuy', base: { Str: 8, Dex: 8, Con: 8, Int: 8, Wis: 8, Cha: 8 }, pool: [], assign: {} },
    hp: { mode: 'avg', rolls: {} }, sp: { mode: 'avg', rolls: {} },
    opts: { durability: false, sanity: true },
    slots: {}, choices: {}, extras: [], log: [],
  };
}
let S = blankState();
let R = null;
let VIEW = 'cubes';

function saveState() {
  try { localStorage.setItem(LS_STATE, JSON.stringify(S)); } catch (e) { /* приватный режим */ }
}
function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_STATE) || 'null');
    if (raw && raw.v === 2) S = Object.assign(blankState(), raw);
  } catch (e) { /* испорченное состояние — начинаем заново */ }
  try { VIEW = localStorage.getItem(LS_VIEW) === 'rows' ? 'rows' : 'cubes'; } catch (e) { VIEW = 'cubes'; }
}

/* Ссылки на объекты: { t, key, data? }. Для пользовательских объектов храним копию данных — пресет самодостаточен. */
function makeRef(entry) {
  const ref = { t: entry.t, key: entry.key };
  if (entry.src !== 'canon') ref.data = clone(entry.data);
  if (entry.src === 'custom' || entry.src === 'file') ref.src = entry.src;
  return ref;
}
function resolve(ref) {
  if (!ref) return null;
  if (ref.t === 'ego') return { t: 'ego', key: ref.ego?.id, ego: window.EgoCore.normalize(ref.ego), src: 'ego', data: { Name: ref.ego?.name } };
  if (ref.t === 'text') return { t: 'text', key: ref.key, src: 'text', data: { Name: ref.name || 'Без названия', desc: ref.desc || '' }, cat: ref.cat };
  const map = { feat: DB.featByKey, equip: DB.equipByKey, gift: DB.giftByKey, arch: DB.archByKey }[ref.t];
  let e = map && map.get(ref.key);
  if (!e && ref.t === 'feat' && ref.key && ref.key.startsWith('c:')) e = DB.featById.get(ref.key.slice(2));
  if (!e && ref.data) {
    e = { t: ref.t, key: ref.key, data: ref.data, src: ref.src || (String(ref.key).startsWith('f:') ? 'file' : 'custom'), meta: null, id: null, base: 'any', orphan: true };
  }
  return e || null;
}
const entryName = (e) => (e ? (e.t === 'ego' ? (e.ego?.name || 'Э.Г.О. без названия') : e.data?.Name || 'Без названия') : '—');
const isCustom = (e) => !!e && (e.src === 'custom' || e.src === 'file');
const xe = (x) => (R && R.xinfo.get(x.id)) || { entry: resolve(x.ref), why: [] };

/* =====================================================================
   РАСЧЁТ
   ===================================================================== */
function compute() {
  const L = Math.max(1, Math.min(20, S.level | 0));
  const base = DB.bases[S.base] || DB.bases.fixer || { effects: [], hitDie: 10, hide: [] };
  const R = {
    L, pb: Math.ceil(L / 4) + 1, base, baseData: DB.baseData[S.base] || { Talents: [] },
    race: DB.races.find((r) => r.id === S.race) || null,
    arch: resolve(S.arch), arch2: null,
    slots: [], slotById: new Map(), choices: [], adds: [], maxSet: {}, maxPlus: {},
    owned: new Map(), feats: [], sources: [],
    hpPer: 0, conMult: 1, dieStep: 0, hitDie: null, speed: 0, light: 0, lightStat: null, dc: 0, workshop: 0,
    egoAttack: false, egoForms: [], suppress: new Set(), bloodfiend: false, notes: [], warnings: [], pending: 0,
  };
  R.queue = [];
  R.xinfo = new Map();
  const drain = () => { while (R.queue.length) R.queue.shift()(); };
  const source = (src) => { R.sources.push(src); src.effects.forEach((e, i) => applyEffect(R, src, e, i)); };

  // слоты расы и принадлежности (рисуются как кубы)
  addSlot(R, { id: 'core:race', kind: 'race', cat: 'race', label: 'Раса', level: 1, group: 'core' });
  addSlot(R, { id: 'core:arch', kind: 'arch', cat: 'arch', label: base.archetypeLabel || 'Принадлежность', level: 1, group: 'core' });

  if (R.race) source({ key: 'race', label: R.race.name, cat: 'race', effects: R.race.effects || [], level: 1, entity: R.race });
  if (R.arch) {
    if (R.arch.meta) source({ key: 'arch', label: entryName(R.arch), cat: 'arch', effects: R.arch.meta.effects || [], level: 1, entity: R.arch });
    else R.sources.push({ key: 'arch', label: entryName(R.arch), cat: 'arch', effects: [], level: 1, entity: R.arch });
  }
  source({ key: 'base', label: base.name, cat: 'option', effects: base.effects || [], level: 1, isBase: true });

  // объекты вне слотов тоже действуют (на усмотрение Мастера)
  S.extras.forEach((x) => {
    const e = resolve(x.ref);
    R.xinfo.set(x.id, { entry: e, why: [] });
    if (e && e.t === 'feat') addFeat(R, e, { key: `X[${x.id}]`, level: 1, extra: x });
  });
  drain();
  if (R.arch2Ref) {
    R.arch2 = resolve(R.arch2Ref);
    if (R.arch2 && R.arch2.meta) source({ key: 'arch2', label: entryName(R.arch2), cat: 'arch', effects: R.arch2.meta.effects || [], level: 1, entity: R.arch2 });
    drain();
  }

  gearSlots(R);
  egoSlots(R);
  computeStats(R);
  computeDerived(R);
  checkAll(R);
  R.pending = R.choices.filter((c) => c.pending).length + R.slots.filter((s) => s.pendingFlag).length;
  return R;
}

function addSlot(R, slot) {
  slot.value = S.slots[slot.id] ?? null;
  R.slots.push(slot);
  R.slotById.set(slot.id, slot);
  return slot;
}

function choicePoint(R, src, key, def) {
  const cp = Object.assign({ key, src, value: S.choices[key] }, def);
  R.choices.push(cp);
  return cp;
}

function optionList(R, src, e) {
  if (e.options) return e.options.map((label, i) => ({ v: i, label: String(label) }));
  let text = '';
  if (e.from === 'self') text = src.entry?.data?.desc || '';
  else if (e.talent != null) text = R.baseData.Talents?.[e.talent]?.desc || '';
  else if (e.talentLevel != null) {
    const t = (src.entity?.data?.Talents || src.ownerEntity?.data?.Talents || []).find((x) => Number(x.level) === Number(e.talentLevel));
    text = t?.desc || '';
  }
  let items = e.parse === 'bold' ? parseBold(text) : parseBullets(text);
  if (e.range) items = items.slice(e.range[0], e.range[1]);
  return items.map((it, i) => ({ v: i, label: it.name, desc: it.desc }));
}

function applyEffect(R, src, e, idx) {
  const queue = R.queue;
  if (e.level && e.level > R.L) return;
  if (src.isBase && e.talent != null && R.suppress.has(e.talent) && (e.type === 'stat' || e.type === 'speed')) return;
  const lvl = Math.max(e.level || 0, src.level || 1);
  const ckey = `${src.key}|${e.id ?? idx}`;
  const ns = src.slotNs || src.key;
  switch (e.type) {
    case 'stat': R.adds.push({ stats: e.stats, cap: e.cap, level: lvl, src }); break;
    case 'statMax': Object.entries(e.stats).forEach(([k, v]) => { R.maxSet[k] = Math.max(R.maxSet[k] || 20, v); }); break;
    case 'statMaxPlus': Object.entries(e.stats).forEach(([k, v]) => { R.maxPlus[k] = (R.maxPlus[k] || 0) + v; }); break;
    case 'perLevelStat': {
      const n = Math.max(0, R.L - (src.level || 1));
      if (n > 0) {
        R.adds.push({ stats: Object.fromEntries(Object.entries(e.stats).map(([k, v]) => [k, v * n])), cap: e.cap, level: lvl, src });
        if (e.once) R.adds.push({ stats: e.once, cap: e.cap, level: lvl, src });
      }
      break;
    }
    case 'statChoice': {
      const cp = choicePoint(R, src, ckey, { kind: 'stat', label: e.label || 'Характеристика на выбор', count: e.count || 1, amount: e.amount || 1,
        options: (e.options || STATS).map((k) => ({ v: k, label: STAT_NAME[k] })) });
      const val = (Array.isArray(cp.value) ? cp.value : []).filter((k, i, a) => (e.options || STATS).includes(k) && a.indexOf(k) === i).slice(0, cp.count);
      cp.value = val;
      cp.pending = val.length < cp.count;
      if (val.length) {
        const stats = {};
        val.forEach((k) => { stats[k] = (stats[k] || 0) + cp.amount; });
        R.adds.push({ stats, cap: e.cap, level: lvl, src });
        if (e.maxPlus) val.forEach((k) => { R.maxPlus[k] = (R.maxPlus[k] || 0) + e.maxPlus; });
      }
      break;
    }
    case 'grantFeat': {
      const f = DB.featById.get(e.feat);
      if (f) queue.push(() => addFeat(R, f, { key: `${src.key}>${e.feat}`, level: lvl, grantedBy: src, ignoreReq: e.ignoreReq }));
      break;
    }
    case 'featChoice': {
      const opts = e.any ? null : (e.options || []).map((id) => DB.featById.get(id)).filter(Boolean);
      const cp = choicePoint(R, src, ckey, { kind: 'feat', label: e.label || 'Черта на выбор', any: !!e.any, ignoreReq: !!e.ignoreReq,
        options: opts ? opts.map((f) => ({ v: f.key, label: f.data.Name, entry: f })) : [] });
      const f = cp.value ? resolve(typeof cp.value === 'string' ? { t: 'feat', key: cp.value } : cp.value) : null;
      cp.pending = !f;
      if (f) queue.push(() => addFeat(R, f, { key: `${ckey}=${f.key}`, level: lvl, grantedBy: src, ignoreReq: e.ignoreReq }));
      break;
    }
    case 'featSlot': {
      const slot = addSlot(R, { id: `${ns}:${e.id}`, kind: 'feat', cat: 'feat', label: e.label || 'Черта', level: lvl, filter: e.filter || null, src, group: 'feat' });
      const f = resolve(slot.value);
      slot.entry = f;
      if (f) queue.push(() => addFeat(R, f, { key: `F[${slot.id}]`, level: lvl, slot }));
      break;
    }
    case 'asiSlot': {
      const slot = addSlot(R, { id: `${ns}:${e.id}`, kind: 'asi', cat: 'asi', label: 'Увеличение характеристик', level: lvl, noFeat: !!e.noFeat, src, group: 'asi' });
      const v = slot.value;
      if (v && v.mode === 'feat' && !e.noFeat) {
        const f = resolve(v.ref);
        slot.entry = f;
        if (f) queue.push(() => addFeat(R, f, { key: `F[${slot.id}]`, level: lvl, slot }));
      } else if (v && (v.mode === 'plus2' || v.mode === 'plus11')) {
        const stats = {};
        if (v.mode === 'plus2' && STATS.includes(v.a)) stats[v.a] = 2;
        if (v.mode === 'plus11') { if (STATS.includes(v.a)) stats[v.a] = 1; if (STATS.includes(v.b) && v.b !== v.a) stats[v.b] = 1; }
        R.adds.push({ stats, level: lvl, src: { key: `F[${slot.id}]`, label: `Увеличение характеристик (ур. ${lvl})` } });
        slot.pendingFlag = v.mode === 'plus11' && (!STATS.includes(v.b) || v.b === v.a);
      }
      break;
    }
    case 'pick': {
      const options = optionList(R, src, e);
      const cp = choicePoint(R, src, ckey, { kind: 'pick', label: e.label || 'Выбор', options });
      cp.pending = !(Number.isInteger(cp.value) && options[cp.value]);
      break;
    }
    case 'choice': {
      const options = optionList(R, src, e);
      let sel = null;
      if (e.slot) {
        const slot = addSlot(R, { id: `${ns}:${e.id}`, kind: 'option', cat: 'option', label: e.label, level: lvl, options, src, group: 'core' });
        sel = slot.value && Number.isInteger(slot.value.i) && options[slot.value.i] ? slot.value.i : null;
        slot.selected = sel;
      } else {
        const cp = choicePoint(R, src, ckey, { kind: 'pick', label: e.label || 'Выбор', options });
        sel = Number.isInteger(cp.value) && options[cp.value] ? cp.value : null;
        cp.pending = sel == null;
      }
      const eff = sel != null ? e.optionEffects?.[sel] : null;
      if (eff && eff.length) {
        const sub = { key: e.slot ? `${ns}:${e.id}#${sel}` : `${ckey}#${sel}`, label: `${src.label}: ${options[sel].label}`, cat: src.cat, effects: eff, level: lvl, entity: src.entity, ownerEntity: src.entity };
        sub.slotNs = sub.key;
        queue.push(() => { R.sources.push(sub); eff.forEach((x, i) => applyEffect(R, sub, x, i)); });
      }
      break;
    }
    case 'pickList': {
      const options = optionList(R, src, e);
      (e.levels || []).forEach((lv, n) => {
        if (lv > R.L) return;
        addSlot(R, { id: `${ns}:${e.id}${n}`, kind: 'list', cat: 'list', label: e.label, level: lv, options, listId: e.id, src, group: 'list' });
      });
      break;
    }
    case 'classChoice': {
      const cp = choicePoint(R, src, ckey, { kind: 'class', label: e.label || 'Принадлежность' });
      cp.pending = !cp.value;
      if (cp.value) R.arch2Ref = typeof cp.value === 'string' ? { t: 'arch', key: cp.value } : cp.value;
      break;
    }
    case 'hpPerLevel': R.hpPer += e.value; break;
    case 'hpConMult': R.conMult = Math.max(R.conMult, e.value); break;
    case 'hitDieStep': R.dieStep += e.value; break;
    case 'hitDie': R.hitDie = e.value; break;
    case 'speed': R.speed += e.value; break;
    case 'light': R.light += e.value; break;
    case 'lightStat': R.lightStat = e.stat; break;
    case 'slot': if (e.slot === 'workshop') R.workshop += e.value; break;
    case 'dc': R.dc += e.value; break;
    case 'egoAttack': R.egoAttack = true; break;
    case 'egoForm': R.egoForms.push({ form: e.form, src }); break;
    case 'suppress': R.suppress.add(e.talent); break;
    case 'bloodfiend': R.bloodfiend = true; break;
    case 'note': R.notes.push({ text: e.text, src }); break;
    default: break;
  }
}

function addFeat(R, entry, ctx) {
  const id = entry.id || entry.key;
  const prev = R.owned.get(id) || 0;
  R.owned.set(id, prev + 1);
  const rec = { entry, ctx, dup: prev > 0 && !entry.meta?.repeatable };
  R.feats.push(rec);
  const src = { key: ctx.key, label: entry.data.Name, cat: 'feat', effects: entry.meta?.effects || [], level: ctx.level || 1, entry, rec };
  R.sources.push(src);
  src.effects.forEach((e, i) => applyEffect(R, src, e, i));
}

function gearSlots(R) {
  const archNo = R.arch?.no;
  const own = archNo != null ? (DB.gearOf[archNo] || []) : [];
  const uniforms = own.filter((x) => x.type === 'Armor');
  if (S.base === 'fixer') {
    addSlot(R, { id: 'gear:uniform', kind: 'gear', cat: 'gear', level: 1, group: 'gear',
      label: uniforms.length ? 'Униформа принадлежности' : 'Униформа → любой артефакт',
      gearFilter: uniforms.length ? { only: uniforms.map((u) => u.index) } : { types: ['Armor', 'Mod'] },
      hint: uniforms.length ? 'Доспех Фиксера вашей принадлежности.' : 'У принадлежности нет униформы — по правилам Фиксера вместо неё берётся любой артефакт или доспех.' });
  }
  addSlot(R, { id: 'gear:weapon', kind: 'gear', cat: 'gear', level: 1, group: 'gear', label: 'Оружие', gearFilter: { types: ['Weapon'] } });
  addSlot(R, { id: 'gear:armor', kind: 'gear', cat: 'gear', level: 1, group: 'gear', label: 'Броня', gearFilter: { types: ['Armor'] } });
  addSlot(R, { id: 'gear:artifact', kind: 'gear', cat: 'gear', level: 1, group: 'gear', label: 'Артефакт', gearFilter: { types: ['Mod'] } });
  for (let i = 1; i <= R.workshop; i++) {
    addSlot(R, { id: `gear:extra${i}`, kind: 'gear', cat: 'gear', level: 1, group: 'gear', label: 'Доп. предмет мастерской', gearFilter: { types: ['Weapon', 'Armor', 'Mod'] } });
  }
  R.slots.filter((s) => s.kind === 'gear').forEach((s) => { s.entry = resolve(s.value); });
}

function egoSlots(R) {
  if (R.egoAttack) {
    DB.egoTiers.filter((t) => t.level <= R.L).forEach((t) => {
      const s = addSlot(R, { id: `ego:atk${t.rank}`, kind: 'ego', cat: 'ego', level: t.level, group: 'ego', egoKind: 'attack', maxRank: t.rank,
        label: `Атака Э.Г.О. (до ${window.EgoCore.rankName(t.rank)})` });
      s.entry = resolve(s.value);
    });
  } else if (R.L >= 4) {
    addSlot(R, { id: 'ego:locked', kind: 'locked', cat: 'ego', level: 4, group: 'ego', label: 'Атака Э.Г.О.', hint: 'Нужна черта «Э.Г.О.-оружие» (или «Связь с Двигателем Мефистофеля»).' });
  }
  R.egoForms.forEach((f, i) => {
    const s = addSlot(R, { id: `ego:form${i}`, kind: 'ego', cat: 'ego', level: 1, group: 'ego', egoKind: 'eff', egoForm: f.form,
      label: f.form === 'volatile' ? 'Нестабильное Э.Г.О.' : 'Расцветшее Э.Г.О.' });
    s.entry = resolve(s.value);
  });
}

function baseStats() {
  const st = S.stats;
  if (st.method === 'array' || st.method === 'roll') {
    const pool = st.method === 'array' ? STD_ARRAY : st.pool;
    const out = {};
    STATS.forEach((k) => { const i = st.assign[k]; out[k] = Number.isInteger(i) && pool[i] != null ? pool[i] : 8; });
    return out;
  }
  const out = {};
  STATS.forEach((k) => {
    let v = Number(st.base[k]);
    if (!Number.isFinite(v)) v = 8;
    out[k] = st.method === 'pointbuy' ? Math.max(8, Math.min(15, v)) : Math.max(1, Math.min(30, v));
  });
  return out;
}

function computeStats(R) {
  R.baseStats = baseStats();
  R.max = {};
  STATS.forEach((k) => { R.max[k] = (R.maxSet[k] || 20) + (R.maxPlus[k] || 0); });
  const cur = { ...R.baseStats };
  R.contrib = Object.fromEntries(STATS.map((k) => [k, []]));
  R.adds.slice().sort((a, b) => a.level - b.level).forEach((add) => {
    Object.entries(add.stats || {}).forEach(([k, v]) => {
      if (!v || !(k in cur)) return;
      // своя граница прибавки (например «не выше 20» у черты или «до 22» у Аномальной способности), иначе — максимум характеристики
      const cap = add.cap != null ? add.cap : R.max[k];
      const next = Math.max(cur[k], Math.min(cur[k] + v, cap));
      R.contrib[k].push({ src: add.src, v: next - cur[k], want: v });
      cur[k] = next;
    });
  });
  R.stats = cur;
  R.mods = Object.fromEntries(STATS.map((k) => [k, mod(cur[k])]));
}

function computeDerived(R) {
  const baseDie = R.hitDie || R.base.hitDie || 10;
  R.die = Math.min(12, baseDie + 2 * R.dieStep);
  const n = S.opts.durability ? 2 : 1;
  const avg = n === 2 ? R.die + 1 : R.die / 2 + 1;
  const con = R.mods.Con * R.conMult;
  let hp = n * R.die + con;
  const missing = [];
  for (let lv = 2; lv <= R.L; lv++) {
    let roll = avg;
    if (S.hp.mode === 'roll') {
      const r = S.hp.rolls[lv];
      if (Number.isFinite(r)) roll = Math.min(r, n * R.die); else missing.push(lv);
    }
    hp += Math.max(1, roll + con);
  }
  hp += R.hpPer * R.L;
  R.hp = Math.max(1, hp);
  R.hpMissing = missing;
  R.hpFormula = `${n}d${R.die} · ${T('ТЕЛ')} ${sign(R.mods.Con)}${R.conMult > 1 ? ` ×${R.conMult}` : ''}${R.hpPer ? ` · +${R.hpPer}/${T('ур.')}` : ''}`;

  const sDie = R.base.hitDie || 10;
  let sp = sDie + R.mods.Wis;
  const spMissing = [];
  for (let lv = 2; lv <= R.L; lv++) {
    let roll = sDie / 2 + 1;
    if (S.sp.mode === 'roll') {
      const r = S.sp.rolls[lv];
      if (Number.isFinite(r)) roll = Math.min(r, sDie); else spMissing.push(lv);
    }
    sp += Math.max(1, roll + R.mods.Wis);
  }
  R.sp = Math.max(1, sp);
  R.spDie = sDie;
  R.spMissing = spMissing;

  R.speedTotal = (R.race?.speed || 30) + R.speed;
  const dcStat = (R.base.dcStats || ['Str', 'Dex']).reduce((a, k) => (R.mods[k] > R.mods[a] ? k : a), (R.base.dcStats || ['Str'])[0]);
  R.dcStat = dcStat;
  R.dcValue = 8 + R.pb + R.mods[dcStat] + R.dc;
  R.atk = R.pb + R.mods[dcStat];
  R.lightPool = R.L >= 2 ? R.L + R.pb + (R.lightStat ? R.mods[R.lightStat] : 0) + R.light : 0;
}

/* Проверка требований черт */
function featReq(R, entry, ctx) {
  const res = { fails: [], unknown: [] };
  if (!entry) return res;
  if (!entry.meta) {
    if (entry.data?.Need && String(entry.data.Need).trim() && entry.data.Need !== 'null') res.unknown.push(`Требование не проверяется автоматически: ${plain(entry.data.Need)}`);
    return res;
  }
  if (ctx && ctx.ignoreReq) return res;
  const q = entry.meta.requires || {};
  const own = ctx ? ownGain(R, ctx.key) : {};
  const st = (k) => R.stats[k] - (own[k] || 0);
  if (q.level && R.L < q.level) res.fails.push(`Уровень ${q.level}+`);
  Object.entries(q.stats || {}).forEach(([k, v]) => { if (st(k) < v) res.fails.push(`${STAT_NAME[k]} ${v}+`); });
  if (q.anyStats && !q.anyStats.some((g) => Object.entries(g).every(([k, v]) => st(k) >= v))) {
    res.fails.push(q.anyStats.map((g) => Object.entries(g).map(([k, v]) => `${STAT_NAME[k]} ${v}+`).join(' и ')).join(' или '));
  }
  (q.feats || []).forEach((id) => { if (!R.owned.get(id)) res.fails.push(`Черта «${DB.featById.get(id)?.data.Name || id}»`); });
  (q.notFeats || []).forEach((id) => { if (R.owned.get(id)) res.fails.push(`Нельзя вместе с «${DB.featById.get(id)?.data.Name || id}»`); });
  if (q.archetype && !q.archetype.includes(R.arch?.no) && !q.archetype.includes(R.arch2?.no)) {
    res.fails.push(`Принадлежность: ${q.archetype.map((no) => DB.archByKey.get(`c:classes.json:${no}`)?.data.Name || no).join(', ')}`);
  }
  if (q.bloodfiend && !(R.race?.bloodfiend || R.base.bloodfiend || R.bloodfiend)) res.fails.push('Нужно быть Кровавым демоном');
  if (q.text) res.unknown.push(`Проверьте вручную: ${plain(entry.data.Need)}`);
  return res;
}
function ownGain(R, key) {
  const out = {};
  STATS.forEach((k) => (R.contrib[k] || []).forEach((c) => { if (c.src && (c.src.key === key || String(c.src.key).startsWith(key + '|') || String(c.src.key).startsWith(key + '#'))) out[k] = (out[k] || 0) + c.v; }));
  return out;
}

/* Проверка требований снаряжения */
function gearReq(R, entry) {
  const res = { fails: [], unknown: [] };
  if (!entry || entry.t !== 'equip') return res;
  const d = entry.data;
  if (entry.src !== 'canon') {
    if (d.Need && String(d.Need).trim()) res.unknown.push(`Требование не проверяется автоматически: ${plain(d.Need)}`);
  }
  if (Number(d.Level) > R.L) res.fails.push(`Уровень ${d.Level}+`);
  if (entry.src === 'canon') {
    const owners = DB.gearOwner.get(entry.idx);
    if (owners && !owners.includes(R.arch?.no) && !owners.includes(R.arch2?.no)) {
      res.fails.push(`Снаряжение принадлежности: ${owners.map((no) => DB.archByKey.get(`c:classes.json:${no}`)?.data.Name || no).join(', ')}`);
    }
  }
  parseStatReqs(d.Need).forEach((q) => {
    if (q.all) { if (STATS.some((k) => R.stats[k] < q.min)) res.fails.push(`Все характеристики ${q.min}+`); return; }
    const ok = q.any.some((k) => (q.min != null ? R.stats[k] >= q.min : R.stats[k] <= q.max));
    if (!ok) res.fails.push(q.any.map((k) => STAT_NAME[k]).join(' или ') + (q.min != null ? ` ${q.min}+` : ` ≤ ${q.max}`));
  });
  return res;
}

function gearFits(slot, entry) {
  if (!entry || entry.t !== 'equip') return false;
  const f = slot.gearFilter || {};
  if (f.only) return entry.src === 'canon' && f.only.includes(entry.idx);
  return (f.types || []).includes(entry.data.ItemType);
}

function featFits(slot, entry) {
  if (!entry || entry.t !== 'feat') return false;
  const f = slot.filter;
  if (!f) return true;
  if (f.background) return entry.meta ? entry.meta.background : (entry.data.Base || []).includes('Background');
  if (f.base) return (entry.data.Base || []).some((b) => f.base.includes(b));
  return true;
}

function checkAll(R) {
  R.feats.forEach((rec) => {
    rec.req = featReq(R, rec.entry, rec.ctx);
    if (rec.dup) rec.req.fails.push('Черта уже есть у персонажа');
  });
  R.slots.forEach((s) => {
    if (s.kind === 'gear' && s.entry) s.req = gearReq(R, s.entry);
    if ((s.kind === 'feat' || (s.kind === 'asi' && s.entry)) && s.entry) {
      const rec = R.feats.find((r) => r.ctx.slot === s);
      s.req = rec ? rec.req : { fails: [], unknown: [] };
      if (s.kind === 'feat' && !featFits(s, s.entry)) s.req.fails.push('Не подходит для этого слота');
    }
    if (s.kind === 'ego' && s.entry?.ego) {
      const e = s.entry.ego;
      s.req = { fails: [], unknown: [] };
      if (e.kind !== s.egoKind) s.req.fails.push('Не тот вид Э.Г.О.');
      if (e.kind === 'attack' && e.rank > s.maxRank) s.req.fails.push(`Ранг выше ${window.EgoCore.rankName(s.maxRank)}`);
      if (window.EgoCore.spent(e) > window.EgoCore.maxPoints(e)) s.req.fails.push('Превышен бюджет очков');
    }
  });
  S.extras.forEach((x) => {
    const info = R.xinfo.get(x.id) || { entry: null, why: [] };
    const e = info.entry;
    const why = info.why;
    if (!e) why.push('Объект не найден в базе');
    else {
      if (isCustom(e)) why.push('Пользовательский объект — на усмотрение ДМ-а');
      if (e.t === 'feat') { const rec = R.feats.find((r) => r.ctx.extra === x); if (rec) why.push(...rec.req.fails.map((f) => `Не выполнено: ${f}`)); }
      if (e.t === 'equip') why.push(...gearReq(R, e).fails.map((f) => `Не выполнено: ${f}`));
      if (e.t === 'ego' && e.ego) {
        const max = window.EgoCore.maxRankForLevel(R.L);
        if (e.ego.kind === 'attack' && (!R.egoAttack || e.ego.rank > max)) why.push(R.egoAttack ? `Ранг выше доступного (${max ? window.EgoCore.rankName(max) : '—'})` : 'Нет черты «Э.Г.О.-оружие»');
      }
    }
    if (!why.length) why.push('Сверх лимита слотов');
  });
}

/* Точки выбора, относящиеся к источнику (включая вложенные: выданные черты, варианты выбора) */
function choicesUnder(prefix) {
  if (!R) return [];
  return R.choices.filter((c) => c.key === prefix || [ '|', '>', '#', '=' ].some((s) => c.key.startsWith(prefix + s)));
}
function slotSourceKey(slot) {
  if (slot.kind === 'race') return 'race';
  if (slot.kind === 'arch') return 'arch';
  if (slot.kind === 'option') return `${slot.id}#`;
  return `F[${slot.id}]`;
}
function slotChoices(slot) {
  const k = slotSourceKey(slot);
  if (k.endsWith('#')) return R.choices.filter((c) => c.key.startsWith(k));
  const list = choicesUnder(k);
  if (slot.kind === 'arch') list.push(...choicesUnder('arch2'));
  return list;
}

/* =====================================================================
   ДЕЙСТВИЯ
   ===================================================================== */
function setSlot(id, value) {
  if (value == null) delete S.slots[id]; else S.slots[id] = value;
  renderAll();
}
function setChoice(key, value) {
  if (value == null) delete S.choices[key]; else S.choices[key] = value;
  renderAll();
}
function addExtra(ref) {
  S.extras.push({ id: uid(), ref });
  renderAll();
  toast('Добавлено вне слотов');
}
function logRoll(text) {
  S.log.unshift(text);
  S.log = S.log.slice(0, 12);
}

function roll4d6() {
  const d = [rnd(6), rnd(6), rnd(6), rnd(6)];
  const sorted = d.slice().sort((a, b) => a - b);
  return { dice: d, total: sorted[1] + sorted[2] + sorted[3] };
}
function rollStats() {
  const res = Array.from({ length: 6 }, roll4d6);
  S.stats.pool = res.map((r) => r.total);
  S.stats.assign = {};
  STATS.forEach((k, i) => { S.stats.assign[k] = i; });
  logRoll(`${T('Характеристики')} 4d6↓: ${res.map((r) => `[${r.dice.join(',')}]→${r.total}`).join(' ')}`);
  renderAll();
}
function rollHp(kind, onlyLevel) {
  const box = S[kind];
  const n = kind === 'hp' && S.opts.durability ? 2 : 1;
  const die = kind === 'hp' ? R.die : R.spDie;
  const lvls = onlyLevel ? [onlyLevel] : Array.from({ length: R.L - 1 }, (_, i) => i + 2).filter((lv) => !Number.isFinite(box.rolls[lv]));
  if (!lvls.length) { toast('Все уровни уже брошены — нажмите на кубик уровня, чтобы перебросить'); return; }
  const parts = [];
  lvls.forEach((lv) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += rnd(die);
    box.rolls[lv] = sum;
    parts.push(`${T('ур.')}${lv}:${sum}`);
  });
  box.mode = 'roll';
  logRoll(`${kind === 'hp' ? T('Хиты') : T('Рассудок')} ${n}d${die}: ${parts.join(' ')}`);
  renderAll();
}

/* =====================================================================
   ИНТЕРФЕЙС
   ===================================================================== */
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = T(msg);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function renderAll() {
  if (!DB.ready) return;
  R = compute();
  renderBasics();
  renderStats();
  renderSlots();
  renderExtras();
  renderDossier();
  saveState();
  if (POP.host) reopenPop();
}

function renderBasics() {
  if (document.activeElement !== $('char-name')) $('char-name').value = S.name;
  if (document.activeElement !== $('char-desc')) $('char-desc').value = S.desc;
  $('char-level').value = R.L;
  $('char-base').innerHTML = Object.values(DB.bases).map((b) => `<option value="${esc(b.id)}"${b.id === S.base ? ' selected' : ''}>${esc(b.name)}</option>`).join('');
  $('char-race').innerHTML = `<option value="">-- Выберите Расу --</option>` + DB.races.map((r) => `<option value="${esc(r.id)}"${r.id === S.race ? ' selected' : ''}>${esc(r.name)}</option>`).join('');
  const archs = DB.archs.filter((a) => a.base === S.base || a.base === 'any');
  const canon = archs.filter((a) => a.src === 'canon');
  const cust = archs.filter((a) => a.src !== 'canon');
  const cur = S.arch?.key || '';
  let html = `<option value="">-- Без принадлежности --</option><optgroup label="${esc(T('Канон'))}">` +
    canon.map((a) => `<option value="${esc(a.key)}"${a.key === cur ? ' selected' : ''}>${a.no != null ? `[${a.no}] ` : ''}${esc(a.data.Name)}</option>`).join('') + '</optgroup>';
  if (cust.length) html += `<optgroup label="${esc(T('Пользовательские (на усмотрение ДМ-а)'))}">` + cust.map((a) => `<option value="${esc(a.key)}"${a.key === cur ? ' selected' : ''}>⚠ ${esc(a.data.Name)}</option>`).join('') + '</optgroup>';
  if (S.arch && !archs.some((a) => a.key === cur)) html += `<option value="${esc(cur)}" selected>⚠ ${esc(entryName(R.arch))}</option>`;
  $('char-arch').innerHTML = html;
  $('opt-durability').checked = !!S.opts.durability;
  $('opt-sanity').checked = !!S.opts.sanity;
  const cs = $('custom-status');
  cs.textContent = DB.customState === 'ok' ? `Пользовательская база: ${DB.customCount}` : DB.customState === 'error' ? 'Пользовательская база недоступна' : 'Пользовательская база: загрузка…';
  cs.className = 'custom-status ' + DB.customState;
  const pend = $('pending-btn');
  pend.hidden = !R.pending;
  pend.textContent = `Нерешённые выборы: ${R.pending}`;
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === VIEW)));
}

function renderStats() {
  const st = S.stats;
  const box = $('stats-panel');
  const methodSel = `<div class="stat-tools">
      <label class="mini-label">Метод</label>
      <select id="stat-method" class="cloud-select small">
        ${[['pointbuy', 'Покупка очков (27)'], ['array', 'Стандартный набор'], ['roll', 'Бросок 4d6 (отбросить меньший)'], ['manual', 'Вручную']]
          .map(([v, l]) => `<option value="${v}"${st.method === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
      ${st.method === 'roll' ? '<button class="btn-mini accent" data-act="roll-stats"><i class="fa-solid fa-dice"></i> Бросить характеристики</button>' : ''}
      ${st.method === 'pointbuy' ? `<span class="pb-left ${pointsLeft() < 0 ? 'bad' : ''}">Осталось очков: ${pointsLeft()}</span>` : ''}
    </div>`;
  const pool = st.method === 'array' ? STD_ARRAY : st.method === 'roll' ? st.pool : null;
  const cards = STATS.map((k) => {
    const contrib = (R.contrib[k] || []).filter((c) => c.v || c.want);
    const bonus = R.stats[k] - R.baseStats[k];
    const tip = contrib.map((c) => `${plain(c.src?.label || '')}: ${sign(c.v)}${c.v < c.want ? ` (${T('упёрлось в максимум')})` : ''}`).join('\n');
    let input;
    if (pool) {
      input = `<select class="stat-in" data-assign="${k}"><option value="">—</option>${pool.map((v, i) => {
        const takenBy = STATS.find((s) => s !== k && st.assign[s] === i);
        return `<option value="${i}"${st.assign[k] === i ? ' selected' : ''}${takenBy ? ' disabled' : ''}>${v}</option>`;
      }).join('')}</select>`;
    } else {
      const [lo, hi] = st.method === 'pointbuy' ? [8, 15] : [1, 30];
      input = `<div class="stat-step"><button data-step="${k}" data-d="-1" aria-label="-">−</button><input class="stat-in" type="number" min="${lo}" max="${hi}" data-base="${k}" value="${R.baseStats[k]}"><button data-step="${k}" data-d="1" aria-label="+">+</button></div>`;
    }
    return `<div class="stat-card">
        <div class="stat-k">${STAT_SHORT[k]}</div>
        ${input}
        <div class="stat-total" data-tip="${esc(tip)}">${R.stats[k]}<span class="stat-bonus">${bonus ? sign(bonus) : ''}</span></div>
        <div class="stat-mod">${sign(R.mods[k])}</div>
        <div class="stat-max">${T('макс.')} ${R.max[k]}</div>
      </div>`;
  }).join('');
  const hpChips = (kind) => {
    const box2 = S[kind];
    if (box2.mode !== 'roll' || R.L < 2) return '';
    return `<div class="roll-chips">${Array.from({ length: R.L - 1 }, (_, i) => i + 2).map((lv) => {
      const v = box2.rolls[lv];
      return `<button class="chip ${Number.isFinite(v) ? '' : 'empty'}" data-reroll="${kind}" data-lv="${lv}" data-tip="${esc(`${T('Уровень')} ${lv}: ${T('перебросить')}`)}">${lv}:${Number.isFinite(v) ? v : '?'}</button>`;
    }).join('')}</div>`;
  };
  const resBlock = (kind, title, value, formula, missing) => `
    <div class="res-card ${kind}">
      <div class="res-head"><span>${title}</span><span class="res-val">${value}</span></div>
      <div class="res-formula">${esc(formula)}</div>
      <div class="res-ctrl">
        <button class="seg ${S[kind].mode === 'avg' ? 'on' : ''}" data-hpmode="${kind}" data-mode="avg">Среднее</button>
        <button class="seg ${S[kind].mode === 'roll' ? 'on' : ''}" data-hpmode="${kind}" data-mode="roll">Броски</button>
        <button class="btn-mini accent" data-act="roll-${kind}"><i class="fa-solid fa-dice-d20"></i> Бросить</button>
        ${S[kind].mode === 'roll' ? `<button class="btn-mini" data-act="clear-${kind}">Сбросить</button>` : ''}
      </div>
      ${missing && missing.length ? `<div class="res-warn">Не брошены уровни: ${missing.join(', ')} (взято среднее)</div>` : ''}
      ${hpChips(kind)}
    </div>`;
  const derived = `<div class="derived">
      <div><span>${T('Бонус мастерства')}</span><b>${sign(R.pb)}</b></div>
      <div><span>${T('Скорость')}</span><b>${R.speedTotal} ${T('фт.')}</b></div>
      <div><span>${T('Кость хитов')}</span><b>${S.opts.durability ? 2 : 1}d${R.die}</b></div>
      <div><span>${T('СЛ класса')}</span><b>${R.dcValue}</b><small>${STAT_SHORT[R.dcStat]}</small></div>
      <div><span>${T('Атака класса')}</span><b>${sign(R.atk)}</b></div>
      <div><span>${T('Свет')}</span><b>${R.L >= 2 ? R.lightPool : '—'}</b><small>${R.lightStat ? STAT_SHORT[R.lightStat] : (R.L >= 2 ? T('выберите стат') : '')}</small></div>
    </div>`;
  box.innerHTML = methodSel + `<div class="stat-grid">${cards}</div>` + derived +
    `<div class="res-grid">${resBlock('hp', T('Хиты (HP)'), R.hp, R.hpFormula, S.hp.mode === 'roll' ? R.hpMissing : null)}` +
    (S.opts.sanity ? resBlock('sp', T('Рассудок (SP)'), R.sp, `1d${R.spDie} · ${T('МУД')} ${sign(R.mods.Wis)}`, S.sp.mode === 'roll' ? R.spMissing : null) : '') + '</div>' +
    (S.log.length ? `<details class="roll-log"><summary>${T('Журнал бросков')} (${S.log.length})</summary>${S.log.map((l) => `<div>${esc(l)}</div>`).join('')}</details>` : '');
}

function pointsLeft() {
  return 27 - STATS.reduce((s, k) => s + (POINT_COST[Math.max(8, Math.min(15, Number(S.stats.base[k]) || 8))] || 0), 0);
}

/* ---------- слоты ---------- */
const GROUPS = [
  ['core', 'Происхождение и класс'], ['list', 'Умения класса'], ['feat', 'Черты'],
  ['asi', 'Увеличение характеристик'], ['gear', 'Снаряжение'], ['ego', 'Э.Г.О.'],
];

function slotDisplay(slot) {
  if (slot.kind === 'race') return R.race ? { name: R.race.name, filled: true } : { filled: false };
  if (slot.kind === 'arch') return R.arch ? { name: entryName(R.arch), filled: true, custom: isCustom(R.arch) } : { filled: false };
  if (slot.kind === 'option') return slot.selected != null ? { name: slot.options[slot.selected].label, filled: true } : { filled: false };
  if (slot.kind === 'list') { const v = slot.value; return v && slot.options[v.i] ? { name: slot.options[v.i].label, filled: true } : { filled: false }; }
  if (slot.kind === 'asi') {
    const v = slot.value;
    if (!v) return { filled: false };
    if (v.mode === 'feat') return slot.entry ? { name: entryName(slot.entry), filled: true, custom: isCustom(slot.entry), sub: 'Черта' } : { filled: false };
    if (v.mode === 'plus2') return { name: `${STAT_SHORT[v.a] || '?'} +2`, filled: true };
    return { name: `${STAT_SHORT[v.a] || '?'} +1 · ${STAT_SHORT[v.b] || '?'} +1`, filled: true };
  }
  if (slot.kind === 'locked') return { filled: false, locked: true };
  return slot.entry ? { name: entryName(slot.entry), filled: true, custom: isCustom(slot.entry) } : { filled: false };
}

function slotHtml(slot) {
  const d = slotDisplay(slot);
  const cat = CAT[slot.cat] || CAT.text;
  const cps = slotChoices(slot);
  const pending = cps.some((c) => c.pending) || slot.pendingFlag;
  const fails = slot.req?.fails?.length;
  const cls = ['slot', VIEW === 'cubes' ? 'cube' : 'row', d.filled ? 'filled' : 'empty', pending ? 'pending' : '', fails ? 'warn' : '', d.custom ? 'custom' : '', d.locked ? 'locked' : ''].join(' ');
  const lvl = slot.level > 1 ? `<span class="lvl">${T('ур.')} ${slot.level}</span>` : '';
  const badges = `${pending ? '<span class="badge-pend" data-tip="Есть нерешённый выбор — наведите, чтобы выбрать">!</span>' : ''}${fails ? `<span class="badge-warn" data-tip="${esc(slot.req.fails.join('; '))}">⚠</span>` : ''}${d.custom ? '<span class="badge-dm" data-tip="Пользовательский объект — на усмотрение ДМ-а">ДМ</span>' : ''}`;
  const attrs = `class="${cls}" style="--c:${cat.color}" data-slot="${esc(slot.id)}" ${cps.length ? `data-choices="${esc(slot.id)}"` : ''} tabindex="0"`;
  if (VIEW === 'cubes') {
    return `<div ${attrs} data-tip="${esc(slot.hint || '')}">
        <div class="cube-face">
          <i class="fa-solid ${d.filled ? cat.icon : (d.locked ? 'fa-lock' : 'fa-plus')} cube-ico"></i>
          <div class="cube-name">${esc(d.filled ? d.name : slot.label)}</div>
          ${d.filled ? `<div class="cube-sub">${esc(slot.label)}</div>` : ''}
          ${lvl}${badges}
        </div>
      </div>`;
  }
  const desc = d.filled ? slotDesc(slot) : `<div class="row-empty">${esc(slot.hint || 'Пусто — нажмите, чтобы выбрать')}</div>`;
  return `<div ${attrs}>
      <div class="row-head"><i class="fa-solid ${cat.icon}"></i><span class="row-label">${esc(slot.label)}</span>${lvl}<span class="row-name">${esc(d.filled ? d.name : '—')}</span>${badges}
        <span class="row-act">${d.locked ? '' : `<button class="btn-mini" data-open="${esc(slot.id)}">${d.filled ? 'Изменить' : 'Выбрать'}</button>`}${d.filled && slot.kind !== 'race' && slot.kind !== 'arch' ? `<button class="btn-mini red" data-clear="${esc(slot.id)}" aria-label="Убрать"><i class="fa-solid fa-xmark"></i></button>` : ''}</span></div>
      <div class="row-desc">${desc}</div>
    </div>`;
}

function slotDesc(slot) {
  if (slot.kind === 'race') return R.race.traits.map((t) => `<p><b>${esc(t.name)}.</b> ${esc(t.desc)}</p>`).join('');
  if (slot.kind === 'arch') return `<div class="md">${archTalentsHtml(R.arch, true)}</div>`;
  if (slot.kind === 'option') return `<div class="md">${md(slot.options[slot.selected].desc || '')}</div>`;
  if (slot.kind === 'list') return `<div class="md">${md(slot.options[slot.value.i].desc || '')}</div>`;
  if (slot.kind === 'asi' && slot.value?.mode !== 'feat') return `<div>${esc(T('Прибавка к характеристикам с этого уровня.'))}</div>`;
  return entryHtml(slot.entry, slot.req);
}

function renderSlots() {
  const box = $('slots');
  box.className = `slots-wrap view-${VIEW}`;
  box.innerHTML = GROUPS.map(([g, title]) => {
    const list = R.slots.filter((s) => s.group === g).sort((a, b) => (a.kind === 'race' || a.kind === 'arch' ? 0 : a.level) - (b.kind === 'race' || b.kind === 'arch' ? 0 : b.level));
    if (!list.length) return '';
    const filled = list.filter((s) => slotDisplay(s).filled).length;
    const real = list.filter((s) => s.kind !== 'locked').length;
    return `<div class="slot-group">
        <div class="group-title">${title} <span class="group-count">${filled}/${real}</span></div>
        <div class="group-items">${list.map(slotHtml).join('')}</div>
      </div>`;
  }).join('') + grantedHtml();
}

function grantedHtml() {
  const granted = R.feats.filter((r) => !r.ctx.slot && !r.ctx.extra);
  if (!granted.length) return '';
  return `<div class="slot-group"><div class="group-title">Полученные черты <span class="group-count">${granted.length}</span></div><div class="group-items">${granted.map((rec) => {
    const cat = CAT.feat;
    const key = rec.ctx.key;
    const cps = choicesUnder(key);
    const pending = cps.some((c) => c.pending);
    const fails = rec.req.fails.length;
    const from = plain(rec.ctx.grantedBy?.label || '');
    const cls = ['slot', VIEW === 'cubes' ? 'cube' : 'row', 'filled', 'granted', pending ? 'pending' : '', fails ? 'warn' : ''].join(' ');
    const badges = `${pending ? '<span class="badge-pend">!</span>' : ''}${fails ? `<span class="badge-warn" data-tip="${esc(rec.req.fails.join('; '))}">⚠</span>` : ''}`;
    const attrs = `class="${cls}" style="--c:${cat.color}" data-granted="${esc(key)}" ${cps.length ? `data-choices-key="${esc(key)}"` : ''} tabindex="0"`;
    if (VIEW === 'cubes') {
      return `<div ${attrs}><div class="cube-face"><i class="fa-solid fa-link cube-ico"></i><div class="cube-name">${esc(rec.entry.data.Name)}</div><div class="cube-sub">${esc(T('от:'))} ${esc(from)}</div>${badges}</div></div>`;
    }
    return `<div ${attrs}><div class="row-head"><i class="fa-solid fa-link"></i><span class="row-label">${esc(T('от:'))} ${esc(from)}</span><span class="row-name">${esc(rec.entry.data.Name)}</span>${badges}</div><div class="row-desc">${entryHtml(rec.entry, rec.req)}</div></div>`;
  }).join('')}</div></div>`;
}

function renderExtras() {
  const box = $('extras');
  box.className = `slots-wrap view-${VIEW}`;
  const items = S.extras.map((x) => {
    const e = xe(x).entry;
    const cat = CAT[e ? (e.t === 'equip' ? 'gear' : e.t === 'text' ? 'text' : e.t) : 'text'] || CAT.text;
    const key = `X[${x.id}]`;
    const cps = choicesUnder(key);
    const pending = cps.some((c) => c.pending);
    const cls = ['slot', VIEW === 'cubes' ? 'cube' : 'row', 'filled', 'extra', pending ? 'pending' : '', isCustom(e) ? 'custom' : ''].join(' ');
    const why = (xe(x).why || []).join('\n');
    const badges = `${pending ? '<span class="badge-pend">!</span>' : ''}<span class="badge-dm" data-tip="${esc(why)}">ДМ</span>`;
    const attrs = `class="${cls}" style="--c:${cat.color}" data-extra="${esc(x.id)}" ${cps.length ? `data-choices-key="${esc(key)}"` : ''} tabindex="0"`;
    if (VIEW === 'cubes') {
      return `<div ${attrs} data-tip="${esc(why)}"><div class="cube-face"><i class="fa-solid ${cat.icon} cube-ico"></i><div class="cube-name">${esc(entryName(e))}</div><div class="cube-sub">${esc(cat.label)}</div>${badges}</div></div>`;
    }
    return `<div ${attrs}><div class="row-head"><i class="fa-solid ${cat.icon}"></i><span class="row-label">${esc(cat.label)}</span><span class="row-name">${esc(entryName(e))}</span>${badges}
        <span class="row-act"><button class="btn-mini red" data-rmextra="${esc(x.id)}" aria-label="Убрать"><i class="fa-solid fa-xmark"></i></button></span></div>
        <div class="row-why">${(xe(x).why || []).map((w) => `<div>⚠ ${esc(w)}</div>`).join('')}</div>
        <div class="row-desc">${e ? entryHtml(e) : ''}</div></div>`;
  }).join('');
  const add = VIEW === 'cubes'
    ? `<div class="slot cube empty add" style="--c:#696969" data-act="add-extra" tabindex="0"><div class="cube-face"><i class="fa-solid fa-plus cube-ico"></i><div class="cube-name">Добавить</div></div></div>`
    : `<div class="slot row empty add" data-act="add-extra" tabindex="0"><div class="row-head"><i class="fa-solid fa-plus"></i><span class="row-name">Добавить объект вне слотов</span></div></div>`;
  box.innerHTML = `<div class="group-items">${items}${add}</div>`;
}

/* ---------- описание объектов ---------- */
function reqHtml(req) {
  if (!req) return '';
  return (req.fails || []).map((f) => `<div class="req bad"><i class="fa-solid fa-xmark"></i> ${esc(f)}</div>`).join('') +
    (req.unknown || []).map((f) => `<div class="req unk"><i class="fa-solid fa-circle-question"></i> ${esc(f)}</div>`).join('');
}
function srcBadge(e) {
  if (!e) return '';
  if (e.src === 'custom') return `<span class="src-badge dm">${esc(T('Пользовательское'))}${e.creator ? ` · ${esc(e.creator)}` : ''} — ${esc(T('на усмотрение ДМ-а'))}</span>`;
  if (e.src === 'file') return `<span class="src-badge dm">${esc(T('Из файла — на усмотрение ДМ-а'))}</span>`;
  return '';
}
function entryHtml(e, req) {
  if (!e) return '';
  const d = e.data || {};
  let h = srcBadge(e) + reqHtml(req);
  if (e.t === 'feat') {
    if (d.Need && d.Need !== 'null') h += `<div class="need">${esc(T('Требования:'))} ${esc(plain(d.Need))}</div>`;
    h += `<div class="md">${md(d.desc)}</div>`;
  } else if (e.t === 'equip') {
    h += `<div class="need">${esc(T(ITEM_TYPE[d.ItemType] || d.ItemType || ''))} · ${esc(d.Rarity || '')} · ${esc(T('ур.'))} ${esc(d.Level ?? '-')}${d.IsEGO ? ' · Э.Г.О.' : ''}</div>`;
    if (d.Need) h += `<div class="need">${esc(T('Требования:'))} ${esc(plain(d.Need))}</div>`;
    h += `<div class="md">${md(d.Desc)}</div>`;
  } else if (e.t === 'gift') {
    h += `<div class="need">${esc(T('Уровень'))} ${esc(d.Level)} · ${esc((d.Type || []).join(', '))}</div><div class="md">${md(d.Description)}</div>`;
  } else if (e.t === 'arch') {
    h += `<div class="md">${archTalentsHtml(e, false)}</div>`;
  } else if (e.t === 'ego') {
    h += e.ego ? `<div class="need">${esc(window.EgoCore.metaLine(e.ego))}</div>${window.EgoCore.summaryHtml(e.ego)}` : '';
  } else if (e.t === 'text') {
    h += `<div class="md">${md(d.desc)}</div>`;
  }
  return h;
}
function archTalentsHtml(e, upToLevel) {
  if (!e) return '';
  const list = (e.data.Talents || []).filter((t) => !upToLevel || Number(t.level) <= R.L);
  let h = e.data.Desc ? md(e.data.Desc) : '';
  h += list.map((t) => `<h4>${esc(t.name)} <span class="lvl-inline">${esc(T('ур.'))} ${esc(t.level)}</span></h4>${md(t.desc)}`).join('');
  return h || `<p>${esc(T('Способности не указаны.'))}</p>`;
}

/* ---------- досье ---------- */
function block(title, color, inner) {
  return inner ? `<div class="block-title" style="color:${color};border-color:${color}">${esc(title)}</div>${inner}` : '';
}
function entryBlock(title, body, color, sub) {
  return `<div class="trait-entry" style="border-left-color:${color}" data-copy>
      <div class="trait-name" style="color:${color}">${esc(title)}</div>
      ${sub ? `<div class="tech-text">${esc(sub)}</div>` : ''}
      <div class="trait-desc">${body}</div>
      <div class="copy-msg">Скопировано!</div>
    </div>`;
}
function renderDossier() {
  $('out-name').textContent = S.name || T('БЕЗ ИМЕНИ');
  $('out-meta').textContent = [R.race ? R.race.name : T('Раса не выбрана'), R.base.name + (R.arch ? ` / ${entryName(R.arch)}` : ''), `${T('Уровень')} ${R.L}`].join(' | ');
  let h = '';
  // сводка
  h += `<div class="sheet-stats">${STATS.map((k) => `<div class="ss"><div class="ss-k">${STAT_SHORT[k]}</div><div class="ss-v">${R.stats[k]}</div><div class="ss-m">${sign(R.mods[k])}</div></div>`).join('')}</div>`;
  h += `<div class="sheet-line">${[
    `${T('Хиты')}: <b>${R.hp}</b>`, S.opts.sanity ? `${T('Рассудок')}: <b>${R.sp}</b>` : '', `${T('БМ')}: <b>${sign(R.pb)}</b>`,
    `${T('Скорость')}: <b>${R.speedTotal} ${T('фт.')}</b>`, `${T('СЛ')}: <b>${R.dcValue}</b>`, `${T('Атака')}: <b>${sign(R.atk)}</b>`,
    R.L >= 2 ? `${T('Свет')}: <b>${R.lightPool}</b>` : '', `${T('Кость хитов')}: <b>${S.opts.durability ? 2 : 1}d${R.die}</b>`,
  ].filter(Boolean).join(' · ')}</div>`;

  const warns = [];
  if (R.pending) warns.push(`${T('Нерешённые выборы')}: ${R.pending}`);
  R.slots.forEach((s) => (s.req?.fails || []).forEach((f) => warns.push(`${s.label}: ${f}`)));
  R.feats.filter((r) => !r.ctx.slot && !r.ctx.extra).forEach((r) => r.req.fails.forEach((f) => warns.push(`${r.entry.data.Name}: ${f}`)));
  S.extras.forEach((x) => warns.push(`${T('Вне слотов')} — ${entryName(xe(x).entry)}: ${(xe(x).why || []).join('; ')}`));
  [R.arch, ...R.slots.map((s) => s.entry)].filter(isCustom).forEach((e) => warns.push(`${entryName(e)}: ${T('пользовательский объект — на усмотрение ДМ-а')}`));
  if (S.stats.method === 'pointbuy' && pointsLeft() < 0) warns.push(T('Покупка очков: превышен бюджет'));
  if (warns.length) h += `<div class="dm-warn"><div class="dm-warn-t"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(T('Требует внимания / на усмотрение ДМ-а'))}</div>${warns.map((w) => `<div>• ${esc(w)}</div>`).join('')}</div>`;

  if (S.desc.trim()) h += block(T('БАЗОВАЯ ИНФОРМАЦИЯ'), 'var(--text-dim)', entryBlock(T('Биография и Описание'), esc(S.desc), 'var(--text-dim)'));
  if (R.race) {
    const ch = choiceSummary('race');
    h += block(`${T('Особенности Расы:')} ${R.race.name}`, 'var(--color-red)', R.race.traits.map((t) => entryBlock(t.name, esc(t.desc), 'var(--color-red)')).join('') + ch);
  }
  // основной класс
  const hide = new Set(R.base.hide || []);
  const pickedByTalent = {};
  R.slots.forEach((s) => {
    const eff = (R.base.effects || []).find((x) => (x.type === 'pickList' && s.listId === x.id && s.src?.isBase) || (x.type === 'choice' && s.id === `base:${x.id}`));
    if (!eff || eff.talent == null) return;
    const d = slotDisplay(s);
    if (d.filled) (pickedByTalent[eff.talent] ||= []).push(d.name);
  });
  h += block(`${T('Основной класс:')} ${R.base.name}`, 'var(--color-cyan)', (R.baseData.Talents || []).map((t, i) => {
    if (hide.has(i) || Number(t.level) > R.L) return '';
    const picked = pickedByTalent[i] ? `<div class="picked">${esc(T('Выбрано:'))} ${pickedByTalent[i].map(esc).join(', ')}</div>` : '';
    return entryBlock(t.name, picked + md(t.desc), 'var(--color-cyan)', `${T('Уровень:')} ${t.level}`);
  }).join(''));
  [[R.arch, 'arch'], [R.arch2, 'arch2']].forEach(([a, key]) => {
    if (!a) return;
    const tal = (a.data.Talents || []).filter((t) => Number(t.level) <= R.L);
    h += block(`${key === 'arch2' ? T('Доп. принадлежность:') : T('Архетип:')} ${entryName(a)}`, 'var(--accent-primary)',
      srcBadge(a) + tal.map((t) => entryBlock(t.name, md(t.desc), t.Color || t.color || 'var(--accent-primary)', `${T('Уровень:')} ${t.level}`)).join('') + choiceSummary(key));
  });
  // черты
  const featsHtml = R.feats.map((rec) => {
    const via = rec.ctx.slot ? rec.ctx.slot.label : rec.ctx.extra ? T('Вне слотов') : `${T('от:')} ${plain(rec.ctx.grantedBy?.label || '')}`;
    const body = srcBadge(rec.entry) + reqHtml(rec.req) + (rec.entry.data.Need && rec.entry.data.Need !== 'null' ? `<div class="need">${esc(T('Требования:'))} ${esc(plain(rec.entry.data.Need))}</div>` : '') +
      choiceSummary(rec.ctx.key) + md(rec.entry.data.desc);
    return entryBlock(rec.entry.data.Name, body, 'var(--color-yellow)', via);
  }).join('');
  h += block(T('Черты'), 'var(--color-yellow)', featsHtml);
  const asi = R.slots.filter((s) => s.kind === 'asi' && s.value && s.value.mode !== 'feat').map((s) => `<div>${esc(T('ур.'))} ${s.level}: ${esc(slotDisplay(s).name)}</div>`).join('');
  h += block(T('Увеличение характеристик'), '#D9772F', asi ? `<div class="trait-entry" style="border-left-color:#D9772F">${asi}</div>` : '');
  const gear = R.slots.filter((s) => s.kind === 'gear' && s.entry).map((s) => entryBlock(entryName(s.entry), entryHtml(s.entry, s.req), '#9B59B6', s.label)).join('');
  h += block(T('Снаряжение'), '#9B59B6', gear);
  const egos = R.slots.filter((s) => s.kind === 'ego' && s.entry).map((s) => entryBlock(entryName(s.entry), entryHtml(s.entry, s.req), '#D94285', s.label)).join('');
  h += block('Э.Г.О.', '#D94285', egos);
  const extras = S.extras.filter((x) => xe(x).entry && xe(x).entry.t !== 'feat').map((x) => entryBlock(entryName(xe(x).entry), entryHtml(xe(x).entry), '#B0B0B0', `${T('Вне слотов')}: ${(xe(x).why || []).join('; ')}`)).join('');
  h += block(T('Вне слотов (на усмотрение ДМ-а)'), '#B0B0B0', extras);
  if (R.notes.length) h += block(T('Примечания'), 'var(--text-dim)', R.notes.map((n) => `<div class="note">• ${esc(plain(n.src.label))}: ${esc(n.text)}</div>`).join(''));
  $('out-content').innerHTML = h;
}

function choiceSummary(prefix) {
  const list = choicesUnder(prefix);
  if (!list.length) return '';
  return `<div class="picked">${list.map((c) => `${esc(c.label)}: <b>${esc(choiceValueLabel(c) || T('не выбрано'))}</b>`).join('<br>')}</div>`;
}
function choiceValueLabel(c) {
  if (c.kind === 'stat') return (c.value || []).map((k) => `${STAT_NAME[k]} +${c.amount}`).join(', ');
  if (c.kind === 'pick') return Number.isInteger(c.value) && c.options[c.value] ? c.options[c.value].label : '';
  if (c.kind === 'feat') { const f = c.value ? resolve(typeof c.value === 'string' ? { t: 'feat', key: c.value } : c.value) : null; return f ? f.data.Name : ''; }
  if (c.kind === 'class') { const a = c.value ? resolve(typeof c.value === 'string' ? { t: 'arch', key: c.value } : c.value) : null; return a ? entryName(a) : ''; }
  return '';
}

/* ---------- выборы (поповер и модальное окно) ---------- */
function choiceControls(list) {
  return list.map((c) => {
    let opts = '';
    if (c.kind === 'stat') {
      opts = c.options.map((o) => `<button class="cp-opt ${(c.value || []).includes(o.v) ? 'on' : ''}" data-cp="${esc(c.key)}" data-v="${o.v}">${esc(o.label)} +${c.amount}</button>`).join('');
      if (c.count > 1) opts += `<span class="cp-hint">${esc(T('выберите'))} ${c.count}</span>`;
    } else if (c.kind === 'pick') {
      opts = c.options.map((o) => `<button class="cp-opt ${c.value === o.v ? 'on' : ''}" data-cp="${esc(c.key)}" data-v="${o.v}" data-tip="${esc(plain(o.desc || '').slice(0, 300))}">${esc(o.label)}</button>`).join('');
      if (!c.options.length) opts = `<span class="cp-hint">${esc(T('Варианты не найдены в тексте — обсудите с ДМ-ом'))}</span>`;
    } else if (c.kind === 'feat') {
      if (c.any) {
        opts = `<button class="cp-opt ${c.value ? 'on' : ''}" data-cp-feat="${esc(c.key)}">${esc(choiceValueLabel(c) || T('Выбрать черту…'))}</button>`;
      } else {
        opts = c.options.map((o) => {
          const req = c.ignoreReq ? { fails: [] } : featReq(R, o.entry, null);
          const has = R.owned.get(o.entry.id) && c.value !== o.v;
          const dis = req.fails.length || has;
          const tip = has ? T('Черта уже есть') : req.fails.join('; ');
          return `<button class="cp-opt ${c.value === o.v ? 'on' : ''} ${dis ? 'dis' : ''}" data-cp="${esc(c.key)}" data-v="${esc(o.v)}" data-tip="${esc(tip)}">${esc(o.label)}</button>`;
        }).join('');
      }
    } else if (c.kind === 'class') {
      const cur = typeof c.value === 'string' ? c.value : c.value?.key || '';
      opts = `<select class="cloud-select small" data-cp-class="${esc(c.key)}"><option value="">—</option>${DB.archs.filter((a) => a.key !== S.arch?.key).map((a) => `<option value="${esc(a.key)}"${a.key === cur ? ' selected' : ''}>${a.src !== 'canon' ? '⚠ ' : ''}${esc(a.data.Name)}</option>`).join('')}</select>`;
    }
    return `<div class="cp ${c.pending ? 'cp-pending' : ''}"><div class="cp-label">${esc(c.label)} <span class="cp-src">· ${esc(plain(c.src.label))}</span></div><div class="cp-opts">${opts}</div></div>`;
  }).join('');
}

function handleChoiceClick(t) {
  const key = t.dataset.cp;
  const c = R.choices.find((x) => x.key === key);
  if (!c || t.classList.contains('dis')) return;
  if (c.kind === 'stat') {
    let v = (c.value || []).slice();
    const k = t.dataset.v;
    if (v.includes(k)) v = v.filter((x) => x !== k);
    else { v.push(k); if (v.length > c.count) v = v.slice(-c.count); }
    setChoice(key, v);
  } else if (c.kind === 'pick') {
    const v = Number(t.dataset.v);
    setChoice(key, c.value === v ? null : v);
  } else if (c.kind === 'feat') {
    setChoice(key, c.value === t.dataset.v ? null : t.dataset.v);
  }
}

const POP = { host: null, sel: null, timer: null };
function popHostChoices(host) {
  if (host.dataset.choices) { const s = R.slotById.get(host.dataset.choices); return s ? slotChoices(s) : []; }
  if (host.dataset.choicesKey) return choicesUnder(host.dataset.choicesKey);
  return [];
}
function showPop(host) {
  const list = popHostChoices(host);
  const pop = $('choice-pop');
  if (!list.length) { hidePop(); return; }
  POP.host = host;
  POP.sel = host.dataset.choices ? `[data-choices="${CSS.escape(host.dataset.choices)}"]` : `[data-choices-key="${CSS.escape(host.dataset.choicesKey)}"]`;
  pop.innerHTML = `<div class="pop-title"><i class="fa-solid fa-hand-pointer"></i> ${esc(T('Сделайте выбор'))}</div>` + choiceControls(list);
  pop.hidden = false;
  const r = host.getBoundingClientRect();
  const pw = Math.min(380, window.innerWidth - 16);
  pop.style.width = pw + 'px';
  let left = r.right + 8;
  if (left + pw > window.innerWidth - 8) left = Math.max(8, r.left - pw - 8);
  if (left < 8) left = 8;
  let top = r.top;
  pop.style.left = left + 'px';
  pop.style.top = Math.max(8, top) + 'px';
  const ph = pop.getBoundingClientRect().height;
  if (top + ph > window.innerHeight - 8) pop.style.top = Math.max(8, window.innerHeight - ph - 8) + 'px';
}
function hidePop() { $('choice-pop').hidden = true; POP.host = null; POP.sel = null; }
function reopenPop() {
  const host = POP.sel && document.querySelector(POP.sel);
  if (host) showPop(host); else hidePop();
}

/* ---------- модальные окна ---------- */
function openModal(title, html, color) {
  $('modal-title').textContent = T(title);
  $('modal-title').style.color = color || '';
  $('modal-body').innerHTML = html;
  $('modal').hidden = false;
  document.body.classList.add('modal-open');
  const s = $('modal-body').querySelector('input[type=search]');
  if (s) setTimeout(() => s.focus(), 30);
}
function closeModal() {
  $('modal').hidden = true;
  document.body.classList.remove('modal-open');
  MODAL.onPick = null;
  MODAL.ego = null;
}
const MODAL = { onPick: null, items: [], ego: null, slotId: null };

/* Окно выбора: items = [{ key, title, sub, desc, entry, ok, reasons, custom }] */
function openPicker(title, items, onPick, opts = {}) {
  MODAL.onPick = onPick;
  MODAL.items = items;
  MODAL.showAll = false;
  MODAL.opts = opts;
  openModal(title, `
    ${opts.top || ''}
    <div class="picker-tools"><input type="search" class="cloud-input" id="picker-q" placeholder="Поиск…">
      ${items.some((i) => !i.ok) ? `<label class="chk"><input type="checkbox" id="picker-all"> ${esc(T('Показать недоступные'))}</label>` : ''}</div>
    <div class="picker-list" id="picker-list"></div>`, opts.color);
  renderPicker();
}
function renderPicker() {
  const q = lower($('picker-q')?.value);
  const list = MODAL.items.filter((i) => (MODAL.showAll || i.ok) && (!q || lower(i.title + ' ' + (i.sub || '') + ' ' + plain(i.desc || '')).includes(q)));
  $('picker-list').innerHTML = list.length ? list.map((i) => `
    <div class="pick ${i.ok ? '' : 'bad'} ${i.custom ? 'custom' : ''}" data-pick="${MODAL.items.indexOf(i)}">
      <div class="pick-head"><span class="pick-name">${esc(i.title)}</span>${i.custom ? '<span class="badge-dm">ДМ</span>' : ''}${i.sub ? `<span class="pick-sub">${esc(i.sub)}</span>` : ''}</div>
      ${(i.reasons || []).length ? `<div class="pick-why">${i.reasons.map((r) => `<div>${i.ok ? '⚠' : '✕'} ${esc(r)}</div>`).join('')}</div>` : ''}
      ${i.desc ? `<details class="pick-desc"><summary>${esc(T('Описание'))}</summary><div class="md">${md(i.desc)}</div></details>` : ''}
      ${i.ok ? '' : `<button class="btn-mini" data-pick-extra="${MODAL.items.indexOf(i)}">${esc(T('Добавить вне слотов'))}</button>`}
    </div>`).join('') : `<div class="row-empty">${esc(T('Ничего не найдено'))}</div>`;
}

function featItems(filterFn, ignoreReq, slot) {
  return DB.feats.filter((f) => filterFn(f)).map((f) => {
    const req = ignoreReq ? { fails: [], unknown: [] } : featReq(R, f, slot ? { key: `F[${slot.id}]` } : null);
    const curKey = slot ? (slot.kind === 'asi' ? slot.value?.ref?.key : slot.value?.key) : null;
    const has = R.owned.get(f.id || f.key) && !f.meta?.repeatable && f.key !== curKey;
    const reasons = [...req.fails, ...(has ? ['Черта уже есть у персонажа'] : []), ...req.unknown];
    if (isCustom(f)) reasons.push('Пользовательский объект — на усмотрение ДМ-а');
    return { key: f.key, title: f.data.Name, sub: (f.data.Base || []).join(', '), desc: (f.data.Need && f.data.Need !== 'null' ? `**${T('Требования:')}** ${f.data.Need}\n\n` : '') + (f.data.desc || ''), entry: f, ok: !req.fails.length && !has, reasons, custom: isCustom(f) };
  }).sort((a, b) => (b.ok - a.ok) || (a.custom - b.custom));
}
function equipItems(filterFn) {
  return DB.equip.filter(filterFn).map((e) => {
    const req = gearReq(R, e);
    const reasons = [...req.fails, ...req.unknown];
    if (isCustom(e)) reasons.push('Пользовательский объект — на усмотрение ДМ-а');
    return { key: e.key, title: e.data.Name, sub: `${T(ITEM_TYPE[e.data.ItemType] || e.data.ItemType || '')} · ${e.data.Rarity || ''} · ${T('ур.')} ${e.data.Level ?? '-'}${e.data.IsEGO ? ' · Э.Г.О.' : ''}`, desc: (e.data.Need ? `**${T('Требования:')}** ${e.data.Need}\n\n` : '') + (e.data.Desc || ''), entry: e, ok: !req.fails.length, reasons, custom: isCustom(e) };
  }).sort((a, b) => (b.ok - a.ok) || (Number(a.entry.data.Level) - Number(b.entry.data.Level)));
}

function openSlot(id) {
  const slot = R.slotById.get(id);
  if (!slot || slot.kind === 'locked') { if (slot?.hint) toast(slot.hint); return; }
  const d = slotDisplay(slot);
  if (d.filled && VIEW === 'cubes') { openDetail(slot); return; }
  openSlotPicker(slot);
}

function openSlotPicker(slot) {
  const cat = CAT[slot.cat];
  if (slot.kind === 'race') {
    openPicker('Раса', DB.races.map((r) => ({ key: r.id, title: r.name, desc: r.traits.map((t) => `**${t.name}.** ${t.desc}`).join('\n\n'), ok: true })),
      (it) => { S.race = it.key; closeModal(); renderAll(); }, { color: cat.color });
  } else if (slot.kind === 'arch') {
    const items = DB.archs.filter((a) => a.base === S.base || a.base === 'any').map((a) => ({
      key: a.key, title: (a.no != null ? `[${a.no}] ` : '') + a.data.Name, sub: (a.data.Stats || []).join(', '),
      desc: (a.data.Talents || []).map((t) => `**${t.name}** (${T('ур.')} ${t.level})\n\n${t.desc}`).join('\n\n'), entry: a, ok: true,
      custom: isCustom(a), reasons: isCustom(a) ? ['Пользовательский объект — на усмотрение ДМ-а'] : [],
    }));
    openPicker(slot.label, items, (it) => { S.arch = makeRef(it.entry); closeModal(); renderAll(); }, { color: cat.color });
  } else if (slot.kind === 'option' || slot.kind === 'list') {
    const taken = slot.kind === 'list' ? R.slots.filter((s) => s.kind === 'list' && s.listId === slot.listId && s !== slot && s.value).map((s) => s.value.i) : [];
    const items = slot.options.map((o) => ({ key: o.v, title: o.label, desc: o.desc, ok: !taken.includes(o.v), reasons: taken.includes(o.v) ? ['Уже выбрано в другом слоте'] : [] }));
    openPicker(slot.label, items, (it) => { closeModal(); setSlot(slot.id, { i: it.key, label: it.title }); }, { color: cat.color });
  } else if (slot.kind === 'feat') {
    const items = featItems((f) => featFits(slot, f), false, slot);
    openPicker(slot.label, items, (it) => { closeModal(); setSlot(slot.id, makeRef(it.entry)); }, { color: cat.color });
  } else if (slot.kind === 'asi') {
    openAsi(slot);
  } else if (slot.kind === 'gear') {
    const items = equipItems((e) => gearFits(slot, e));
    const top = `${slot.hint ? `<div class="hint">${esc(slot.hint)}</div>` : ''}<button class="btn-mini" id="gear-own"><i class="fa-solid fa-pen-nib"></i> ${esc(T('Своё мастерское снаряжение…'))}</button>`;
    openPicker(slot.label, items, (it) => { closeModal(); setSlot(slot.id, makeRef(it.entry)); }, { color: cat.color, top });
    MODAL.slotId = slot.id;
  } else if (slot.kind === 'ego') {
    openEgoPicker(slot);
  }
}

function openAsi(slot) {
  const v = slot.value || {};
  const sel = (name, cur) => `<select class="cloud-select small" id="${name}"><option value="">—</option>${STATS.map((k) => `<option value="${k}"${cur === k ? ' selected' : ''}>${STAT_NAME[k]} (${R.stats[k]})</option>`).join('')}</select>`;
  openModal(`Увеличение характеристик · ${T('ур.')} ${slot.level}`, `
    <div class="asi-opts">
      <div class="asi-card"><div class="asi-t">+2 к одной характеристике</div>${sel('asi-a2', v.mode === 'plus2' ? v.a : '')}<button class="btn-mini accent" id="asi-ok2">Применить</button></div>
      <div class="asi-card"><div class="asi-t">+1 к двум характеристикам</div>${sel('asi-a', v.mode === 'plus11' ? v.a : '')}${sel('asi-b', v.mode === 'plus11' ? v.b : '')}<button class="btn-mini accent" id="asi-ok11">Применить</button></div>
      ${slot.noFeat ? '' : `<div class="asi-card"><div class="asi-t">Вместо этого — черта</div><div class="hint">${esc(v.mode === 'feat' && slot.entry ? entryName(slot.entry) : '')}</div><button class="btn-mini accent" id="asi-feat">Выбрать черту…</button></div>`}
    </div>
    <div class="hint">${esc(T('Как обычно, характеристику нельзя поднять выше максимума (20, если он не увеличен).'))}</div>`, CAT.asi.color);
  $('asi-ok2').onclick = () => { const a = $('asi-a2').value; if (!a) return; closeModal(); setSlot(slot.id, { mode: 'plus2', a }); };
  $('asi-ok11').onclick = () => {
    const a = $('asi-a').value, b = $('asi-b').value;
    if (!a || !b || a === b) { toast('Выберите две разные характеристики'); return; }
    closeModal(); setSlot(slot.id, { mode: 'plus11', a, b });
  };
  if (!slot.noFeat) $('asi-feat').onclick = () => {
    openPicker('Черта вместо увеличения характеристик', featItems(() => true, false, slot), (it) => { closeModal(); setSlot(slot.id, { mode: 'feat', ref: makeRef(it.entry) }); }, { color: CAT.feat.color });
  };
}

function openEgoPicker(slot) {
  const lib = window.EgoCore.library.list();
  const items = lib.map((e) => {
    const reasons = [];
    if (e.kind !== slot.egoKind) reasons.push(slot.egoKind === 'attack' ? 'Это не атака Э.Г.О.' : 'Это не Расцветающее/Нестабильное Э.Г.О.');
    if (e.kind === 'attack' && e.rank > slot.maxRank) reasons.push(`Ранг выше ${window.EgoCore.rankName(slot.maxRank)}`);
    if (window.EgoCore.spent(e) > window.EgoCore.maxPoints(e)) reasons.push('Превышен бюджет очков');
    return { key: e.id, title: e.name || 'Э.Г.О. без названия', sub: window.EgoCore.metaLine(e), ego: e, ok: !reasons.length, reasons };
  });
  const top = `<div class="ego-top"><button class="btn-mini accent" id="ego-new"><i class="fa-solid fa-wand-magic-sparkles"></i> ${esc(T('Сконструировать новое Э.Г.О.'))}</button>
    ${slot.entry ? `<button class="btn-mini" id="ego-edit"><i class="fa-solid fa-pen"></i> ${esc(T('Редактировать текущее'))}</button>` : ''}
    <a class="btn-mini" href="egobuilder.html" target="_blank" rel="noopener">${esc(T('Открыть Конструктор Э.Г.О.'))}</a></div>
    ${lib.length ? '' : `<div class="hint">${esc(T('Библиотека Э.Г.О. пуста — создайте новое здесь или в Конструкторе Э.Г.О.'))}</div>`}`;
  openPicker(slot.label, items, (it) => { closeModal(); setSlot(slot.id, { t: 'ego', ego: it.ego }); }, { color: CAT.ego.color, top });
  MODAL.slotId = slot.id;
}

function openEgoEditor(slot, ego, onSave) {
  const start = ego ? window.EgoCore.normalize(ego) : window.EgoCore.blank(slot.egoKind);
  if (!ego && slot.egoKind === 'eff' && slot.egoForm === 'volatile') { start.effType = 'pb'; start.pb = R.pb; }
  openModal(slot.label, `<div class="ego-edit"><div id="ego-form-box"></div><div class="ego-prev" id="ego-prev"></div></div>
    <div class="modal-actions"><button class="btn-mini accent" id="ego-save"><i class="fa-solid fa-check"></i> ${esc(T('Поместить в слот и сохранить в библиотеку'))}</button></div>`, CAT.ego.color);
  const prev = (e) => { $('ego-prev').innerHTML = `<div class="ego-prev-name">${esc(e.name || T('БЕЗ НАЗВАНИЯ'))}</div><div class="need">${esc(window.EgoCore.metaLine(e))}</div>${window.EgoCore.summaryHtml(e)}`; };
  const form = window.EgoCore.mount($('ego-form-box'), start, { onChange: prev, maxRank: slot.maxRank || 8, lockKind: true });
  prev(form.get());
  $('ego-save').onclick = () => {
    const e = form.get();
    if (!e.name.trim()) { toast('Дайте Э.Г.О. название'); return; }
    window.EgoCore.library.save(e);
    closeModal();
    if (onSave) onSave(e); else setSlot(slot.id, { t: 'ego', ego: e });
  };
}

function openDetail(slot) {
  const d = slotDisplay(slot);
  const cat = CAT[slot.cat];
  const cps = slotChoices(slot);
  const html = `<div class="detail-sub" style="color:${cat.color}">${esc(cat.label)} · ${esc(slot.label)}${slot.level > 1 ? ` · ${esc(T('ур.'))} ${slot.level}` : ''}</div>
    ${cps.length ? `<div class="detail-choices">${choiceControls(cps)}</div>` : ''}
    <div class="detail-body">${slotDesc(slot)}</div>
    <div class="modal-actions">
      <button class="btn-mini accent" data-repick="${esc(slot.id)}"><i class="fa-solid fa-arrows-rotate"></i> ${esc(T('Заменить'))}</button>
      ${slot.kind === 'ego' && slot.entry ? `<button class="btn-mini" data-egoedit="${esc(slot.id)}"><i class="fa-solid fa-pen"></i> ${esc(T('Редактировать Э.Г.О.'))}</button>` : ''}
      ${slot.kind !== 'race' && slot.kind !== 'arch' ? `<button class="btn-mini red" data-clear="${esc(slot.id)}"><i class="fa-solid fa-xmark"></i> ${esc(T('Убрать'))}</button>` : ''}
    </div>`;
  MODAL.detail = { type: 'slot', id: slot.id };
  openModal(d.name || slot.label, html, cat.color);
}

function openGrantedDetail(key) {
  const rec = R.feats.find((r) => r.ctx.key === key);
  if (!rec) return;
  const cps = choicesUnder(key);
  MODAL.detail = { type: 'granted', key };
  openModal(rec.entry.data.Name, `<div class="detail-sub" style="color:${CAT.feat.color}">${esc(T('Черта'))} · ${esc(T('от:'))} ${esc(plain(rec.ctx.grantedBy?.label || ''))}</div>
    ${cps.length ? `<div class="detail-choices">${choiceControls(cps)}</div>` : ''}
    <div class="detail-body">${entryHtml(rec.entry, rec.req)}</div>`, CAT.feat.color);
}

function openExtraDetail(id) {
  const x = S.extras.find((e) => e.id === id);
  if (!x) return;
  const e = xe(x).entry;
  const key = `X[${x.id}]`;
  const cps = choicesUnder(key);
  // свободные подходящие слоты, куда объект можно перенести
  const targets = R.slots.filter((s) => !slotDisplay(s).filled && (
    (s.kind === 'feat' && e?.t === 'feat' && featFits(s, e)) ||
    (s.kind === 'gear' && e?.t === 'equip' && gearFits(s, e)) ||
    (s.kind === 'ego' && e?.t === 'ego' && e.ego?.kind === s.egoKind)));
  MODAL.detail = { type: 'extra', id };
  openModal(entryName(e), `<div class="detail-sub">${esc(T('Вне слотов'))}</div>
    <div class="row-why">${(xe(x).why || []).map((w) => `<div>⚠ ${esc(w)}</div>`).join('')}</div>
    ${cps.length ? `<div class="detail-choices">${choiceControls(cps)}</div>` : ''}
    <div class="detail-body">${e ? entryHtml(e) : ''}</div>
    <div class="modal-actions">
      ${targets.length ? `<select class="cloud-select small" id="move-target">${targets.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}${s.level > 1 ? ` (${T('ур.')} ${s.level})` : ''}</option>`).join('')}</select><button class="btn-mini accent" data-move="${esc(id)}">${esc(T('Перенести в слот'))}</button>` : ''}
      ${e?.t === 'ego' ? `<button class="btn-mini" data-egoextra="${esc(id)}"><i class="fa-solid fa-pen"></i> ${esc(T('Редактировать Э.Г.О.'))}</button>` : ''}
      <button class="btn-mini red" data-rmextra="${esc(id)}"><i class="fa-solid fa-xmark"></i> ${esc(T('Убрать'))}</button>
    </div>`);
}

function openAddExtra(tab = 'feat') {
  const tabs = [['feat', 'Черты'], ['equip', 'Снаряжение'], ['gift', 'Дары Э.Г.О.'], ['ego', 'Э.Г.О. (библиотека)'], ['text', 'Своё']];
  const tabBar = `<div class="tabs-mini">${tabs.map(([k, l]) => `<button class="seg ${k === tab ? 'on' : ''}" data-xtab="${k}">${esc(T(l))}</button>`).join('')}</div>
    <div class="hint">${esc(T('Объекты вне слотов выходят за рамки правил: они учитываются в расчётах, но остаются на усмотрение ДМ-а.'))}</div>`;
  let items = [];
  if (tab === 'feat') items = featItems(() => true, false, null).map((i) => ({ ...i, ok: true }));
  if (tab === 'equip') items = equipItems(() => true).map((i) => ({ ...i, ok: true }));
  if (tab === 'gift') items = DB.gifts.map((g) => ({ key: g.key, title: g.data.Name, sub: `${T('Уровень')} ${g.data.Level} · ${(g.data.Type || []).join(', ')}`, desc: g.data.Description, entry: g, ok: true, custom: isCustom(g), reasons: isCustom(g) ? ['Пользовательский объект — на усмотрение ДМ-а'] : [] }))
    .sort((a, b) => Number(a.entry.data.Level) - Number(b.entry.data.Level));
  if (tab === 'ego') items = window.EgoCore.library.list().map((e) => ({ key: e.id, title: e.name || 'Э.Г.О. без названия', sub: window.EgoCore.metaLine(e), ego: e, ok: true }));
  if (tab === 'text') {
    MODAL.xtab = tab;
    openModal('Добавить вне слотов', tabBar + `
      <div class="form-group"><label>Название</label><input class="cloud-input" id="own-name" maxlength="120"></div>
      <div class="form-group"><label>Категория</label><select class="cloud-select" id="own-cat">${Object.entries(CAT).filter(([k]) => ['gear', 'feat', 'ego', 'gift', 'text'].includes(k)).map(([k, c]) => `<option value="${k}">${esc(c.label)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Описание</label><textarea class="cloud-input" id="own-desc" rows="6" maxlength="6000"></textarea></div>
      <div class="modal-actions"><button class="btn-mini accent" id="own-add">${esc(T('Добавить'))}</button></div>`);
    $('own-add').onclick = () => {
      const name = $('own-name').value.trim();
      if (!name) { toast('Введите название'); return; }
      closeModal();
      addExtra({ t: 'text', key: `t:${uid()}`, name, desc: $('own-desc').value, cat: $('own-cat').value });
    };
    return;
  }
  MODAL.xtab = tab;
  openPicker('Добавить вне слотов', items, (it) => {
    closeModal();
    if (it.ego) addExtra({ t: 'ego', ego: it.ego });
    else addExtra(makeRef(it.entry));
  }, { top: tabBar });
}

function openPending() {
  const list = R.choices.filter((c) => c.pending);
  const slots = R.slots.filter((s) => s.pendingFlag);
  openModal('Нерешённые выборы', (list.length ? `<div class="detail-choices">${choiceControls(list)}</div>` : '') +
    slots.map((s) => `<div class="cp cp-pending"><div class="cp-label">${esc(s.label)} · ${esc(T('ур.'))} ${s.level}</div><button class="btn-mini" data-open-slot="${esc(s.id)}">${esc(T('Исправить'))}</button></div>`).join('') +
    (!list.length && !slots.length ? `<div class="row-empty">${esc(T('Все выборы сделаны'))}</div>` : ''));
  MODAL.detail = { type: 'pending' };
}

function openLink(target) {
  const t = lower(target);
  const feat = DB.feats.find((f) => lower(f.data.Name) === t);
  if (feat) { openModal(feat.data.Name, entryHtml(feat, featReq(R, feat, null)), CAT.feat.color); return; }
  const st = DB.statuses.find((s) => lower(s.Name) === t);
  if (st) {
    openModal(st.Name, `<div class="md">${md(st.Effect)}</div>${(st.SideEffects || []).map((se) => `<div class="status-se"><b>${esc(se.sideeffectname)}</b><div class="md">${md(se.sideeffect)}</div></div>`).join('')}`, '#45B3CB');
    return;
  }
  for (const k of ['fixer', 'bloodfiend']) {
    const tal = (DB.baseData[k].Talents || []).find((x) => lower(x.name) === t);
    if (tal) { openModal(tal.name, `<div class="md">${md(tal.desc)}</div>`, '#45B3CB'); return; }
  }
  const arch = DB.archs.find((a) => lower(a.data.Name) === t);
  if (arch) { openModal(arch.data.Name, entryHtml(arch), CAT.arch.color); return; }
  toast(`«${target}» — смотрите в Базе знаний`);
}

function refreshModal() {
  const d = MODAL.detail;
  if ($('modal').hidden || !d) return;
  if (d.type === 'slot') { const s = R.slotById.get(d.id); if (s && slotDisplay(s).filled) openDetail(s); }
  else if (d.type === 'granted') openGrantedDetail(d.key);
  else if (d.type === 'extra') openExtraDetail(d.id);
  else if (d.type === 'pending') openPending();
}

/* =====================================================================
   ПРЕСЕТЫ
   ===================================================================== */
function exportPreset() {
  const customUsed = [R.arch, ...R.slots.map((s) => s.entry), ...S.extras.map((x) => xe(x).entry)].some(isCustom) || S.extras.length;
  if (customUsed && !confirm(T('В персонаже есть пользовательские объекты или объекты вне слотов. Они сохранятся в пресете с пометкой «на усмотрение ДМ-а». Продолжить?'))) return;
  const preset = {
    format: 'sinner-sheet.character', version: 2,
    characterName: S.name, race: R.race ? R.race.name : '', className: R.arch ? entryName(R.arch) : R.base.name,
    desc: S.desc, feats: R.feats.map((r) => r.entry.data.Name), level: R.L,
    stats: R.stats, hp: R.hp, sp: S.opts.sanity ? R.sp : undefined,
    dmReview: customUsed ? true : undefined,
    builder: clone(S),
  };
  const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (S.name || 'Character').replace(/[\\/:*?"<>|]+/g, '_') + '_preset.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importPreset(p) {
  if (p && p.builder && p.builder.v === 2) {
    S = Object.assign(blankState(), p.builder);
  } else if (p && (p.characterName != null || p.feats)) {
    // пресет старого конструктора
    S = blankState();
    S.name = p.characterName || '';
    S.desc = p.desc || p.description || '';
    S.race = { human: 'human', bloodfiend: 'bloodfiend', half_distortion: 'half_distortion' }[p.race] || DB.races.find((r) => lower(r.name) === lower(p.race))?.id || '';
    const arch = DB.archs.find((a) => lower(a.data.Name) === lower(p.className));
    if (arch) { S.base = arch.base === 'bloodfiend' ? 'bloodfiend' : 'fixer'; S.arch = makeRef(arch); }
    (p.feats || []).forEach((n) => {
      const f = DB.feats.find((x) => lower(x.data.Name) === lower(typeof n === 'string' ? n : n?.Name));
      if (f) S.extras.push({ id: uid(), ref: makeRef(f) });
    });
    if (S.extras.length) setTimeout(() => toast('Черты из старого пресета добавлены вне слотов — перенесите их в слоты'), 300);
  } else throw new Error('bad preset');
  renderAll();
}

function readFile(ev, cb) {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try { cb(JSON.parse(r.result)); } catch (e) { console.error(e); alert(T('Ошибка чтения JSON файла.')); }
  };
  r.readAsText(file);
}

function importCustomJson(data) {
  const list = Array.isArray(data) ? data : [data];
  let n = 0, egos = 0;
  list.forEach((o) => {
    const type = detectType(o);
    if (type === 'ego') { window.EgoCore.library.save(o); egos++; }
    else if (type) { saveUpload(type, o); n++; }
  });
  if (!n && !egos) { alert(T('Не удалось распознать объект: ожидается класс, черта, предмет, дар или Э.Г.О.')); return; }
  renderAll();
  alert(`${T('Загружено объектов:')} ${n + egos}. ${T('Они помечены как пользовательские — на усмотрение ДМ-а.')}`);
}

/* =====================================================================
   СОБЫТИЯ
   ===================================================================== */
function bind() {
  $('char-name').addEventListener('input', (e) => { S.name = e.target.value.slice(0, 120); renderDossier(); saveState(); });
  $('char-desc').addEventListener('input', (e) => { S.desc = e.target.value.slice(0, 8000); renderDossier(); saveState(); });
  $('char-level').addEventListener('change', (e) => {
    const v = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1));
    if (v === S.level) { e.target.value = v; return; }
    S.level = v;
    renderAll();
  });
  $('char-race').addEventListener('change', (e) => { S.race = e.target.value; renderAll(); });
  $('char-base').addEventListener('change', (e) => {
    S.base = e.target.value;
    const a = resolve(S.arch);
    if (a && a.base !== S.base && a.base !== 'any') S.arch = null;
    renderAll();
  });
  $('char-arch').addEventListener('change', (e) => { const a = DB.archByKey.get(e.target.value); S.arch = a ? makeRef(a) : null; renderAll(); });
  $('opt-durability').addEventListener('change', (e) => { S.opts.durability = e.target.checked; S.hp.rolls = {}; renderAll(); });
  $('opt-sanity').addEventListener('change', (e) => { S.opts.sanity = e.target.checked; renderAll(); });
  $('lvl-up').addEventListener('click', () => { S.level = Math.min(20, R.L + 1); renderAll(); });
  $('lvl-down').addEventListener('click', () => { S.level = Math.max(1, R.L - 1); renderAll(); });

  $('preset-in').addEventListener('change', (ev) => readFile(ev, (p) => {
    try { importPreset(p); alert(T('Пресет успешно загружен!')); } catch (e) { alert(T('Ошибка чтения файла пресета.')); }
  }));
  $('custom-in').addEventListener('change', (ev) => readFile(ev, importCustomJson));
  $('btn-export').addEventListener('click', exportPreset);
  $('btn-copy').addEventListener('click', () => {
    navigator.clipboard.writeText($('output-area').innerText).then(() => alert(T('Досье скопировано в буфер обмена!'))).catch((e) => console.error(e));
  });
  $('btn-new').addEventListener('click', () => { if (confirm(T('Начать нового персонажа? Текущий будет сброшен (скачайте пресет, если он нужен).'))) { S = blankState(); renderAll(); } });
  $('pending-btn').addEventListener('click', openPending);
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    VIEW = b.dataset.view;
    try { localStorage.setItem(LS_VIEW, VIEW); } catch (e) { /* приватный режим */ }
    hidePop();
    renderAll();
  }));

  // характеристики
  $('stats-panel').addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'stat-method') {
      S.stats.method = t.value;
      if (t.value === 'pointbuy') STATS.forEach((k) => { S.stats.base[k] = Math.max(8, Math.min(15, Number(S.stats.base[k]) || 8)); });
      if (t.value === 'array') { S.stats.assign = {}; STATS.forEach((k, i) => { S.stats.assign[k] = i; }); }
      if (t.value === 'roll' && !S.stats.pool.length) { rollStats(); return; }
      if (t.value === 'roll') { S.stats.assign = {}; STATS.forEach((k, i) => { S.stats.assign[k] = i; }); }
      if (t.value === 'manual') STATS.forEach((k) => { S.stats.base[k] = R.baseStats[k]; });
      renderAll();
    } else if (t.dataset.assign) {
      S.stats.assign[t.dataset.assign] = t.value === '' ? undefined : Number(t.value);
      renderAll();
    } else if (t.dataset.base) {
      S.stats.base[t.dataset.base] = Number(t.value);
      renderAll();
    }
  });
  $('stats-panel').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.step) {
      const k = t.dataset.step;
      const [lo, hi] = S.stats.method === 'pointbuy' ? [8, 15] : [1, 30];
      S.stats.base[k] = Math.max(lo, Math.min(hi, (Number(S.stats.base[k]) || 8) + Number(t.dataset.d)));
      renderAll();
    } else if (t.dataset.act === 'roll-stats') rollStats();
    else if (t.dataset.act === 'roll-hp') rollHp('hp');
    else if (t.dataset.act === 'roll-sp') rollHp('sp');
    else if (t.dataset.act === 'clear-hp') { S.hp.rolls = {}; renderAll(); }
    else if (t.dataset.act === 'clear-sp') { S.sp.rolls = {}; renderAll(); }
    else if (t.dataset.hpmode) { S[t.dataset.hpmode].mode = t.dataset.mode; renderAll(); }
    else if (t.dataset.reroll) rollHp(t.dataset.reroll, Number(t.dataset.lv));
  });

  // слоты, объекты вне слотов, выборы — общий обработчик кликов
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (POP.host && !t.closest('#choice-pop') && !POP.host.contains(t)) hidePop();
    const lnk = t.closest('.lnk');
    if (lnk) { e.stopPropagation(); openLink(lnk.dataset.link); return; }
    const cp = t.closest('[data-cp]');
    if (cp) { handleChoiceClick(cp); refreshModal(); return; }
    const cpf = t.closest('[data-cp-feat]');
    if (cpf) {
      const key = cpf.dataset.cpFeat;
      openPicker('Черта на выбор', featItems(() => true, false, null), (it) => { closeModal(); setChoice(key, isCustom(it.entry) ? makeRef(it.entry) : it.entry.key); });
      return;
    }
    if (t.closest('[data-pick-extra]')) {
      const it = MODAL.items[Number(t.closest('[data-pick-extra]').dataset.pickExtra)];
      closeModal();
      addExtra(it.ego ? { t: 'ego', ego: it.ego } : makeRef(it.entry));
      return;
    }
    const pick = t.closest('[data-pick]');
    if (pick && !t.closest('details') && MODAL.onPick) {
      const it = MODAL.items[Number(pick.dataset.pick)];
      if (it.ok) MODAL.onPick(it); else toast('Недоступно по правилам — можно добавить вне слотов');
      return;
    }
    if (t.closest('#picker-all')) { MODAL.showAll = t.closest('#picker-all').checked; renderPicker(); return; }
    if (t.closest('[data-xtab]')) { openAddExtra(t.closest('[data-xtab]').dataset.xtab); return; }
    if (t.closest('#gear-own')) {
      const slotId = MODAL.slotId;
      const name = prompt(T('Название предмета мастерской:'));
      if (!name) return;
      const desc = prompt(T('Краткое описание (модификации, урон, свойства):')) || '';
      closeModal();
      setSlot(slotId, { t: 'text', key: `t:${uid()}`, name: name.slice(0, 120), desc: desc.slice(0, 4000), cat: 'gear' });
      return;
    }
    if (t.closest('#ego-new')) { const s = R.slotById.get(MODAL.slotId); openEgoEditor(s, null); return; }
    if (t.closest('#ego-edit')) { const s = R.slotById.get(MODAL.slotId); openEgoEditor(s, s.entry?.ego); return; }
    if (t.closest('[data-egoedit]')) { const s = R.slotById.get(t.closest('[data-egoedit]').dataset.egoedit); openEgoEditor(s, s.entry?.ego); return; }
    if (t.closest('[data-egoextra]')) {
      const x = S.extras.find((y) => y.id === t.closest('[data-egoextra]').dataset.egoextra);
      if (!x) return;
      openEgoEditor({ label: 'Э.Г.О. вне слотов', egoKind: x.ref.ego.kind, maxRank: 8 }, x.ref.ego, (e) => { x.ref.ego = e; renderAll(); });
      return;
    }
    if (t.closest('[data-repick]')) { const s = R.slotById.get(t.closest('[data-repick]').dataset.repick); closeModal(); openSlotPicker(s); return; }
    if (t.closest('[data-clear]')) { const id = t.closest('[data-clear]').dataset.clear; closeModal(); setSlot(id, null); return; }
    if (t.closest('[data-rmextra]')) { const id = t.closest('[data-rmextra]').dataset.rmextra; S.extras = S.extras.filter((x) => x.id !== id); closeModal(); renderAll(); return; }
    if (t.closest('[data-move]')) {
      const id = t.closest('[data-move]').dataset.move;
      const x = S.extras.find((y) => y.id === id);
      const target = $('move-target').value;
      const slot = R.slotById.get(target);
      S.extras = S.extras.filter((y) => y.id !== id);
      S.slots[target] = slot.kind === 'asi' ? { mode: 'feat', ref: x.ref } : x.ref;
      closeModal(); renderAll(); return;
    }
    if (t.closest('[data-open-slot]')) { const s = R.slotById.get(t.closest('[data-open-slot]').dataset.openSlot); closeModal(); openSlotPicker(s); return; }
    if (t.closest('[data-open]')) { const s = R.slotById.get(t.closest('[data-open]').dataset.open); openSlotPicker(s); return; }
    if (t.closest('[data-act="add-extra"]')) { openAddExtra(); return; }
    if (t.closest('.badge-pend')) {
      const host = t.closest('[data-choices],[data-choices-key]');
      if (host) { showPop(host); return; }
    }
    if (t.closest('#modal-close') || t.id === 'modal') { closeModal(); return; }
    const rd = t.closest('.row-desc');
    if (rd && !t.closest('a,button,summary')) { rd.classList.toggle('open'); return; }
    if (t.closest('#choice-pop')) return;
    const slotEl = t.closest('[data-slot]');
    if (slotEl && !t.closest('button') && !t.closest('select') && !t.closest('a')) {
      if (VIEW === 'rows') return;
      openSlot(slotEl.dataset.slot); return;
    }
    const gr = t.closest('[data-granted]');
    if (gr && VIEW === 'cubes') { openGrantedDetail(gr.dataset.granted); return; }
    const ex = t.closest('[data-extra]');
    if (ex && !t.closest('button')) { openExtraDetail(ex.dataset.extra); return; }
    const entry = t.closest('[data-copy]');
    if (entry && !t.closest('details')) copyEntry(entry);
  });
  document.addEventListener('change', (e) => {
    const c = e.target.closest('[data-cp-class]');
    if (c) { setChoice(c.dataset.cpClass, c.value || null); refreshModal(); }
  });
  document.addEventListener('input', (e) => { if (e.target.id === 'picker-q') renderPicker(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!$('modal').hidden) closeModal(); hidePop(); }
    if (e.key === 'Enter' && e.target.matches?.('.slot[tabindex]')) e.target.click();
  });

  // всплывающая подсказка выбора при наведении
  document.addEventListener('mouseover', (e) => {
    const pop = $('choice-pop');
    if (pop.contains(e.target)) { clearTimeout(POP.timer); return; }
    const host = e.target.closest('[data-choices],[data-choices-key]');
    if (host) { clearTimeout(POP.timer); if (POP.host !== host) showPop(host); }
  });
  document.addEventListener('mouseout', (e) => {
    const to = e.relatedTarget;
    if (to && (to.closest?.('#choice-pop') || (POP.host && POP.host.contains(to)))) return;
    if (!POP.host) return;
    clearTimeout(POP.timer);
    POP.timer = setTimeout(hidePop, 350);
  });
  window.addEventListener('scroll', () => {
    if (!POP.host) return;
    const r = POP.host.getBoundingClientRect();
    if (document.body.contains(POP.host) && r.bottom > 0 && r.top < window.innerHeight) showPop(POP.host); else hidePop();
  }, { passive: true });

  // подсказки data-tip
  const tip = $('tip');
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el || !el.getAttribute('data-tip')) { tip.hidden = true; return; }
    tip.textContent = el.getAttribute('data-tip');
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = Math.min(320, window.innerWidth - 16);
    tip.style.maxWidth = w + 'px';
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
    const below = r.bottom + 6;
    tip.style.top = (below + 80 > window.innerHeight ? Math.max(8, r.top - tip.offsetHeight - 6) : below) + 'px';
  });
}

function copyEntry(el) {
  const text = el.innerText.replace(/\n?Скопировано!\s*$/, '');
  navigator.clipboard.writeText(text).then(() => {
    const m = el.querySelector('.copy-msg');
    if (m) { m.style.opacity = '1'; setTimeout(() => { m.style.opacity = '0'; }, 1500); }
  }).catch((e) => console.error(e));
}

/* ---------------- старт ---------------- */
async function start() {
  loadState();
  bind();
  $('slots').innerHTML = `<div class="row-empty">${esc(T('Загрузка базы данных...'))}</div>`;
  await loadData();
  renderAll();
  loadCustom();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
