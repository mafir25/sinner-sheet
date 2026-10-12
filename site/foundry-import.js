/* Импорт пакета «pm5e-foundry» в мир Foundry VTT (docs/foundry.md, этапы 1 и 3). Единый код для двух путей:
   - макрос с сайта (site/foundry-export.js → foundryMacro): исходник importPackage вшивается в макрос через toString(),
     поэтому функция самодостаточна — никаких ссылок на внешние переменные;
   - модуль Foundry pm5e (foundry-module/): файл копируется в модуль при сборке (scripts/build-foundry-module.mjs).
   Тесты — tests/unit/foundry-export.test.mjs (на имитации Foundry). */

/**
 * Создаёт документы пакета в папках «<root> / <раздел>…», уже импортированные раньше (тот же flags.pm5e.key) — обновляет.
 * env: { game, Folder, Item, Actor, JournalEntry } — глобальные объекты Foundry (v11+). → { created, updated }
 */
export async function importPackage(P, env, root = 'Mephistopheles Terminal') {
  const { game, Folder, Item, Actor, JournalEntry } = env;
  const parentId = (f) => f.folder?.id ?? f.folder ?? null;
  async function folderFor(type, path) {
    let parent = null;
    for (const name of [root, ...String(path || '').split('/').filter(Boolean)]) {
      parent = game.folders.find((f) => f.type === type && f.name === name && parentId(f) === (parent?.id ?? null))
        ?? await Folder.create({ name, type, folder: parent?.id ?? null });
    }
    return parent;
  }
  let created = 0, updated = 0;
  async function put(cls, coll, type, d) {
    const { _folder, items, pages, ...data } = d;
    const key = data.flags?.pm5e?.key;
    const old = key && coll.find((x) => x.flags?.pm5e?.key === key);
    if (old) {
      delete data.type;
      await old.update(data);
      if (items) { await old.deleteEmbeddedDocuments('Item', old.items.map((i) => i.id)); await old.createEmbeddedDocuments('Item', items, { keepId: true }); }
      if (pages) { await old.deleteEmbeddedDocuments('JournalEntryPage', old.pages.map((p) => p.id)); await old.createEmbeddedDocuments('JournalEntryPage', pages); }
      updated++;
    } else {
      const folder = await folderFor(type, _folder);
      await cls.create({ ...data, ...(items ? { items } : {}), ...(pages ? { pages } : {}), folder: folder.id }, { keepEmbeddedIds: true });
      created++;
    }
  }
  for (const d of P.items || []) await put(Item, game.items, 'Item', d);
  for (const d of P.actors || []) await put(Actor, game.actors, 'Actor', d);
  for (const d of P.journals || []) await put(JournalEntry, game.journal, 'JournalEntry', d);
  return { created, updated };
}

/**
 * Что вставили в окно импорта модуля → пакет. Понимает пакет «pm5e-foundry», макрос с сайта (строка «const P = …;»)
 * и одиночный документ («Import Data»-файл с сайта: актёр, предмет или журнал). null — не распознано.
 */
export function parsePackage(text) {
  let s = String(text ?? '').trim();
  if (!s) return null;
  const m = /^const P = (.*);\s*$/m.exec(s);
  if (m) s = m[1];
  let o;
  try { o = JSON.parse(s); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  if (o.format === 'pm5e-foundry') return { items: [], actors: [], journals: [], ...o };
  const pkg = { format: 'pm5e-foundry', version: 1, items: [], actors: [], journals: [] };
  if (Array.isArray(o.pages)) pkg.journals.push(o);
  else if (['character', 'npc', 'vehicle', 'group', 'encounter'].includes(o.type)) pkg.actors.push(o);
  else if (o.type && o.system) pkg.items.push(o);
  else return null;
  return pkg;
}
