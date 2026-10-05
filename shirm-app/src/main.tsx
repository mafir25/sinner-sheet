import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Общее окно настроек сайта (язык + вход). Грузится из dist/site, мимо сборщика.
const siteUi = '/site/ui.js';
import(/* @vite-ignore */ siteUi).catch((e) => console.warn('site/ui.js не загрузился', e));

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
