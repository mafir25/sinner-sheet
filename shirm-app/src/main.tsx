import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Оформления Limbus Company и Lobotomy Corporation (site/themes/<оформление>/): действуют только при
// html[data-theme="limbus" / "lobotomy"] — его ставит site/theme.js. Грузим оба: оформление меняется в ⚙ Настройках
// без перезагрузки. Стили грузятся мимо сборщика, как site/ui.js, и подключаются после стилей приложения.
for (const theme of ['limbus', 'lobotomy']) {
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

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
