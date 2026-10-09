import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
// Единая конфигурация Firebase сайта. Редактору карт нужен только вход: в Firestore он не пишет.
import { EMULATOR, firebaseConfig } from '../../../site/firebase-config.js';

export const auth = getAuth(initializeApp(firebaseConfig));
if (EMULATOR) connectAuthEmulator(auth, `http://${EMULATOR.host}:${EMULATOR.auth}`, { disableWarnings: true });
