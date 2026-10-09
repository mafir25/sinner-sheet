// Безопасный рендер описаний: markdown (marked) + цветной текст {#hex}текст{} + очистка DOMPurify.
// Сырой HTML в тексте НЕ исполняется: он выводится как обычный текст.
import { Marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';

const md = new Marked({ gfm: true, breaks: true });

md.use({
  extensions: [
    {
      name: 'colorText',
      level: 'inline',
      start(src: string) {
        const i = src.search(/\{#[0-9a-fA-F]{3,8}\}/);
        return i < 0 ? undefined : i;
      },
      tokenizer(src: string) {
        const m = /^\{(#[0-9a-fA-F]{3,8})\}([\s\S]*?)\{\}/.exec(src);
        if (!m) return undefined;
        const token = {
          type: 'colorText',
          raw: m[0],
          color: m[1],
          tokens: [] as Tokens.Generic[],
        };
        this.lexer.inline(m[2], token.tokens);
        return token;
      },
      renderer(token: Tokens.Generic) {
        return `<span style="color:${token.color}">${this.parser.parseInline(token.tokens ?? [])}</span>`;
      },
    },
  ],
  renderer: {
    // сырой HTML показываем как текст
    html(token: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(token.text);
    },
  },
});

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const cache = new Map<string, string>();

export function renderMarkdown(src: string): string {
  if (!src) return '';
  const hit = cache.get(src);
  if (hit !== undefined) return hit;
  const raw = md.parse(src, { async: false }) as string;
  const clean = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'img',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'style', 'align'],
    // свои страницы можно и без «/»: maps.html#map=…, navigation.html#feats/Имя
    ALLOWED_URI_REGEXP: /^(?:https?:|\/|#|(?:maps|navigation|shirm|index|builder|egobuilder|office)\.html(?:[?#]|$))/i,
  });
  if (cache.size > 2000) cache.clear();
  cache.set(src, clean);
  return clean;
}

// ссылки открываем в новой вкладке
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  // разрешаем в style только цвет, который генерирует наш рендер
  if (node.hasAttribute && node.hasAttribute('style')) {
    const st = node.getAttribute('style') || '';
    if (!/^color:#[0-9a-fA-F]{3,8}$/.test(st)) node.removeAttribute('style');
  }
});
