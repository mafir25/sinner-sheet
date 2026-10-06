// Скачивает канон из Firestore (коллекция canon, её правит admin.html) обратно в Assets/ репозитория,
// чтобы запасные файлы и генератор конструктора (gen-builder-data.mjs) работали с актуальными данными.
//
//   node scripts/canon-pull.mjs            — все перенесённые файлы
//   node scripts/canon-pull.mjs feats      — только файлы, в пути которых есть «feats»
//
// Канон читают все (firestore.rules), поэтому ключи и вход не нужны. Отступ JSON сохраняется как в файле.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { firebaseConfig, FIRESTORE_DB } from '../site/firebase-config.js';

// FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 — читать из локального эмулятора
const HOST = process.env.FIRESTORE_EMULATOR_HOST ? `http://${process.env.FIRESTORE_EMULATOR_HOST}` : 'https://firestore.googleapis.com';
const BASE = `${HOST}/v1/projects/${firebaseConfig.projectId}/databases/${encodeURIComponent(FIRESTORE_DB)}/documents/canon`;
const KEY = `key=${encodeURIComponent(firebaseConfig.apiKey)}`;
const filter = process.argv[2] || '';
const val = (v) => v?.stringValue ?? (v?.integerValue != null ? Number(v.integerValue) : undefined);

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url.replace(/key=[^&]+/, 'key=…')}`);
  return res.json();
}

const manifests = [];
for (let token = ''; ;) {
  const page = await get(`${BASE}?${KEY}&pageSize=100${token ? '&pageToken=' + encodeURIComponent(token) : ''}`);
  manifests.push(...(page.documents || []));
  if (!page.nextPageToken) break;
  token = page.nextPageToken;
}

let n = 0;
for (const d of manifests) {
  const id = d.name.split('/').pop();
  const f = d.fields;
  const [lang, group, name, version, chunks] = ['lang', 'group', 'name', 'version', 'chunks'].map((k) => val(f[k]));
  const rel = `${lang}/${group}/${name}`;
  if (filter && !rel.includes(filter)) continue;
  const list = await get(`${BASE}/${encodeURIComponent(id)}/chunks?${KEY}&pageSize=100`);
  const parts = (list.documents || []).map((c) => ({ n: c.name.split('/').pop(), data: val(c.fields.data), v: val(c.fields.v) }))
    .sort((a, b) => (a.n < b.n ? -1 : 1)).slice(0, chunks);
  if (parts.length !== chunks || parts.some((p) => p.v !== version)) {
    console.warn(`пропуск ${rel}: файл сейчас сохраняют, повторите позже`);
    continue;
  }
  let text = parts.map((p) => p.data).join('');
  const out = join(process.cwd(), 'Assets', rel);
  if (name.endsWith('.json')) {
    // отступ как у текущего файла (world.json — 1 пробел, остальные — 2)
    const old = existsSync(out) ? readFileSync(out, 'utf8') : '';
    const indent = /^[[{]\r?\n( +)/.exec(old)?.[1].length || 2;
    text = JSON.stringify(JSON.parse(text), null, indent) + (old.endsWith('\n') || !old ? '\n' : '');
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  console.log(`✓ Assets/${rel}  (v${version})`);
  n++;
}
console.log(`canon-pull: записано файлов: ${n}`);
