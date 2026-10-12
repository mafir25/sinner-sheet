import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  prepMarkdown, parseMeta, parseSpeed, parseSenses, parseSaves, parseSkills, parseCR,
  featItem, giftItem, equipmentItem, talentItems, journalEntry, bestiaryActor,
  buildPackage, packageSize, importDataJson, foundryMacro, canExport, FORMAT,
} from '../../site/foundry-export.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../Assets/${f}`, import.meta.url), 'utf8'));
const opts = { origin: 'https://site.test', now: '2026-10-12T00:00:00.000Z' };
const ref = (cat, key) => ({ cat, key, url: `https://site.test/navigation.html#${cat}/${key}` });

describe('prepMarkdown', () => {
  it('автоссылки — жирным текстом, калькуляторы убираются', () => {
    expect(prepMarkdown('накладывает 5 `Потопления::Потопление` и `Горение` [calc:x]'))
      .toBe('накладывает 5 **Потопления** и **Горение** ');
  });
  it('картинки — абсолютным адресом сайта', () => {
    expect(prepMarkdown('[Assets/Icons/Burn.png W:24]', 'https://site.test'))
      .toBe('<img src="https://site.test/Assets/Icons/Burn.png" alt="" width="24">');
    expect(prepMarkdown('[https://cdn.test/a.webp]', 'https://site.test')).toBe('<img src="https://cdn.test/a.webp" alt="">');
  });
});

describe('разбор стат-блока', () => {
  it('размер, тип и мировоззрение', () => {
    expect(parseMeta('Огромное чудовище, без мировоззрения')).toMatchObject({ size: 'huge', tokenSize: 3, type: 'monstrosity', alignment: 'без мировоззрения' });
    expect(parseMeta('Средняя нежить, хаотично-злая')).toMatchObject({ size: 'med', type: 'undead' });
    expect(parseMeta('Medium humanoid, chaotic')).toMatchObject({ size: 'med', type: 'humanoid', alignment: 'chaotic' });
    expect(parseMeta('Большой искажённый, злой')).toMatchObject({ size: 'lg', type: '', custom: 'искажённый' });
  });
  it('скорость', () => {
    expect(parseSpeed('30 фт., лазая 30 фт., летая 60 фт.')).toEqual({ units: 'ft', walk: 30, climb: 30, fly: 60 });
    expect(parseSpeed('летая 30 фт.')).toEqual({ units: 'ft', walk: 0, fly: 30 });
    expect(parseSpeed('25 фт., 35 фт. на 6-м уровне призывателя')).toEqual({ units: 'ft', walk: 25 });
    expect(parseSpeed('fly 30 ft.')).toEqual({ units: 'ft', walk: 0, fly: 30 });
  });
  it('чувства: дистанции, пассивная внимательность не нужна', () => {
    expect(parseSenses('тёмное зрение 120 фт., чувство вибрации 120 фт., пассивная Внимательность 20'))
      .toEqual({ ranges: { darkvision: 120, tremorsense: 120 }, special: '' });
    expect(parseSenses('darkvision 60 ft., passive Perception 16')).toEqual({ ranges: { darkvision: 60 }, special: '' });
    expect(parseSenses('видит невидимое, пассивная Внимательность 9')).toEqual({ ranges: {}, special: 'видит невидимое' });
  });
  it('спасброски и навыки (компетентность — по двойному бонусу)', () => {
    expect(parseSaves('Сил +6, Тел +7')).toEqual(['str', 'con']);
    expect(parseSaves('Str +6, Cha +8')).toEqual(['str', 'cha']);
    expect(parseSaves(undefined)).toEqual([]);
    const scores = { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 20 };
    expect(parseSkills('Внимательность +6, Обман +12, Непонятное +3', scores, 3)).toEqual({ prc: 1, dec: 2 });
    expect(parseSkills('Perception +6', scores, 3)).toEqual({ prc: 1 });
  });
  it('опасность', () => {
    expect(parseCR('5 (1 800 опыта)')).toBe(5);
    expect(parseCR('1/4')).toBe(0.25);
    expect(parseCR('?')).toBeNull();
  });
});

describe('документы Foundry', () => {
  it('черта', () => {
    const d = featItem({ Name: 'Тест', Need: 'Сил 13', Base: ['Body'], desc: 'Текст' }, ref('feats', 'Тест'), opts);
    expect(d).toMatchObject({ name: 'Тест', type: 'feat', system: { requirements: 'Сил 13', type: { value: 'feat' } } });
    expect(d.system.description.value).toContain('<p>Текст</p>');
    expect(d.system.description.value).toContain('https://site.test/navigation.html#feats/Тест');
    expect(d.flags.pm5e).toMatchObject({ key: 'feats/Тест', cat: 'feats', base: ['Body'] });
  });
  it('гифт — уровень в требованиях', () => {
    const d = giftItem({ Name: 'Г', Level: 2, Type: ['Charge'], Description: 'x' }, ref('gifts', 'Г'), opts);
    expect(d.system.requirements).toBe('Э.Г.О. гифт, уровень II');
    expect(d.flags.pm5e).toMatchObject({ gift: true, level: 2 });
  });
  it('снаряжение: тип и редкость', () => {
    expect(equipmentItem({ Name: 'М', ItemType: 'Weapon', Rarity: 'Very Rare', Level: 3, Desc: 'x' }, ref('equipment', 'М'), opts))
      .toMatchObject({ type: 'weapon', system: { rarity: 'veryRare' } });
    expect(equipmentItem({ Name: 'Б', ItemType: 'Armor', Rarity: 'Rare' }, ref('equipment', 'Б'), opts).type).toBe('equipment');
    expect(equipmentItem({ Name: 'Ч', ItemType: 'Mod' }, ref('equipment', 'Ч'), opts).system.type).toEqual({ value: 'trinket' });
  });
  it('архетип — описание и способности в папке архетипа, у каждой свой ключ', () => {
    const list = talentItems({ Name: 'Арх', Desc: 'о', Talents: [{ name: 'А', level: 3, desc: 'а' }, { name: 'Б', level: 6, desc: 'б' }] },
      ref('classes', 'Арх'), opts);
    expect(list.map((d) => d.name)).toEqual(['Арх', 'А', 'Б']);
    expect(list.every((d) => d._folder === 'Арх' && d.system.type.value === 'class')).toBe(true);
    expect(list[1].system.requirements).toBe('Арх, ур. 3');
    expect(new Set(list.map((d) => d.flags.pm5e.key)).size).toBe(3);
  });
  it('правила и лор — журнал со страницами', () => {
    const j = journalEntry({ Name: 'П', Intro: 'вступление', Blocks: [{ Title: 'Б1', Body: 'т' }, { Title: 'Б2', Date: '1', Body: 'т' }] }, ref('rules', 'П'), opts);
    expect(j.pages.map((p) => p.name)).toEqual(['П', 'Б1', 'Б2 · 1']);
    expect(j.pages[0].text.format).toBe(1);
  });
  it('каждое существо бестиария (RU и EN) становится актёром npc', () => {
    for (const lang of ['Rus', 'Eng']) {
      for (const it of load(`${lang}/world/bestiary.json`)) {
        const a = bestiaryActor(it, ref('bestiary', it.Name), opts);
        expect(a.type).toBe('npc');
        expect(a.name).toBe(it.Name);
        expect(Object.keys(a.system.abilities)).toEqual(['str', 'dex', 'con', 'int', 'wis', 'cha']);
        expect(a.items.every((i) => i.type === 'feat' && i.system.type.value === 'monster')).toBe(true);
      }
    }
  });
  it('рыдающая жаба: числа из стат-блока', () => {
    const toad = load('Rus/world/bestiary.json').find((x) => x.Name === 'Рыдающая жаба');
    const a = bestiaryActor(toad, ref('bestiary', toad.Name), opts);
    expect(a.system.abilities.str).toEqual({ value: 16, proficient: 1 });
    expect(a.system.abilities.dex).toEqual({ value: 9 });
    expect(a.system.attributes.ac).toEqual({ calc: 'flat', flat: 16 });
    expect(a.system.attributes.hp).toEqual({ value: 126, max: 126, formula: '12d12+48' });
    expect(a.system.attributes.movement.walk).toBe(30);
    expect(a.system.attributes.senses.darkvision).toBe(60);
    expect(a.system.details.cr).toBe(5);
    expect(a.system.traits.size).toBe('huge');
    expect(a.system.skills).toEqual({ prc: { value: 1 } });
    expect(a.prototypeToken).toMatchObject({ width: 3, height: 3, disposition: -1 });
    const slap = a.items.find((i) => i.name === 'Плачущая оплеуха');
    expect(slap.system.activation).toEqual({ type: 'action', cost: 1 });
    expect(slap.system.description.value).toContain('<strong>Потопления</strong>');
  });
});

describe('пакет и макрос', () => {
  const entries = [
    { cat: 'feats', it: { Name: 'Ч', desc: 'x' }, ref: { key: 'Ч' } },
    { cat: 'classes', it: { Name: 'Арх', Talents: [{ name: 'А', level: 1, desc: 'а' }] }, ref: { key: 'Арх' } },
    { cat: 'bestiary', it: { Name: 'Жаба', Stats: {}, Actions: [{ name: 'Удар', desc: 'бьёт' }] }, ref: { key: 'Жаба' } },
    { cat: 'lore', it: { Name: 'Л', Intro: 'и' }, ref: { key: 'Л' } },
    { cat: 'statuses', it: { Name: 'Горение' }, ref: { key: 'Горение' } },
  ];
  const folders = { feats: 'Черты', classes: 'Архетипы', bestiary: 'Бестиарий', lore: 'Лор' };
  const pkg = buildPackage(entries, { ...opts, folders });

  it('раскладывает по видам документов и папкам; статусы не экспортируются', () => {
    expect(pkg.format).toBe(FORMAT);
    expect(canExport('statuses')).toBe(false);
    expect(packageSize(pkg)).toBe(4);
    expect(pkg.items.map((d) => d._folder)).toEqual(['Черты', 'Архетипы/Арх']);
    expect(pkg.actors[0]._folder).toBe('Бестиарий');
    expect(importDataJson(pkg.items[0])).not.toHaveProperty('_folder');
  });

  /** Мини-имитация Foundry: коллекции, папки, создание и обновление документов. */
  function fakeFoundry() {
    let id = 0;
    const log = { notes: [] };
    const make = (store, extra = {}) => class {
      static async create(data) { const d = new this(data); store.push(d); return d; }
      constructor(data) {
        Object.assign(this, structuredClone(data), extra); this.id = String(++id);
        this.items = (data.items || []).map((x) => ({ ...x, id: String(++id) }));
        this.pages = (data.pages || []).map((x) => ({ ...x, id: String(++id) }));
      }
      async update(data) { Object.assign(this, structuredClone(data)); }
      async deleteEmbeddedDocuments(type, ids) { const k = type === 'Item' ? 'items' : 'pages'; this[k] = this[k].filter((x) => !ids.includes(x.id)); }
      async createEmbeddedDocuments(type, list) { const k = type === 'Item' ? 'items' : 'pages'; this[k].push(...list.map((x) => ({ ...x, id: String(++id) }))); }
    };
    const stores = { folders: [], items: [], actors: [], journal: [] };
    const Folder = make(stores.folders);
    const Folder2 = class extends Folder { static async create(data) { const f = await super.create(data); f.folder = data.folder ? stores.folders.find((x) => x.id === data.folder) : null; return f; } };
    const g = {
      game: { user: { isGM: true }, folders: stores.folders, items: stores.items, actors: stores.actors, journal: stores.journal },
      ui: { notifications: { info: (m) => log.notes.push(m), warn: (m) => log.notes.push(m), error: (m) => log.notes.push(m) } },
      Folder: Folder2, Item: make(stores.items), Actor: make(stores.actors), JournalEntry: make(stores.journal),
      console: { error: (e) => log.notes.push(String(e)) },
    };
    return { g, stores, log };
  }
  async function run(code, g) {
    const AsyncFunction = (async () => {}).constructor;
    await new AsyncFunction(...Object.keys(g), code)(...Object.values(g));
  }

  it('макрос в Foundry создаёт документы в папках, повторный запуск обновляет', async () => {
    const code = foundryMacro(pkg);
    const { g, stores, log } = fakeFoundry();
    await run(code, g);
    expect(log.notes).toEqual(['Mephistopheles Terminal: создано 4, обновлено 0.']);
    expect(stores.items.map((d) => d.name)).toEqual(['Ч', 'А']);
    const folderOf = (d) => { const p = []; for (let f = stores.folders.find((x) => x.id === d.folder); f; f = f.folder) p.unshift(f.name); return p.join('/'); };
    expect(folderOf(stores.items[1])).toBe('Mephistopheles Terminal/Архетипы/Арх');
    expect(folderOf(stores.actors[0])).toBe('Mephistopheles Terminal/Бестиарий');
    expect(stores.actors[0].items.map((i) => i.name)).toEqual(['Удар']);

    stores.actors[0].items.push({ id: 'old', name: 'Лишнее' });
    await run(code, g);
    expect(log.notes[1]).toBe('Mephistopheles Terminal: создано 0, обновлено 4.');
    expect(stores.items.length).toBe(2);
    expect(stores.actors[0].items.map((i) => i.name)).toEqual(['Удар']);
    expect(stores.folders.filter((f) => f.name === 'Mephistopheles Terminal').length).toBe(3);   // по одной на Item, Actor, JournalEntry
  });

  it('макрос не запускается у игрока', async () => {
    const { g, stores, log } = fakeFoundry();
    g.game.user.isGM = false;
    await run(foundryMacro(pkg, 'en'), g);
    expect(stores.items.length).toBe(0);
    expect(log.notes).toEqual(['Only the GM can import.']);
  });
});
