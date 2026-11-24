// Тесты firestore.rules для коллекции comments/{cid}
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { setupEnv, as, seed } from './helpers.mjs';

let env;
beforeAll(async () => { env = await setupEnv(); });
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const validComment = (uid, email, over = {}) => ({
  targetId: 'post_123',
  page: 'navigation',
  authorUid: uid,
  authorNick: 'Dante',
  authorEmail: email,
  text: 'Отличный пост!',
  createdAt: Date.now(),
  ...over,
});

describe('комментарии: чтение', () => {
  it('комментарии доступны для чтения всем (включая неавторизованных)', async () => {
    await seed(env, (db) => setDoc(doc(db, 'comments/c1'), validComment('u1', 'u1@test.local')));
    // неавторизованный
    const anonDb = as(env);
    await assertSucceeds(getDoc(doc(anonDb, 'comments/c1')));
    // авторизованный
    const userDb = as(env, 'u2');
    await assertSucceeds(getDoc(doc(userDb, 'comments/c1')));
  });
});

describe('комментарии: создание', () => {
  it('неавторизованный пользователь не может создать комментарий', async () => {
    const db = as(env);
    await assertFails(setDoc(doc(db, 'comments/c1'), validComment('anon', 'anon@test.local')));
  });

  it('авторизованный пользователь может создать валидный комментарий', async () => {
    const uid = 'u1';
    const email = 'u1@test.local';
    const db = as(env, uid, email);
    await assertSucceeds(setDoc(doc(db, 'comments/c1'), validComment(uid, email)));
  });

  it('поддерживаются опциональные поля для Ширмы (x, y, screenId, isNode, nodeId)', async () => {
    const uid = 'u1';
    const email = 'u1@test.local';
    const db = as(env, uid, email);
    await assertSucceeds(setDoc(doc(db, 'comments/c1'), validComment(uid, email, {
      page: 'shirm',
      x: 150,
      y: 250,
      screenId: 'screen_1',
      isNode: true,
      nodeId: 'node_42',
    })));
  });

  it('нельзя подделать authorUid или authorEmail', async () => {
    const uid = 'u1';
    const email = 'u1@test.local';
    const db = as(env, uid, email);
    // чужой authorUid
    await assertFails(setDoc(doc(db, 'comments/c1'), validComment('other_uid', email)));
    // чужой authorEmail
    await assertFails(setDoc(doc(db, 'comments/c2'), validComment(uid, 'other@test.local')));
  });

  it('нельзя передать лишние поля или недопустимый page', async () => {
    const uid = 'u1';
    const email = 'u1@test.local';
    const db = as(env, uid, email);
    // лишнее поле
    await assertFails(setDoc(doc(db, 'comments/c1'), validComment(uid, email, { evil: true })));
    // недопустимый page
    await assertFails(setDoc(doc(db, 'comments/c2'), validComment(uid, email, { page: 'unknown' })));
    // пустой текст
    await assertFails(setDoc(doc(db, 'comments/c3'), validComment(uid, email, { text: '' })));
  });

  it('заблокированный пользователь не может оставить комментарий', async () => {
    await seed(env, (db) => setDoc(doc(db, 'bans/banned_u'), {
      nick: 'Banned',
      reason: 'Спам',
      by: 'admin',
      byNick: 'Admin',
      at: new Date(),
    }));
    const db = as(env, 'banned_u', 'banned@test.local');
    await assertFails(setDoc(doc(db, 'comments/c1'), validComment('banned_u', 'banned@test.local')));
  });
});

describe('комментарии: редактирование и удаление', () => {
  it('автор может обновить и удалить свой комментарий', async () => {
    const uid = 'u1';
    const email = 'u1@test.local';
    await seed(env, (db) => setDoc(doc(db, 'comments/c1'), validComment(uid, email)));

    const db = as(env, uid, email);
    await assertSucceeds(updateDoc(doc(db, 'comments/c1'), { text: 'Обновленный текст' }));
    await assertSucceeds(deleteDoc(doc(db, 'comments/c1')));
  });

  it('чужой пользователь не может обновить или удалить чужой комментарий', async () => {
    await seed(env, (db) => setDoc(doc(db, 'comments/c1'), validComment('u1', 'u1@test.local')));

    const otherDb = as(env, 'u2', 'u2@test.local');
    await assertFails(updateDoc(doc(otherDb, 'comments/c1'), { text: 'Взлом' }));
    await assertFails(deleteDoc(doc(otherDb, 'comments/c1')));
  });

  it('модератор или аудитор может удалить чужой комментарий', async () => {
    await seed(env, async (db) => {
      await setDoc(doc(db, 'roles/mod'), {
        role: 'admin',
        perms: { moderate: true },
        grantedBy: 'coder',
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'comments/c1'), validComment('u1', 'u1@test.local'));
    });

    const modDb = as(env, 'mod', 'mod@test.local');
    await assertSucceeds(deleteDoc(doc(modDb, 'comments/c1')));
  });
});
