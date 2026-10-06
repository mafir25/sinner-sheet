import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
// Единая конфигурация Firebase для всего сайта (её же используют статические страницы).
import { EMULATOR, firebaseConfig, FIRESTORE_DB } from '../../../site/firebase-config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, FIRESTORE_DB);
// локальная разработка с эмуляторами (?emulator=1 на localhost) — см. site/firebase-config.js
if (EMULATOR) {
  connectAuthEmulator(auth, `http://${EMULATOR.host}:${EMULATOR.auth}`, { disableWarnings: true });
  connectFirestoreEmulator(db, EMULATOR.host, EMULATOR.firestore);
}
