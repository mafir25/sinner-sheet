// Офис: доступ участников и приватность досье (agents — полные, cards — открытые карточки).
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, collection, query, where, writeBatch } from 'firebase/firestore';
import { setupEnv, as, seed } from './helpers.mjs';

let env;
beforeAll(async () => { env = await setupEnv(); });
afterAll(async () => { await env?.cleanup(); });

const agent = (over = {}) => ({
  name: 'Ишмаэль', race: 'Человек', className: 'Фиксер', level: 3, feats: ['Стойкость'],
  description: 'секрет', presetJson: '{"x":1}', ownerUid: '', ownerName: '',
  createdAt: 1, updatedAt: 1, order: 1, ...over,
});
const office = (cs = {}) => ({
  name: 'Офис', creator: 'boss@test.local', creatorUid: 'boss', memberUids: ['boss', 'p1', 'p2'],
  memberNames: {}, members: [], charSettings: { name: true, race: true, class: true, feats: true, desc: false, download: false, ...cs },
  privacy: 2,
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, async (db) => {
    await setDoc(doc(db, 'offices/o1'), office());
    await setDoc(doc(db, 'offices/o1/agents/a1'), agent({ ownerUid: 'p1' }));
    await setDoc(doc(db, 'offices/o1/agents/a2'), agent({ name: 'NPC' }));
    await setDoc(doc(db, 'offices/o1/cards/a1'), { name: 'Ишмаэль', order: 1, createdAt: 1, updatedAt: 1 });
  });
});

describe('доступ к офису', () => {
  it('посторонний не видит офис и карточки', async () => {
    const db = as(env, 'x');
    await assertFails(getDoc(doc(db, 'offices/o1')));
    await assertFails(getDocs(collection(db, 'offices/o1/cards')));
  });
  it('участник не может добавить в офис другого', async () => {
    await assertFails(updateDoc(doc(as(env, 'p1'), 'offices/o1'), { memberUids: ['boss', 'p1', 'p2', 'x'] }));
  });
});

describe('приватность досье', () => {
  it('участник не читает чужое полное досье, но читает своё и карточки', async () => {
    const db = as(env, 'p2');
    await assertFails(getDoc(doc(db, 'offices/o1/agents/a1')));
    await assertFails(getDocs(collection(db, 'offices/o1/agents')));
    await assertSucceeds(getDocs(collection(db, 'offices/o1/cards')));
    const own = as(env, 'p1');
    await assertSucceeds(getDoc(doc(own, 'offices/o1/agents/a1')));
    await assertSucceeds(getDocs(query(collection(own, 'offices/o1/agents'), where('ownerUid', '==', 'p1'))));
  });
  it('менеджер читает все досье', async () => {
    await assertSucceeds(getDocs(collection(as(env, 'boss'), 'offices/o1/agents')));
  });
  it('карточка не может содержать запрещённое поле', async () => {
    const db = as(env, 'boss');
    await assertFails(setDoc(doc(db, 'offices/o1/cards/a2'), { name: 'NPC', description: 'секрет', order: 1, createdAt: 1, updatedAt: 1 }));
    await assertFails(setDoc(doc(db, 'offices/o1/cards/a2'), { name: 'NPC', presetJson: '{"x":1}', order: 1, createdAt: 1, updatedAt: 1 }));
    await assertSucceeds(setDoc(doc(db, 'offices/o1/cards/a2'), { name: 'NPC', race: 'Человек', order: 1, createdAt: 1, updatedAt: 1 }));
  });
  it('карточка должна совпадать с досье', async () => {
    await assertFails(setDoc(doc(as(env, 'boss'), 'offices/o1/cards/a2'), { name: 'Другое имя', order: 1, createdAt: 1, updatedAt: 1 }));
  });
  it('владелец обновляет досье вместе с карточкой; чужую карточку — нет', async () => {
    const db = as(env, 'p1');
    const b = writeBatch(db);
    b.set(doc(db, 'offices/o1/agents/a1'), agent({ ownerUid: 'p1', name: 'Ишмаэль II', updatedAt: 2 }));
    b.set(doc(db, 'offices/o1/cards/a1'), { name: 'Ишмаэль II', order: 1, createdAt: 1, updatedAt: 2 });
    await assertSucceeds(b.commit());
    await assertFails(setDoc(doc(db, 'offices/o1/cards/a2'), { name: 'NPC', order: 1, createdAt: 1, updatedAt: 1 }));
  });
  it('после разрешения описания менеджер может открыть его в карточке', async () => {
    const db = as(env, 'boss');
    await assertSucceeds(updateDoc(doc(db, 'offices/o1'), { charSettings: { ...office().charSettings, desc: true } }));
    await assertSucceeds(setDoc(doc(db, 'offices/o1/cards/a2'), { name: 'NPC', description: 'секрет', order: 1, createdAt: 1, updatedAt: 1 }));
  });
});

describe('журнал сессий', () => {
  const session = { num: 1, title: 'Переулок', date: 'День 1', text: 'итоги', agents: ['Ишмаэль'], createdAt: 1, updatedAt: 1, by: 'boss' };
  it('пишет только менеджер, читают участники', async () => {
    await assertSucceeds(setDoc(doc(as(env, 'boss'), 'offices/o1/sessions/s1'), session));
    await assertFails(setDoc(doc(as(env, 'p1'), 'offices/o1/sessions/s2'), session));
    await assertSucceeds(getDocs(collection(as(env, 'p2'), 'offices/o1/sessions')));
    await assertFails(getDocs(collection(as(env, 'x'), 'offices/o1/sessions')));
  });
  it('лишние поля и слишком длинный текст отклоняются', async () => {
    const db = as(env, 'boss');
    await assertFails(setDoc(doc(db, 'offices/o1/sessions/s1'), { ...session, extra: 1 }));
    await assertFails(setDoc(doc(db, 'offices/o1/sessions/s1'), { ...session, text: 'x'.repeat(20001) }));
  });
});
