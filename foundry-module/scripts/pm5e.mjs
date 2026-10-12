/* Модуль Foundry VTT «pm5e» — Mephistopheles Terminal для dnd5e (docs/foundry.md, этап 3).
   Сейчас: окно импорта (макрос или JSON с сайта, файл) в каталогах актёров, предметов и журналов; API для макросов.
   foundry-import.js — копия site/foundry-import.js, кладётся сюда сборкой (scripts/build-foundry-module.mjs). */
import { importPackage, parsePackage } from './foundry-import.js';

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
    if (pkg.source && !game.settings.get(ID, 'siteUrl')) await game.settings.set(ID, 'siteUrl', pkg.source);
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

/** Кнопка «Mephistopheles» в шапке каталогов (только у мастера). */
function addDirectoryButton(app, html) {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const bar = root?.querySelector('.header-actions');
  if (!bar || bar.querySelector('.pm5e-dir-btn')) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pm5e-dir-btn';
  b.innerHTML = `<i class="fa-solid fa-dice-d20"></i> ${t('PM5E.Import.Button')}`;
  b.title = t('PM5E.Import.Title');
  b.addEventListener('click', openImporter);
  bar.append(b);
}

Hooks.once('init', () => {
  game.settings.register(ID, 'siteUrl', {
    name: 'PM5E.Settings.SiteUrl', hint: 'PM5E.Settings.SiteUrlHint',
    scope: 'world', config: true, type: String, default: '',
  });
  game.modules.get(ID).api = { importData, openImporter, parsePackage };
});
for (const hook of ['renderActorDirectory', 'renderItemDirectory', 'renderJournalDirectory']) Hooks.on(hook, addDirectoryButton);
