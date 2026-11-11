// Общие настройки ролей — без зависимостей, их импортируют и статические страницы (site/auth.js),
// и Ширма (shirm-app). Тот же email Кодера — в isCoder() в firestore.rules: меняйте оба места вместе.
export const CODER_EMAILS = ['nikkitamatveev2009@gmail.com'];
// Выбранные участники с правом проверки и очистки чужих ширм и офисов (без просмотра скрытой информации).
export const AUDIT_EMAILS = [];
// Разделы канона (папки Assets/<язык>/…): право canon выдаётся списком разделов.
export const CANON_GROUPS = ['characters', 'items', 'mechanics', 'world', 'articles', 'builder'];

export const isCoderEmail = (email) => !!email && CODER_EMAILS.includes(String(email).toLowerCase());
export const isAuditEmail = (email) => !!email && (isCoderEmail(email) || AUDIT_EMAILS.includes(String(email).toLowerCase()));
