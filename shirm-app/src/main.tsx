import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Оформление Limbus Company (site/themes/limbus/): действует только при html[data-theme="limbus"] — его ставит
// site/theme.js. Стили грузятся мимо сборщика, как site/ui.js, и подключаются после стилей приложения.
for (const f of ['base', 'shirm']) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `/site/themes/limbus/${f}.css`;
  document.head.appendChild(link);
}

// Общее окно настроек сайта (язык + вход). Грузится из dist/site, мимо сборщика.
const siteUi = '/site/ui.js';
import(/* @vite-ignore */ siteUi).catch((e) => console.warn('site/ui.js не загрузился', e));

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
