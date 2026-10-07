import { describe, it, expect } from 'vitest';
import { splitText, joinChunks, canonWrite, CHUNK_CHARS } from '../../site/canon-core.js';

describe('canon-core', () => {
  it('режет и склеивает текст без потерь, не разрывая суррогатные пары', () => {
    const text = 'а'.repeat(CHUNK_CHARS - 1) + '😀' + 'б'.repeat(10);
    const parts = splitText(text);
    expect(parts.length).toBe(2);
    expect(parts[0].endsWith('😀')).toBe(false);
    const chunks = parts.map((data, i) => ({ id: String(i).padStart(3, '0'), data, v: 2 }));
    expect(joinChunks({ chunks: 2, version: 2 }, chunks)).toBe(text);
  });
  it('куски другой версии не склеиваются', () => {
    expect(joinChunks({ chunks: 1, version: 3 }, [{ id: '000', data: 'x', v: 2 }])).toBeNull();
  });
  it('лишние старые куски попадают в stale', () => {
    const w = canonWrite({ lang: 'Rus', rel: 'items/equipment.json', text: '[]', current: { version: 4, chunks: 3 }, uid: 'u' });
    expect(w.id).toBe('Rus__items__equipment.json');
    expect(w.version).toBe(5);
    expect(w.stale).toEqual(['001', '002']);
  });
});
