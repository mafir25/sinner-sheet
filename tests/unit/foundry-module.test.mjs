import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import JSZip from 'jszip';
import { parsePackage } from '../../site/foundry-import.js';
import { featItem, foundryMacro, buildPackage, importDataJson } from '../../site/foundry-export.js';

const root = new URL('../..', import.meta.url).pathname;
const pkg = buildPackage([{ cat: 'feats', it: { Name: 'Ч', desc: 'x' }, ref: { key: 'Ч' } }], { origin: 'https://site.test', folders: { feats: 'Черты' } });

describe('parsePackage — что вставили в окно импорта', () => {
  it('пакет, макрос с сайта и одиночный документ', () => {
    expect(parsePackage(JSON.stringify(pkg)).items[0].name).toBe('Ч');
    expect(parsePackage(foundryMacro(pkg)).items[0].name).toBe('Ч');
    const one = parsePackage(JSON.stringify(importDataJson(featItem({ Name: 'Ф', desc: 'y' }, { cat: 'feats', key: 'Ф' }))));
    expect(one.items.map((d) => d.name)).toEqual(['Ф']);
    expect(parsePackage(JSON.stringify({ name: 'A', type: 'npc', system: {} })).actors.length).toBe(1);
    expect(parsePackage(JSON.stringify({ name: 'J', pages: [] })).journals.length).toBe(1);
  });
  it('мусор — null', () => {
    for (const x of ['', 'привет', '[]', '{"a":1}', 'null']) expect(parsePackage(x)).toBeNull();
  });
});

describe('модуль pm5e (собранный архив) на имитации Foundry', () => {
  let dir, manifest;
  beforeAll(async () => {
    execFileSync('node', [join(root, 'scripts/build-foundry-module.mjs'), '1.2.3'], { cwd: root });
    const zip = await JSZip.loadAsync(readFileSync(join(root, 'dist-foundry/pm5e.zip')));
    dir = join(root, 'dist-foundry', 'unpacked');      // внутри проекта: Vite не импортирует файлы снаружи
    for (const [name, f] of Object.entries(zip.files)) {
      if (f.dir) continue;
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), await f.async('nodebuffer'));
    }
    manifest = JSON.parse(readFileSync(join(dir, 'module.json'), 'utf8'));
  });

  it('манифест: версия, ссылки на релиз, файлы на месте', () => {
    expect(manifest).toMatchObject({ id: 'pm5e', version: '1.2.3', compatibility: { verified: '14' } });
    expect(manifest.download).toBe('https://github.com/mafir25/sinner-sheet/releases/download/pm5e-v1.2.3/pm5e.zip');
    expect(manifest.relationships.systems[0].id).toBe('dnd5e');
    for (const f of [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map((l) => l.path),
      'scripts/kb.mjs', 'scripts/config.js', 'scripts/vendor/marked.esm.js', 'scripts/vendor/purify.es.mjs', 'data/Rus/world/bestiary.json', 'data/Eng/characters/classes.json']) {
      expect(() => readFileSync(join(dir, f))).not.toThrow();
    }
    const ru = JSON.parse(readFileSync(join(dir, 'lang/ru.json'), 'utf8'));
    const en = JSON.parse(readFileSync(join(dir, 'lang/en.json'), 'utf8'));
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
  });

  it('init регистрирует настройку и API; кнопка в каталоге; импорт создаёт документы и запоминает сайт', async () => {
    const hooks = {}, once = {}, settings = {}, notes = [];
    const items = [], folders = [];
    let id = 0;
    const Doc = (store) => class { static async create(d) { const x = Object.assign(new this(), d, { id: String(++id) }); store.push(x); return x; } };
    const mod = { id: 'pm5e' };
    Object.assign(globalThis, {
      Hooks: { once: (h, f) => { once[h] = f; }, on: (h, f) => { (hooks[h] ||= []).push(f); } },
      game: {
        user: { isGM: true }, folders, items, actors: [], journal: [],
        modules: { get: () => mod },
        i18n: { localize: (k) => k, format: (k, d) => `${k} ${JSON.stringify(d)}` },
        settings: { register: (m, k, cfg) => { settings[k] = cfg.default; }, get: (m, k) => settings[k], set: async (m, k, v) => { settings[k] = v; } },
      },
      ui: { notifications: { info: (m) => notes.push(m), warn: (m) => notes.push(m), error: (m) => notes.push(m) } },
      Folder: Doc(folders), Item: Doc(items), Actor: Doc([]), JournalEntry: Doc([]),
      foundry: { applications: { api: { ApplicationV2: class {} }, instances: new Map() } },
    });
    await import(/* @vite-ignore */ join(dir, 'scripts/pm5e.mjs'));
    once.init();
    expect(settings).toEqual({ siteUrl: 'https://sinner-sheet.vercel.app', liveCanon: true, openLinksInFoundry: true,
      statusAutomation: true, hudStatuses: true, statusTray: true });
    expect(Object.keys(once)).toEqual(['init', 'setup', 'ready']);
    expect(Object.keys(mod.api.statuses)).toEqual(['get', 'set', 'add', 'applyToSelected', 'tick']);
    expect(Object.keys(hooks).sort()).toEqual(['renderActorDirectory', 'renderItemDirectory', 'renderJournalDirectory']);

    const res = await mod.api.importData(foundryMacro(pkg));
    expect(res).toEqual({ created: 1, updated: 0 });
    expect(items[0].name).toBe('Ч');
    expect(await mod.api.importData('ерунда')).toBeNull();
    expect(notes.at(-1)).toBe('PM5E.Import.Bad');

    // кнопка в шапке каталога (DOM — минимальная заглушка)
    const appended = [];
    const bar = { querySelector: () => null, append: (b) => appended.push(b) };
    const html = Object.assign(Object.create(null), { querySelector: (s) => (s === '.header-actions' ? bar : null) });
    globalThis.HTMLElement ??= class {};
    globalThis.document = { createElement: () => ({ addEventListener() {}, set innerHTML(v) { this.h = v; } }) };
    hooks.renderItemDirectory[0]({}, [html]);
    expect(appended.length).toBe(2);                 // «База знаний» и импорт
    game.user.isGM = false;
    appended.length = 0;
    hooks.renderItemDirectory[0]({}, [html]);
    expect(appended.length).toBe(1);                 // игроку — только «База знаний»
  });
});
