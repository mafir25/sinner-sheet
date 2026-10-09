import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { tr } from './i18n';
import './styles.css';

document.title = tr('Редактор карт');
// Общее окно настроек сайта (язык + вход). Грузится из dist/site, мимо сборщика;
// в режиме разработки Vite не отдаёт его как модуль, а вход там и не нужен.
if (!import.meta.env.DEV) {
  const siteUi = '/site/ui.js';
  import(/* @vite-ignore */ siteUi).catch((e) => console.warn('site/ui.js не загрузился', e));
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
