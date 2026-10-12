import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { marked } from 'marked';
import { KB_CATS, KB_FILES, loadKB, resolveLink, searchKB, entryView, entryActions, kbMarkdown, parseSiteLink, siteUrlOf, aliasesOf } from '../../site/foundry-kb.js';
import { canonReader } from '../../site/canon-reader.js';

const readAssets = (dirs) => async (rel) => {
  for (const d of dirs) {
    try { return JSON.parse(readFileSync(new URL(`../../Assets/${d}/${rel}`, import.meta.url), 'utf8')); } catch { /* дальше */ }
  }
  return null;
};
const md = (s) => marked.parse(String(s ?? ''));

describe('loadKB из Assets', () => {
  let ru, en;
  beforeAll(async () => { ru = await loadKB(readAssets(['Rus'])); en = await loadKB(readAssets(['Eng', 'Rus'])); });

  it('все разделы непустые, ключи как на сайте (uidOf)', () => {
    for (const c of KB_CATS) expect(ru.byCat[c.id].length, c.id).toBeGreaterThan(0);
    const arch = ru.byCat.classes[0];
    expect(arch.key).toMatch(/^k:fixer:/);
    expect(arch.uid).toBe(`classes:${arch.key}`);
    expect(ru.byCat.bases.map((e) => e.key)).toEqual(expect.arrayContaining(['k:fixer:Фиксер']));
    expect(ru.byCat.feats[0].key).toBe(`k:${ru.byCat.feats[0].name}`);
    expect(KB_FILES).toContain('world/bestiary.json');
  });
  it('английская база: свои файлы, где есть, иначе русские', () => {
    expect(en.byCat.bestiary[0].it.Meta).toMatch(/[a-z]/i);
    expect(en.byCat.rules.length).toBe(ru.byCat.rules.length);
  });
  it('каждая запись рисуется карточкой', () => {
    for (const e of ru.entries) {
      const v = entryView(e, md, 'ru');
      expect(v.title).toBe(e.name);
      expect(typeof v.html).toBe('string');
    }
  });
  it('ссылки и поиск', () => {
    expect(resolveLink(ru, 'Потопление')).toMatchObject({ cat: 'statuses', name: 'Потопление' });
    const toad = resolveLink(ru, 'рыдающая жаба');
    expect(toad?.cat).toBe('bestiary');
    const status = ru.byCat.statuses.find((e) => /\(.+\)/.test(e.name));
    if (status) expect(resolveLink(ru, aliasesOf(status.it).at(-1))).toBe(status);
    const found = searchKB(ru.entries, 'жаба');
    expect(found[0].name).toBe('Рыдающая жаба');
    expect(searchKB(ru.byCat.feats, '').length).toBe(ru.byCat.feats.length);
  });
  it('стат-блок существа и ссылки внутри текста', () => {
    const v = entryView(resolveLink(ru, 'Рыдающая жаба'), md, 'ru');
    expect(v.html).toContain('126 (12d12+48)');
    expect(v.html).toContain('data-action="link" data-target="Потопление"');
    expect(v.tags).toEqual(['ZAYIN']);
  });
});

describe('мелочи', () => {
  it('kbMarkdown: автоссылки, калькуляторы', () => {
    expect(kbMarkdown('5 `Потопления::Потопление` и `Горение` [calc:x]'))
      .toBe('5 <a class="pm5e-link" data-action="link" data-target="Потопление">Потопления</a> и <a class="pm5e-link" data-action="link" data-target="Горение">Горение</a> ');
  });
  it('действия по разделам', () => {
    expect(entryActions('feats')).toEqual({ toWorld: true, toActor: true });
    expect(entryActions('bestiary')).toEqual({ toWorld: true, toActor: false });
    expect(entryActions('statuses')).toEqual({ toWorld: false, toActor: false });
  });
  it('ссылки на сайт туда и обратно', () => {
    const url = siteUrlOf('https://site.test/', { cat: 'feats', name: 'Тело, усиленное грехом' });
    expect(url).toBe('https://site.test/navigation.html#feats/%D0%A2%D0%B5%D0%BB%D0%BE%2C%20%D1%83%D1%81%D0%B8%D0%BB%D0%B5%D0%BD%D0%BD%D0%BE%D0%B5%20%D0%B3%D1%80%D0%B5%D1%85%D0%BE%D0%BC');
    expect(parseSiteLink(url)).toEqual({ cat: 'feats', name: 'Тело, усиленное грехом' });
    expect(parseSiteLink('https://x/other.html')).toBeNull();
    expect(siteUrlOf('', { cat: 'feats', name: 'x' })).toBe('');
  });
});

describe('canonReader (Firestore REST)', () => {
  const doc = (fields) => ({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === 'number' ? { integerValue: String(v) } : { stringValue: v }])) });
  function fakeFetch(store) {
    const calls = [];
    const f = async (url) => {
      calls.push(url);
      const path = decodeURIComponent(url.split('/documents/canon/')[1].split('?')[0]);
      const hit = typeof store[path] === 'function' ? store[path]() : store[path];
      if (hit === undefined) return { status: 404, ok: false };
      if (hit === 403) return { status: 403, ok: false };
      return { status: 200, ok: true, json: async () => hit };
    };
    f.calls = calls;
    return f;
  }
  const cfg = (fetch) => ({ projectId: 'p', apiKey: 'k', db: 'default', fetch });

  it('склеивает куски по порядку; адрес и ключ — как у сайта', async () => {
    const f = fakeFetch({
      'Rus__characters__feats.json': doc({ version: 3, chunks: 2 }),
      'Rus__characters__feats.json/chunks': { documents: [
        { name: '…/chunks/001', ...doc({ data: 'b]', v: 3 }) }, { name: '…/chunks/000', ...doc({ data: '[1,', v: 3 }) },
      ] },
    });
    expect(await canonReader(cfg(f)).text('Rus', 'characters/feats.json')).toBe('[1,b]');
    expect(f.calls[0]).toBe('https://firestore.googleapis.com/v1/projects/p/databases/default/documents/canon/Rus__characters__feats.json?key=k');
  });
  it('файла нет в Firestore — null; ошибка доступа — исключение', async () => {
    expect(await canonReader(cfg(fakeFetch({}))).text('Rus', 'world/lore.json')).toBeNull();
    await expect(canonReader(cfg(fakeFetch({ 'Rus__world__lore.json': 403 }))).text('Rus', 'world/lore.json')).rejects.toThrow('canon 403');
  });
  it('куски от другой версии (файл сохраняют) — вторая попытка', async () => {
    let n = 0;
    const f = fakeFetch({
      'Rus__world__lore.json': doc({ version: 2, chunks: 1 }),
      'Rus__world__lore.json/chunks': () => ({ documents: [{ name: '…/000', ...doc({ data: '[]', v: n++ ? 2 : 1 }) }] }),
    });
    expect(await canonReader(cfg(f)).text('Rus', 'world/lore.json')).toBe('[]');
  });
});
