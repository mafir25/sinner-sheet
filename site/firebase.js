// Единственная точка инициализации Firebase для статических страниц.
// Страницы импортируют отсюда app/auth/db, а функции Firestore — из того же URL SDK
// (одинаковый URL = один и тот же экземпляр модуля в браузере).
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { firebaseConfig, FIRESTORE_DB, EMULATOR } from './firebase-config.js';

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, FIRESTORE_DB);
if (EMULATOR) {
  connectAuthEmulator(auth, `http://${EMULATOR.host}:${EMULATOR.auth}`, { disableWarnings: true });
  connectFirestoreEmulator(db, EMULATOR.host, EMULATOR.firestore);
}
