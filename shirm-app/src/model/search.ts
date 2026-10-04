// Поиск по названию, алиасам, тегам и тексту (включая подблоки). Без внешних библиотек.
import type { ItemMap, NodeItem, Section } from './schema';

export type SearchHit = { node: NodeItem; score: number; where: string };

const norm = (s: string) =>
  s.toLowerCase().replace(/ё/g, 'е').replace(/\{#[0-9a-f]{3,8}\}|\{\}/gi, '').replace(/[*_`>#|]/g, ' ');

function sectionText(ss: Section[]): string {
  return ss.map((s) => `${s.title} ${s.aliases.join(' ')} ${s.body} ${sectionText(s.children)}`).join(' ');
}

export function searchNodes(items: ItemMap, query: string, limit = 25): SearchHit[] {
  const q = norm(query.trim());
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const hits: SearchHit[] = [];
  for (const it of Object.values(items)) {
    if (it.kind !== 'node') continue;
    const title = norm(it.title);
    const aliases = norm(it.aliases.join(' | '));
    const tags = norm(it.tags.map((t) => t.text).join(' | '));
    const body = norm(it.body + ' ' + sectionText(it.sections));
    let score = 0;
    let where = '';
    for (const w of words) {
      let s = 0;
      if (title === w) s = 100;
      else if (title.startsWith(w)) s = 60;
      else if (title.includes(w)) s = 40;
      else if (aliases.includes(w)) { s = 30; where ||= 'алиас'; }
      else if (tags.includes(w)) { s = 25; where ||= 'тег'; }
      else if (body.includes(w)) { s = 8; where ||= 'текст'; }
      if (!s) { score = 0; break; }
      score += s;
    }
    // фраза целиком в тегах (например «Канто VI»)
    if (!score && tags.split(' | ').some((t) => t === q)) { score = 25; where = 'тег'; }
    if (score) hits.push({ node: it, score, where });
  }
  hits.sort((a, b) => b.score - a.score || a.node.title.localeCompare(b.node.title, 'ru'));
  return hits.slice(0, limit);
}
