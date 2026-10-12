/* Окно «Свет и Э.Г.О.» персонажа (docs/foundry.md, этап 3). Логика — pm-ego.js (общий код с тестами):
   Свет (flags.pm5e.light + ресурс dnd5e «Свет»), Э.Г.О. актёра, дары по уровням и их Слияние по правилу сайта
   (результат — дар нужного тира из Базы знаний, ингредиенты убираются). Открывается кнопкой в шапке листа персонажа,
   с панели статусов токена и через API (game.modules.get('pm5e').api.openEgo(actor)). */
import { lightOf, lightUpdate, giftsOf, egosOf, fusion } from './pm-ego.js';
import { getKB } from './kb.mjs';
import { giftItem, importDataJson } from './foundry-export.js';
import { marked } from './vendor/marked.esm.js';
import DOMPurify from './vendor/purify.es.mjs';

const ID = 'pm5e';
const t = (k, data) => (data ? game.i18n.format(k, data) : game.i18n.localize(k));
const lang = () => (game.i18n.lang === 'en' ? 'en' : 'ru');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const { ApplicationV2 } = foundry.applications.api;

export class EgoWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ['pm5e-ego'],
    window: { title: 'PM5E.Ego.Title', icon: 'fa-solid fa-gem', resizable: true },
    position: { width: 460, height: 'auto' },
    actions: {
      light: EgoWindow.#onLight,
      lightMax: EgoWindow.#onLightMax,
      pick: EgoWindow.#onPick,
      fuse: EgoWindow.#onFuse,
      take: EgoWindow.#onTake,
      open: EgoWindow.#onOpen,
    },
  };

  constructor(actor, options = {}) {
    super({ id: `pm5e-ego-${actor.id}`, ...options });
    this.actor = actor;
    this.picked = new Set();
    this.result = null;
    this.sameTypes = false;
  }

  /** Открыть окно актёра (одно на актёра). */
  static open(actor) {
    if (!actor) return ui.notifications.warn(t('PM5E.KB.NoActor'));
    const app = foundry.applications.instances.get(`pm5e-ego-${actor.id}`) ?? new EgoWindow(actor);
    return app.render({ force: true });
  }

  get title() { return `${t('PM5E.Ego.Title')}: ${this.actor.name}`; }

  async _renderHTML() {
    const a = this.actor;
    const own = a.isOwner;
    const L = lightOf(a);
    const gifts = giftsOf(a.items);
    const egos = egosOf(a.items);
    const light = `<section class="pm5e-light">
        <h3><i class="fa-solid fa-sun"></i> ${esc(t('PM5E.Ego.Light'))}</h3>
        <div class="pm5e-light-row">
          <div class="pm5e-pips">${Array.from({ length: Math.min(L.max, 40) }, (_, i) => `<span class="${i < L.value ? 'on' : ''}"></span>`).join('')}</div>
          <b>${L.value} / ${L.max}</b>
        </div>
        ${own ? `<div class="pm5e-row-btns">
          <button type="button" data-action="light" data-d="-1">−1</button><button type="button" data-action="light" data-d="1">+1</button>
          <button type="button" data-action="light" data-d="full">${esc(t('PM5E.Ego.Restore'))}</button>
          <label>${esc(t('PM5E.Ego.Max'))} <input type="number" class="pm5e-lmax" min="0" max="99" value="${L.max}"></label>
          <button type="button" data-action="lightMax">OK</button></div>` : ''}
      </section>`;
    const egoList = egos.length
      ? `<ul class="pm5e-ilist">${egos.map((e) => `<li><a data-action="open" data-id="${esc(e.id)}">${esc(e.name)}</a><small>${esc(e.meta)}</small></li>`).join('')}</ul>`
      : `<p class="pm5e-note">${esc(t('PM5E.Ego.NoEgo'))}</p>`;
    const giftList = gifts.length
      ? `<ul class="pm5e-ilist">${gifts.map((g) => `<li>${own ? `<input type="checkbox" data-action="pick" data-id="${esc(g.id)}" ${this.picked.has(g.id) ? 'checked' : ''}>` : ''}
          <a data-action="open" data-id="${esc(g.id)}">${esc(g.name)}</a><small>${g.level ? ROMAN[g.level - 1] : '?'}</small></li>`).join('')}</ul>`
      : `<p class="pm5e-note">${esc(t('PM5E.Ego.NoGifts'))}</p>`;
    let fuse = '';
    if (own && gifts.length >= 2) {
      const n = this.picked.size;
      fuse = `<div class="pm5e-row-btns"><button type="button" data-action="fuse" ${n === 2 || n === 3 ? '' : 'disabled'}><i class="fa-solid fa-flask"></i> ${esc(t('PM5E.Ego.Fuse'))} (${n})</button>
        <label><input type="checkbox" class="pm5e-same" ${this.sameTypes ? 'checked' : ''}> ${esc(t('PM5E.Ego.SameTypes'))}</label></div>`;
      if (this.result) {
        fuse += this.result.options.length
          ? `<p>${esc(t('PM5E.Ego.Result', { tier: ROMAN[this.result.tier - 1] }))}</p><ul class="pm5e-ilist pm5e-fuse">${this.result.options.map((e) => `<li>
              <span>${esc(e.it.Name)}</span><small>${esc((e.it.Type || []).join(', '))}</small>
              <button type="button" data-action="take" data-uid="${esc(e.uid)}">${esc(t('PM5E.Ego.Take'))}</button></li>`).join('')}</ul>`
          : `<p class="pm5e-note">${esc(t('PM5E.Ego.NoOptions', { tier: ROMAN[this.result.tier - 1] }))}</p>`;
      }
    }
    return `${light}
      <section><h3><i class="fa-solid fa-gem"></i> ${esc(t('PM5E.Ego.Egos'))}</h3>${egoList}</section>
      <section><h3><i class="fa-solid fa-gift"></i> ${esc(t('PM5E.Ego.Gifts'))}</h3>${giftList}${fuse}</section>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    content.querySelector('.pm5e-same')?.addEventListener('change', (ev) => { this.sameTypes = ev.target.checked; this.result = null; this.render(); });
  }

  static async #onLight(event, target) {
    const L = lightOf(this.actor);
    const d = target.dataset.d;
    const v = d === 'full' ? L.max : L.value + Number(d);
    await this.actor.update(lightUpdate(this.actor, v, L.max, lang()));
    this.render();
  }

  static async #onLightMax() {
    const max = Number(this.element.querySelector('.pm5e-lmax')?.value) || 0;
    const L = lightOf(this.actor);
    await this.actor.update(lightUpdate(this.actor, Math.min(L.value || max, max), max, lang()));
    this.render();
  }

  static #onPick(event, target) {
    const id = target.dataset.id;
    if (target.checked) this.picked.add(id); else this.picked.delete(id);
    this.result = null;
    this.render();
  }

  static async #onFuse() {
    const gifts = giftsOf(this.actor.items).filter((g) => this.picked.has(g.id));
    const { kb } = await getKB();
    this.result = fusion(gifts, kb.byCat.gifts, { sameTypes: this.sameTypes, owned: giftsOf(this.actor.items).map((g) => g.name) });
    if (!this.result) ui.notifications.warn(t('PM5E.Ego.FuseBad'));
    this.render();
  }

  static async #onTake(event, target) {
    const { kb } = await getKB();
    const e = kb.entries.find((x) => x.uid === target.dataset.uid);
    if (!e) return;
    const ingredients = [...this.picked];
    const names = giftsOf(this.actor.items).filter((g) => this.picked.has(g.id)).map((g) => g.name);
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: t('PM5E.Ego.Fuse') },
      content: `<p>${esc(t('PM5E.Ego.Confirm', { from: names.join(', '), to: e.it.Name }))}</p>`,
    });
    if (!ok) return;
    const d = importDataJson(giftItem(e.it, { cat: 'gifts', key: e.key }, { lang: lang(), toHtml: (s) => DOMPurify.sanitize(marked.parse(String(s ?? ''))) }));
    d.flags = { [ID]: { ...d.flags?.[ID], cat: 'gifts' } };
    await this.actor.createEmbeddedDocuments('Item', [d]);
    await this.actor.deleteEmbeddedDocuments('Item', ingredients);
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="pm5e-chat"><h4>${esc(t('PM5E.Ego.Fuse'))}</h4><p>${esc(names.join(' + '))} → <b>${esc(e.it.Name)}</b> (${ROMAN[Number(e.it.Level) - 1] || ''})</p></div>` });
    this.picked.clear();
    this.result = null;
    this.render();
  }

  static #onOpen(event, target) { this.actor.items.get(target.dataset.id)?.sheet?.render(true); }
}

/** Кнопка «Свет и Э.Г.О.» в шапке листа персонажа: ApplicationV2 (dnd5e 4–5) и старые листы (Application v1). */
export function initEgo() {
  const isChar = (a) => a?.documentName === 'Actor' && a.type === 'character';
  Hooks.on('getHeaderControlsApplicationV2', (app, controls) => {
    const actor = app.document ?? app.actor;
    if (!isChar(actor) || controls.some((c) => c.action === 'pm5eEgo')) return;
    if (app.options?.actions && !app.options.actions.pm5eEgo) app.options.actions.pm5eEgo = () => EgoWindow.open(actor);
    controls.push({ action: 'pm5eEgo', icon: 'fa-solid fa-gem', label: 'PM5E.Ego.Title', onClick: () => EgoWindow.open(actor) });
  });
  Hooks.on('getActorSheetHeaderButtons', (app, buttons) => {
    if (!isChar(app.actor)) return;
    buttons.unshift({ label: t('PM5E.Ego.Title'), class: 'pm5e-ego-btn', icon: 'fa-solid fa-gem', onclick: () => EgoWindow.open(app.actor) });
  });
  // перерисовать открытое окно, когда меняется актёр или его предметы
  const refresh = (doc) => {
    const actor = doc?.documentName === 'Actor' ? doc : doc?.parent;
    if (actor?.id) foundry.applications.instances.get(`pm5e-ego-${actor.id}`)?.render();
  };
  for (const h of ['updateActor', 'createItem', 'deleteItem', 'updateItem']) Hooks.on(h, refresh);
}
