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
