import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Оформления Limbus Company, Lobotomy Corporation и Library of Ruina (site/themes/<оформление>/): действуют только при
// html[data-theme="limbus" / "lobotomy" / "library"] — его ставит site/theme.js. Грузим все: оформление меняется
// в ⚙ Настройках без перезагрузки. Стили грузятся мимо сборщика, как site/ui.js, и подключаются после стилей приложения.
for (const theme of ['limbus', 'lobotomy', 'library']) {
  for (const f of ['base', 'shirm']) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `/site/themes/${theme}/${f}.css`;
    document.head.appendChild(link);
  }
}

// Общее окно настроек сайта (язык + вход). Грузится из dist/site, мимо сборщика.
const siteUi = '/site/ui.js';
import(/* @vite-ignore */ siteUi).catch((e) => console.warn('site/ui.js не загрузился', e));

const siteComments = '/site/comments.js';
import(/* @vite-ignore */ siteComments).catch((e) => console.warn('site/comments.js не загрузился', e));

const cmLink = document.createElement('link');
cmLink.rel = 'stylesheet';
cmLink.href = '/site/comments.css';
document.head.appendChild(cmLink);

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
