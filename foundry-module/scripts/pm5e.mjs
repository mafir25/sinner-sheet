/* Модуль Foundry VTT «pm5e» — Mephistopheles Terminal для dnd5e (docs/foundry.md, этапы 3–4).
   - окно «База знаний» (kb.mjs): канон сайта прямо в Foundry, «В мир» и «Выдать персонажу»;
   - окно импорта (макрос или JSON с сайта, файл);
   - ссылки «Открыть в Базе знаний» в описаниях документов открывают окно, а не сайт;
   - статусы Project Moon (statuses.mjs): стаки, палитра меню токена, панель статусов, автоматика боя.
   Кнопки — в шапке каталогов актёров, предметов и журналов. API: game.modules.get('pm5e').api.
   foundry-*.js, canon-reader.js, config.js, vendor/, data/ кладёт сюда сборка (scripts/build-foundry-module.mjs). */
import { importPackage, parsePackage } from './foundry-import.js';
import { parseSiteLink } from './foundry-kb.js';
import { KnowledgeBase } from './kb.mjs';
import { initStatuses, registerStatusSettings, applyToSelected, setStacks, addStacks, getStacks, runTick } from './statuses.mjs';

const ID = 'pm5e';
const ROOT = 'Mephistopheles Terminal';
const t = (k, data) => (data ? game.i18n.format(k, data) : game.i18n.localize(k));

/** Импорт пакета (объект или текст) от имени мастера. → { created, updated } или null. */
async function importData(input) {
  if (!game.user.isGM) { ui.notifications.warn(t('PM5E.Import.GM')); return null; }
  const pkg = typeof input === 'string' ? parsePackage(input) : parsePackage(JSON.stringify(input));
  if (!pkg) { ui.notifications.warn(t('PM5E.Import.Bad')); return null; }
  try {
    const res = await importPackage(pkg, { game, Folder, Item, Actor, JournalEntry }, ROOT);
    ui.notifications.info(t('PM5E.Import.Done', res));
    return res;
  } catch (e) {
    console.error(`${ID} |`, e);
    ui.notifications.error(t('PM5E.Import.Fail'));
    return null;
  }
}

/** Окно импорта: поле для макроса/JSON и выбор файла. */
async function openImporter() {
  const { DialogV2 } = foundry.applications.api;
  const text = await DialogV2.wait({
    window: { title: t('PM5E.Import.Title'), icon: 'fa-solid fa-dice-d20' },
    classes: ['pm5e-import'],
    position: { width: 560 },
    content: `<p class="hint">${t('PM5E.Import.Hint')}</p>
      <label>${t('PM5E.Import.Text')}<textarea name="pkg" spellcheck="false"></textarea></label>
      <label>${t('PM5E.Import.File')} <input type="file" name="file" accept=".json,.js,.txt"></label>`,
    buttons: [{
      action: 'import', label: t('PM5E.Import.Run'), icon: 'fa-solid fa-file-import', default: true,
      callback: async (event, button) => {
        const f = button.form.elements.file.files?.[0];
        return f ? await f.text() : button.form.elements.pkg.value;
      },
    }],
    rejectClose: false,
  });
  if (text) await importData(text);
}

/** Кнопки в шапке каталогов: «База знаний» (всем) и импорт (мастеру). */
function addDirectoryButtons(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const bar = root?.querySelector('.header-actions');
  if (!bar || bar.querySelector('.pm5e-dir-btn')) return;
  const button = (icon, label, title, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pm5e-dir-btn';
    b.innerHTML = `<i class="fa-solid ${icon}"></i> ${label}`;
    b.title = title;
    b.addEventListener('click', onClick);
    bar.append(b);
  };
  button('fa-book-skull', t('PM5E.KB.Button'), t('PM5E.KB.Title'), () => KnowledgeBase.open());
  if (game.user.isGM) button('fa-file-import', t('PM5E.Import.Button'), t('PM5E.Import.Title'), openImporter);
}

/** Ссылка на запись Базы знаний сайта (…/navigation.html#раздел/Имя) в Foundry открывает окно «База знаний». */
function interceptSiteLinks(event) {
  const a = event.target?.closest?.('a[href*="navigation.html#"]');
  if (!a || !game.settings.get(ID, 'openLinksInFoundry')) return;
  const target = parseSiteLink(a.getAttribute('href'));
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  KnowledgeBase.open(target);
}

Hooks.once('init', () => {
  game.settings.register(ID, 'siteUrl', {
    name: 'PM5E.Settings.SiteUrl', hint: 'PM5E.Settings.SiteUrlHint',
    scope: 'world', config: true, type: String, default: 'https://sinner-sheet.vercel.app',
  });
  game.settings.register(ID, 'liveCanon', {
    name: 'PM5E.Settings.LiveCanon', hint: 'PM5E.Settings.LiveCanonHint',
    scope: 'client', config: true, type: Boolean, default: true,
  });
  game.settings.register(ID, 'openLinksInFoundry', {
    name: 'PM5E.Settings.OpenLinks', hint: 'PM5E.Settings.OpenLinksHint',
    scope: 'client', config: true, type: Boolean, default: true,
  });
  registerStatusSettings();
  game.modules.get(ID).api = {
    importData, openImporter, parsePackage, openKB: (target) => KnowledgeBase.open(target),
    statuses: { get: getStacks, set: setStacks, add: addStacks, applyToSelected, tick: runTick },
  };
});
Hooks.once('setup', initStatuses);
Hooks.once('ready', () => document.addEventListener('click', interceptSiteLinks, true));
for (const hook of ['renderActorDirectory', 'renderItemDirectory', 'renderJournalDirectory']) Hooks.on(hook, addDirectoryButtons);
