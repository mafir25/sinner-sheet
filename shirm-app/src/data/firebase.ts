import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
// Единая конфигурация Firebase для всего сайта (её же используют статические страницы).
import { firebaseConfig, FIRESTORE_DB } from '../../../site/firebase-config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, FIRESTORE_DB);
