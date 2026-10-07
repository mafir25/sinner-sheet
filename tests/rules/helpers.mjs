// Общая обвязка тестов firestore.rules: эмулятор Firestore (firebase.json, порт 8085).
// Запуск: npm run test:rules (поднимает эмулятор сам).
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { setLogLevel } from 'firebase/firestore';

// отказы в доступе — ожидаемая часть тестов, не засоряем вывод
setLogLevel('silent');

export const CODER = 'nikkitamatveev2009@gmail.com';

export async function setupEnv() {
  return initializeTestEnvironment({
    projectId: 'demo-sinner',
    firestore: {
      rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8085,
    },
  });
}

/** Firestore от имени пользователя uid с email (или без входа, если uid не задан). */
export function as(env, uid, email = `${uid}@test.local`) {
  return uid ? env.authenticatedContext(uid, { email }).firestore() : env.unauthenticatedContext().firestore();
}

/** Записать данные в обход правил. */
export async function seed(env, fn) {
  await env.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore()); });
}
