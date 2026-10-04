import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Публичная конфигурация веб-приложения Firebase (это не секрет — защиту дают правила Firestore).
const firebaseConfig = {
  apiKey: 'AIzaSyDaFNBCW76UsBnziHoGveo7TcC11uAdmqs',
  authDomain: 'projectmoonchar.firebaseapp.com',
  projectId: 'projectmoonchar',
  messagingSenderId: '516028417887',
  appId: '1:516028417887:web:4c0404f653b09ecffb58ea',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// В проекте используется именованная база «default» (так было и в старой Ширме).
export const db = getFirestore(app, 'default');
