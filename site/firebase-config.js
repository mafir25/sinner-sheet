// Единая публичная конфигурация Firebase для всего сайта.
// Её импортируют и статические страницы (site/firebase.js), и Ширма (shirm-app/src/data/firebase.ts).
// Это не секрет: доступ к данным ограничивают правила Firestore (firestore.rules).
export const firebaseConfig = {
  apiKey: 'AIzaSyDaFNBCW76UsBnziHoGveo7TcC11uAdmqs',
  authDomain: 'projectmoonchar.firebaseapp.com',
  projectId: 'projectmoonchar',
  messagingSenderId: '516028417887',
  appId: '1:516028417887:web:4c0404f653b09ecffb58ea',
};

// В проекте используется именованная база «default».
export const FIRESTORE_DB = 'default';

// Локальная разработка с эмуляторами Firebase (firebase emulators:start): только на localhost,
// включается адресом ?emulator=1 (выключается ?emulator=0). На сайте не действует.
export const EMULATOR = (() => {
  try {
    if (!['localhost', '127.0.0.1'].includes(location.hostname)) return null;
    const q = new URLSearchParams(location.search).get('emulator');
    if (q === '1') localStorage.setItem('dev.emulator', '1');
    if (q === '0') localStorage.removeItem('dev.emulator');
    return localStorage.getItem('dev.emulator') === '1' ? { host: '127.0.0.1', firestore: 8085, auth: 9099 } : null;
  } catch { return null; }
})();
