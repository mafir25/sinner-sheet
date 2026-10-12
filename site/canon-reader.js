/* Чтение канона из Firestore через REST — без SDK, без входа и без DOM (docs/foundry.md, этап 4).
   Тот же формат, что читает site/i18n.js и пишет админ-панель (site/canon-core.js):
     canon/<Rus|Eng>__<группа>__<файл>  — манифест { version, chunks }
     canon/<…>/chunks/000, 001…         — { data: кусок текста, v: версия }
   Используется модулем Foundry pm5e (окно «База знаний»); тесты — tests/unit/foundry-kb.test.mjs. */

const restVal = (v) => {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  return undefined;
};

/**
 * Читатель канона. cfg: { projectId, apiKey, db = 'default', fetch = globalThis.fetch, host }.
 * text(lang, rel) → текст файла из Firestore или null, если файла там нет (тогда берут запасную копию).
 * Ошибка сети или доступа — исключение.
 */
export function canonReader(cfg) {
  const f = cfg.fetch || globalThis.fetch;
  const base = `${cfg.host || 'https://firestore.googleapis.com'}/v1/projects/${cfg.projectId}/databases/${encodeURIComponent(cfg.db || 'default')}/documents/canon/`;
  async function get(path, query = '') {
    const res = await f(`${base}${path}?key=${encodeURIComponent(cfg.apiKey)}${query}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`canon ${res.status}`);
    return res.json();
  }
  async function text(lang, rel) {
    const id = `${lang}__${String(rel).replace('/', '__')}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const d = await get(encodeURIComponent(id));
      if (!d) return null;
      const m = { version: restVal(d.fields?.version), chunks: restVal(d.fields?.chunks) };
      const list = await get(`${encodeURIComponent(id)}/chunks`, '&pageSize=100');
      const docs = ((list && list.documents) || [])
        .map((x) => ({ n: x.name.split('/').pop(), data: restVal(x.fields?.data), v: restVal(x.fields?.v) }))
        .sort((a, b) => (a.n < b.n ? -1 : 1));
      if (docs.length >= m.chunks && docs.slice(0, m.chunks).every((c) => c.v === m.version && typeof c.data === 'string')) {
        return docs.slice(0, m.chunks).map((c) => c.data).join('');
      }
      // файл как раз сохраняют — пробуем ещё раз
    }
    throw new Error(`canon: ${id} сохраняется, попробуйте позже`);
  }
  return { text };
}
