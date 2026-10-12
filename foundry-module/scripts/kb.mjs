/* Окно «База знаний Mephistopheles» в Foundry (docs/foundry.md, этапы 3–4): разделы и поиск как на сайте, карточки,
   ссылки между записями, «В мир» и «Выдать персонажу». Канон — живьём из Firestore (как на сайте), без сети или при
   отказе — встроенная копия Assets/ (data/ в модуле, кладётся сборкой). Общий код с сайтом — foundry-kb.js,
   foundry-export.js, foundry-import.js, canon-reader.js (копируются сборкой scripts/build-foundry-module.mjs). */
import { KB_CATS, loadKB, searchKB, entryView, entryActions, resolveLink, siteUrlOf } from './foundry-kb.js';
import { buildPackage, importDataJson } from './foundry-export.js';
import { importPackage } from './foundry-import.js';
import { canonReader } from './canon-reader.js';
import { CANON } from './config.js';
import { statusByName } from './pm-statuses.js';
import { applyToSelected } from './statuses.mjs';
import { marked } from './vendor/marked.esm.js';
import DOMPurify from './vendor/purify.es.mjs';

const ID = 'pm5e';
const ROOT = 'Mephistopheles Terminal';
const t = (k, data) => (data ? game.i18n.format(k, data) : game.i18n.localize(k));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const lang = () => (game.i18n.lang === 'en' ? 'en' : 'ru');
const md = (s) => DOMPurify.sanitize(marked.parse(String(s ?? ''), { breaks: true, gfm: true }), { ADD_ATTR: ['data-action', 'data-target'] });
const siteUrl = () => String(game.settings.get(ID, 'siteUrl') || '').replace(/\/+$/, '');

/* ---------- данные ---------- */
let KB = null;        // Promise<{ kb, live, snapshot, error }>
/** Загрузить Базу знаний (один раз за сессию; fresh — заново). */
export function getKB(fresh = false) {
  if (KB && !fresh) return KB;
  KB = (async () => {
    const dirs = lang() === 'en' ? ['Eng', 'Rus'] : ['Rus'];
    const stat = { live: 0, snapshot: 0, error: null };
    let reader = game.settings.get(ID, 'liveCanon') ? canonReader(CANON) : null;
    const read = async (rel) => {
      for (const dir of dirs) {
        if (reader) {
          try {
            const text = await reader.text(dir, rel);
            if (text != null) { stat.live++; return JSON.parse(text); }
          } catch (e) {
            console.warn(`${ID} | канон из Firestore недоступен, беру встроенную копию`, e);
            stat.error = String(e.message || e);
            reader = null;                       // больше не пытаемся в этой загрузке
          }
        }
        const res = await fetch(`modules/${ID}/data/${dir}/${rel}`).catch(() => null);
        if (res?.ok) { stat.snapshot++; return res.json(); }
      }
      return null;
    };
    const kb = await loadKB(read);
    return { kb, ...stat };
  })();
  return KB;
}

/** Цель для «Выдать персонажу»: актёр выделенного токена или свой персонаж. */
function targetActor() {
  return canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character ?? null;
}

/* ---------- окно ---------- */
const { ApplicationV2 } = foundry.applications.api;

export class KnowledgeBase extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: 'pm5e-kb',
    classes: ['pm5e-kb'],
    window: { title: 'PM5E.KB.Title', icon: 'fa-solid fa-book-skull', resizable: true },
    position: { width: 1000, height: 700 },
    actions: {
      cat: KnowledgeBase.#onCat,
      entry: KnowledgeBase.#onEntry,
      link: KnowledgeBase.#onLink,
      toWorld: KnowledgeBase.#onToWorld,
      toActor: KnowledgeBase.#onToActor,
      site: KnowledgeBase.#onSite,
      toTokens: KnowledgeBase.#onToTokens,
      refresh: KnowledgeBase.#onRefresh,
    },
  };

  cat = 'classes';
  query = '';
  selected = null;     // uid
  data = null;

  /** Открыть окно (и сразу запись: { cat, name } или uid). */
  static async open(target) {
    const app = foundry.applications.instances.get('pm5e-kb') ?? new KnowledgeBase();
    if (target) await app.show(target);
    else app.render({ force: true });
    return app;
  }

  async show(target) {
    this.data ??= await getKB();
    const { kb } = this.data;
    const e = target.uid ? kb.entries.find((x) => x.uid === target.uid)
      : kb.entries.find((x) => x.cat === target.cat && x.name === target.name) || resolveLink(kb, target.name);
    if (!e) { ui.notifications.warn(t('PM5E.KB.NotFound', { name: target.name || target.uid })); return this.render({ force: true }); }
    this.cat = e.cat; this.selected = e.uid; this.query = '';
    await this.render({ force: true });
    this.element?.querySelector(`[data-uid="${CSS.escape(e.uid)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  async _prepareContext() {
    this.data = await getKB();
    return {};
  }

  async _renderHTML() {
    const { kb, live, snapshot, error } = this.data;
    const L = lang();
    const cats = KB_CATS.map((c) => `<button type="button" class="pm5e-cat ${c.id === this.cat ? 'active' : ''}" data-action="cat" data-cat="${c.id}">
        <i class="fa-solid ${c.icon}"></i> <span>${esc(c[L])}</span> <small>${kb.byCat[c.id].length}</small></button>`).join('');
    const src = live ? t('PM5E.KB.Live') : t('PM5E.KB.Snapshot');
    return `<div class="pm5e-kb-layout">
      <nav class="pm5e-cats">${cats}
        <div class="pm5e-src" title="${esc(error || '')}">${esc(src)}${error ? ' ⚠' : ''}
          <button type="button" data-action="refresh" title="${esc(t('PM5E.KB.Refresh'))}"><i class="fa-solid fa-rotate"></i></button></div>
      </nav>
      <section class="pm5e-list-col">
        <input type="search" class="pm5e-search" placeholder="${esc(t('PM5E.KB.Search'))}" value="${esc(this.query)}">
        <ol class="pm5e-list">${this.#listHtml()}</ol>
      </section>
      <article class="pm5e-entry">${this.#entryHtml()}</article>
    </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    const input = content.querySelector('.pm5e-search');
    input.addEventListener('input', () => {
      this.query = input.value;
      content.querySelector('.pm5e-list').innerHTML = this.#listHtml();
    });
  }

  #visible() {
    const { kb } = this.data;
    // поиск ищет по всем разделам, без поиска — текущий раздел
    return this.query.trim() ? searchKB(kb.entries, this.query) : kb.byCat[this.cat];
  }

  #listHtml() {
    const list = this.#visible();
    const L = lang();
    const catName = (id) => KB_CATS.find((c) => c.id === id)?.[L] || id;
    if (!list.length) return `<li class="pm5e-empty">${esc(t('PM5E.KB.Empty'))}</li>`;
    return list.slice(0, 400).map((e) => `<li class="${e.uid === this.selected ? 'active' : ''}" data-action="entry" data-uid="${esc(e.uid)}">
        <span>${esc(e.name)}</span>${this.query.trim() ? `<small>${esc(catName(e.cat))}</small>` : e.cat === 'classes' ? `<small>${esc(e.it.__class || '')}</small>` : ''}</li>`).join('');
  }

  #entryHtml() {
    const e = this.selected && this.data.kb.entries.find((x) => x.uid === this.selected);
    if (!e) return `<div class="pm5e-empty">${esc(t('PM5E.KB.Pick'))}</div>`;
    const v = entryView(e, md, lang());
    const can = entryActions(e.cat);
    const actor = targetActor();
    const buttons = [
      can.toWorld && game.user.isGM ? `<button type="button" data-action="toWorld"><i class="fa-solid fa-folder-plus"></i> ${esc(t(e.cat === 'bestiary' ? 'PM5E.KB.ToWorldActor' : 'PM5E.KB.ToWorld'))}</button>` : '',
      can.toActor ? `<button type="button" data-action="toActor" ${actor ? '' : 'disabled'} title="${esc(actor ? actor.name : t('PM5E.KB.NoActor'))}"><i class="fa-solid fa-user-plus"></i> ${esc(t('PM5E.KB.ToActor', { name: actor?.name ?? '…' }))}</button>` : '',
      siteUrl() ? `<button type="button" data-action="site"><i class="fa-solid fa-arrow-up-right-from-square"></i> ${esc(t('PM5E.KB.Site'))}</button>` : '',
    ].filter(Boolean).join('');
    const status = e.cat === 'statuses' ? statusByName(e.name) : null;
    const note = status
      ? `<div class="pm5e-actions"><input type="number" class="pm5e-n" value="1" min="1" max="${status.max}">
          <button type="button" data-action="toTokens" data-status="${status.id}"><i class="fa-solid fa-person-burst"></i> ${esc(t('PM5E.KB.ToTokens'))}</button></div>`
      : e.cat === 'statuses' ? `<p class="pm5e-note">${esc(t('PM5E.KB.StatusNote'))}</p>` : '';
    return `<header><h2>${esc(v.title)}</h2>${v.meta ? `<div class="pm5e-meta">${esc(v.meta)}</div>` : ''}
        ${v.tags.length ? `<div class="pm5e-tags">${v.tags.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
        ${buttons ? `<div class="pm5e-actions">${buttons}</div>` : ''}${note}</header>
      <div class="pm5e-body">${v.html}</div>`;
  }

  #entry() { return this.data.kb.entries.find((x) => x.uid === this.selected); }

  /** Пакет для одной записи — те же документы, что даёт кнопка «Foundry» на сайте. */
  #package(e) {
    const L = lang();
    const folders = Object.fromEntries(KB_CATS.map((c) => [c.id, c[L]]));
    return buildPackage([{ cat: e.cat, it: e.it, ref: { key: e.key, url: siteUrlOf(siteUrl(), e) } }],
      { origin: siteUrl(), lang: L, folders, toHtml: (s) => DOMPurify.sanitize(marked.parse(String(s ?? ''))) });
  }

  static #onCat(event, target) { this.cat = target.dataset.cat; this.query = ''; this.render(); }

  static #onEntry(event, target) {
    this.selected = target.dataset.uid;
    this.element.querySelectorAll('.pm5e-list li.active').forEach((li) => li.classList.remove('active'));
    target.classList.add('active');
    this.element.querySelector('.pm5e-entry').innerHTML = this.#entryHtml();
    this.element.querySelector('.pm5e-entry').scrollTop = 0;
  }

  static #onLink(event, target) {
    event.preventDefault();
    const e = resolveLink(this.data.kb, target.dataset.target);
    if (!e) return ui.notifications.info(t('PM5E.KB.NotFound', { name: target.dataset.target }));
    this.show({ uid: e.uid });
  }

  static async #onToWorld() {
    const e = this.#entry();
    if (!e || !game.user.isGM) return;
    try {
      const res = await importPackage(this.#package(e), { game, Folder, Item, Actor, JournalEntry }, ROOT);
      ui.notifications.info(t('PM5E.Import.Done', res));
    } catch (err) {
      console.error(`${ID} |`, err);
      ui.notifications.error(t('PM5E.Import.Fail'));
    }
  }

  static async #onToActor() {
    const e = this.#entry();
    const actor = targetActor();
    if (!e || !actor) return ui.notifications.warn(t('PM5E.KB.NoActor'));
    const items = this.#package(e).items.map(importDataJson);
    try {
      await actor.createEmbeddedDocuments('Item', items);
      ui.notifications.info(t('PM5E.KB.Given', { n: items.length, name: actor.name }));
    } catch (err) {
      console.error(`${ID} |`, err);
      ui.notifications.error(t('PM5E.Import.Fail'));
    }
  }

  static #onSite() {
    const e = this.#entry();
    if (e && siteUrl()) window.open(siteUrlOf(siteUrl(), e), '_blank', 'noopener');
  }

  static async #onToTokens(event, target) {
    const n = Math.max(1, Number(this.element.querySelector('.pm5e-n')?.value) || 1);
    const count = await applyToSelected(target.dataset.status, n);
    if (count) ui.notifications.info(t('PM5E.KB.Applied', { n, count }));
  }

  static async #onRefresh() {
    this.data = await getKB(true);
    this.render();
  }
}
