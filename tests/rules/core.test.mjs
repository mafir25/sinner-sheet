// Ключевые гарантии firestore.rules: роли, баны, журнал, канон, пользовательская база, ники.
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { setupEnv, as, seed, CODER } from './helpers.mjs';

let env;
beforeAll(async () => { env = await setupEnv(); });
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const role = (perms = {}, role = 'admin', grantedBy = 'coder') => ({ role, perms, grantedBy, updatedAt: new Date() });

describe('роли', () => {
  it('обычный пользователь не может выдать себе роль', async () => {
    const db = as(env, 'u1');
    await assertFails(setDoc(doc(db, 'roles/u1'), { role: 'headadmin', perms: {}, grantedBy: 'u1', updatedAt: serverTimestamp() }));
  });
  it('Кодер назначает Гл-Админа', async () => {
    const db = as(env, 'coder', CODER);
    await assertSucceeds(setDoc(doc(db, 'roles/u1'), { role: 'headadmin', perms: {}, grantedBy: 'coder', updatedAt: serverTimestamp() }));
  });
  it('Гл-Админ назначает Админа, но не Гл-Админа и не себя', async () => {
    await seed(env, (db) => setDoc(doc(db, 'roles/head'), role({}, 'headadmin')));
    const db = as(env, 'head');
    const r = (role) => ({ role, perms: { monitor: true }, grantedBy: 'head', updatedAt: serverTimestamp() });
    await assertSucceeds(setDoc(doc(db, 'roles/u1'), r('admin')));
    await assertFails(setDoc(doc(db, 'roles/u2'), r('headadmin')));
    await assertFails(setDoc(doc(db, 'roles/head'), r('admin')));
  });
  it('Админ не раздаёт права', async () => {
    await seed(env, (db) => setDoc(doc(db, 'roles/adm'), role({ monitor: true, ban: true })));
    const db = as(env, 'adm');
    await assertFails(setDoc(doc(db, 'roles/u1'), { role: 'admin', perms: {}, grantedBy: 'adm', updatedAt: serverTimestamp() }));
  });
});

describe('баны', () => {
  it('заблокированный не создаёт записи в базе', async () => {
    await seed(env, (db) => setDoc(doc(db, 'bans/bad'), { by: 'coder', at: new Date() }));
    const db = as(env, 'bad');
    await assertFails(setDoc(doc(db, 'custom_content/x'), {
      type: 'feat', data: {}, isPrivate: false, creatorEmail: 'bad@test.local',
    }));
  });
  it('истёкший бан не мешает', async () => {
    await seed(env, (db) => setDoc(doc(db, 'bans/bad'), { by: 'coder', at: new Date(), until: new Date(Date.now() - 1000) }));
    const db = as(env, 'bad');
    await assertSucceeds(setDoc(doc(db, 'custom_content/x'), {
      type: 'feat', data: {}, isPrivate: false, creatorEmail: 'bad@test.local',
    }));
  });
  it('Админ с правом ban не блокирует сотрудника', async () => {
    await seed(env, async (db) => {
      await setDoc(doc(db, 'roles/adm'), role({ ban: true }));
      await setDoc(doc(db, 'roles/adm2'), role({}));
    });
    const db = as(env, 'adm');
    await assertFails(setDoc(doc(db, 'bans/adm2'), { by: 'adm', at: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(db, 'bans/u1'), { by: 'adm', at: serverTimestamp() }));
  });
});

describe('журнал', () => {
  it('записи журнала нельзя менять даже Гл-Админу', async () => {
    await seed(env, async (db) => {
      await setDoc(doc(db, 'roles/head'), role({}, 'headadmin'));
      await setDoc(doc(db, 'audit/a1'), { at: new Date(), uid: 'head', action: 'x' });
    });
    await assertFails(updateDoc(doc(as(env, 'head'), 'audit/a1'), { action: 'y' }));
    await assertFails(deleteDoc(doc(as(env, 'head'), 'audit/a1')));
    await assertSucceeds(deleteDoc(doc(as(env, 'coder', CODER), 'audit/a1')));
  });
  it('обычный пользователь не пишет в журнал', async () => {
    await assertFails(setDoc(doc(as(env, 'u1'), 'audit/a2'), { at: serverTimestamp(), uid: 'u1', action: 'x' }));
  });
});

describe('канон', () => {
  const manifest = (uid, version = 1) => ({
    lang: 'Rus', group: 'items', name: 'equipment.json', version, chunks: 1, size: 2,
    updatedAt: serverTimestamp(), updatedBy: uid,
  });
  it('читают все без входа', async () => {
    await seed(env, (db) => setDoc(doc(db, 'canon/Rus__items__equipment.json'), { group: 'items' }));
    await assertSucceeds(getDoc(doc(as(env, null), 'canon/Rus__items__equipment.json')));
  });
  it('пишет только Админ с правом на группу, версия растёт на 1', async () => {
    await seed(env, async (db) => {
      await setDoc(doc(db, 'roles/items'), role({ canon: ['items'] }));
      await setDoc(doc(db, 'roles/world'), role({ canon: ['world'] }));
    });
    const save = (uid, v) => {
      const db = as(env, uid);
      const b = writeBatch(db);
      b.set(doc(db, 'canon/Rus__items__equipment.json'), manifest(uid, v));
      b.set(doc(db, 'canon/Rus__items__equipment.json/chunks/000'), { data: '[]', v });
      return b.commit();
    };
    await assertFails(save('world', 1));
    await assertFails(save('u1', 1));
    await assertSucceeds(save('items', 1));
    await assertFails(save('items', 3));
    await assertSucceeds(save('items', 2));
  });
});

describe('пользовательская база', () => {
  beforeEach(async () => {
    await seed(env, async (db) => {
      await setDoc(doc(db, 'custom_content/pub'), { type: 'feat', data: {}, isPrivate: false, creatorEmail: 'a@test.local' });
      await setDoc(doc(db, 'custom_content/priv'), { type: 'feat', data: {}, isPrivate: true, creatorEmail: 'a@test.local' });
    });
  });
  it('публичное видно без входа, приватное — только автору и модератору', async () => {
    await assertSucceeds(getDoc(doc(as(env, null), 'custom_content/pub')));
    await assertFails(getDoc(doc(as(env, null), 'custom_content/priv')));
    await assertFails(getDoc(doc(as(env, 'b'), 'custom_content/priv')));
    await assertSucceeds(getDoc(doc(as(env, 'a'), 'custom_content/priv')));
    await seed(env, (db) => setDoc(doc(db, 'roles/mod'), role({ moderate: true })));
    await assertSucceeds(getDoc(doc(as(env, 'mod'), 'custom_content/priv')));
  });
  it('запрос без фильтра isPrivate не отдаёт чужое приватное', async () => {
    await assertFails(getDocs(collection(as(env, 'b'), 'custom_content')));
    await assertSucceeds(getDocs(query(collection(as(env, 'b'), 'custom_content'), where('isPrivate', '==', false))));
  });
  it('чужую запись нельзя присвоить', async () => {
    await assertFails(updateDoc(doc(as(env, 'b'), 'custom_content/pub'), { creatorEmail: 'b@test.local' }));
    await assertFails(updateDoc(doc(as(env, 'a'), 'custom_content/pub'), { creatorEmail: 'b@test.local' }));
  });
});

describe('ники', () => {
  it('ник занимается вместе с users/<uid>, чужой ник не отобрать', async () => {
    const db = as(env, 'u1');
    const b = writeBatch(db);
    b.set(doc(db, 'nicknames/fixer'), { uid: 'u1', nick: 'Fixer' });
    b.set(doc(db, 'users/u1'), { nick: 'Fixer', nickId: 'fixer' });
    await assertSucceeds(b.commit());

    const db2 = as(env, 'u2');
    await assertFails(setDoc(doc(db2, 'nicknames/fixer'), { uid: 'u2', nick: 'Fixer' }));
    await assertFails(setDoc(doc(db2, 'users/u2'), { nick: 'Fixer', nickId: 'fixer' }));
  });
});

describe('восстановление из журнала', () => {
  const entry = { type: 'feat', data: { Name: 'X' }, isPrivate: false, creatorEmail: 'a@test.local', updatedAt: '2026-01-01' };
  it('модератор восстанавливает чужую запись, обычный пользователь — нет', async () => {
    await seed(env, (db) => setDoc(doc(db, 'roles/mod'), role({ moderate: true })));
    await assertFails(setDoc(doc(as(env, 'b'), 'custom_content/r1'), entry));
    await assertSucceeds(setDoc(doc(as(env, 'mod'), 'custom_content/r1'), entry));
  });
  it('Админ без права moderate не восстанавливает', async () => {
    await seed(env, (db) => setDoc(doc(db, 'roles/mon'), role({ monitor: true })));
    await assertFails(setDoc(doc(as(env, 'mon'), 'custom_content/r2'), entry));
  });
});
