// Генератор метаданных Конструктора персонажа (builder.html).
//
//   node scripts/gen-builder-data.mjs
//
// Создаёт для каждого языка (Assets/Rus/builder и Assets/Eng/builder):
//   Builder_feats.json   — какие черты дают увеличение характеристик, выборы, другие черты, слоты и т. д.
//   Builder_races.json   — расы: черты, скорость, увеличения характеристик и выборы
//   Builder_classes.json — основные классы (Фиксер, Кровавый демон) и архетипы: слоты, прибавки, снаряжение принадлежности
//
// Источник правды — этот файл. Черты, предметы снаряжения и роды кровососов находятся в feats.json /
// equipment.json / bloodarch.json каждого языка ПО ИМЕНИ (поле name: L(рус, англ)) или по полю id записи, если оно есть,
// а не по порядку: записи можно добавлять и переставлять. Переименовали запись в каноне — поправьте name здесь
// (генератор остановится и назовёт пропажу). Архетипы Фиксера (classes.json) — по полю No.
// Конструктор тоже ищет снаряжение и роды по имени, так что перестановка в каноне не ломает его даже без перезапуска.
//
// Формат эффектов (поле "effects") — общий для черт, рас и классов:
//   { type:"stat", stats:{Str:1}, cap:20 }                  — постоянная прибавка (не выше cap, по умолчанию — текущего максимума)
//   { type:"statChoice", id, amount, count, options:[...], cap, maxPlus } — прибавка к характеристике(ам) на выбор
//   { type:"statMax", stats:{Str:22} }                      — максимум характеристики не меньше значения
//   { type:"statMaxPlus", stats:{Str:2} }                   — максимум характеристики +N
//   { type:"perLevelStat", stats:{Str:1}, once:{Dex:1}, cap }— прибавка за каждый уровень после взятия
//   { type:"grantFeat", feat:"id" }                         — даёт черту автоматически
//   { type:"featChoice", id, options:["id",...] }           — даёт одну черту из списка на выбор
//   { type:"featSlot", id, filter:{base:[...]}, label }     — отдельный слот черты (Фрилансер, Род Злобы…)
//   { type:"asiSlot", id, noFeat:true }                     — слот «Увеличение характеристик» (+2 / +1+1 / черта)
//   { type:"pick", id, label, options:[...] | parse:"bullets"|"bold" + источник, range:[a,b] }
//                                                           — выбор варианта (грех, искусство крови…). Источник списка:
//                                                             from:"self" — описание самой черты; talent:N — умение N базового класса;
//                                                             talentLevel:N — умение архетипа N-го уровня
//   { type:"choice", id, label, parse/options, optionEffects:{<индекс>:[эффекты]}, slot:true }
//                                                           — выбор с последствиями (Аномальная способность, отдел Лоботомии)
//   { type:"pickList", id, label, talent, parse, levels:[...] } — слоты выбора из списка умения (боевой стиль, техники Света)
//   { type:"classChoice", id, label }                       — выбор второй принадлежности (Бывший член)
//   { type:"hpPerLevel", value } { type:"hpConMult", value } { type:"hitDieStep", value } { type:"hitDie", value }
//   { type:"speed", value } { type:"light", value } { type:"lightStat", stat } { type:"slot", slot:"workshop", value }
//   { type:"dc", value } — +N к СЛ Фиксера;  { type:"bloodfiend" } — считается Кровавым демоном (для требований)
//   { type:"egoTiers" } — слоты атак Э.Г.О. по уровням (только при черте «Э.Г.О.-оружие»)
//   { type:"egoAttack" } { type:"egoForm", form:"efflorescent"|"volatile" } { type:"suppress", talent:<номер> }
//   { type:"note", text }                                   — только пояснение, в расчётах не участвует
// У любого эффекта может быть "level" — уровень персонажа, с которого он действует.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const LANGS = { Rus: 'ru', Eng: 'en' };
// Файлы данных лежат по папкам-группам (Assets/<язык>/characters, items…) — ищем по имени.
const findData = (dir, f) => {
  const hit = readdirSync(join(ROOT, 'Assets', dir), { recursive: true }).find((p) => p.split(/[\\/]/).pop() === f);
  if (!hit) throw new Error(`Нет файла ${f} в Assets/${dir}`);
  return join(ROOT, 'Assets', dir, hit);
};
const load = (dir, f) => JSON.parse(readFileSync(findData(dir, f), 'utf8'));
const out = (dir, f) => join(ROOT, 'Assets', dir, 'builder', f);
const L = (ru, en) => ({ ru, en });
const ALL = ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha'];
const PHYS = ['Str', 'Dex', 'Con'];
const each = (keys, v) => Object.fromEntries(keys.map((k) => [k, v]));

/* =====================================================================
   ЧЕРТЫ — в порядке feats.json
   ===================================================================== */
const FEATS = [
  { id: 'sin_enhanced_body', name: L('Тело, усиленное грехом', 'Sin Enhanced Body'), background: true, effects: [
    { type: 'hpPerLevel', value: 5 },
    { type: 'perLevelStat', stats: { Str: 1 }, once: { Dex: 1, Con: 1 } },
    { type: 'statMax', stats: { Str: 22 } },
    { type: 'note', text: L('Владение спасбросками Телосложения.', 'Proficiency in Constitution saving throws.') },
    { type: 'grantFeat', feat: 'sin_affinity' },
    { type: 'featChoice', id: 'bonus', label: L('Дополнительная черта', 'Bonus feat'), options: ['athlete_history', 'beyond_fast', 'strong_body'], ignoreReq: true },
  ] },
  { id: 'backstreet_dweller', name: L('Житель Закоулков', 'Backstreet Dweller'), background: true, effects: [] },
  { id: 'mephistopheles_engine', name: L('Связь с Двигателем Мефистофеля', 'Connection to the Mephistopheles Engine'), background: true, effects: [
    { type: 'grantFeat', feat: 'sin_affinity' }, { type: 'grantFeat', feat: 'ego_weapon' },
  ] },
  { id: 'once_affiliated', name: L('Бывший член', 'Once Affiliated'), background: true, effects: [
    { type: 'classChoice', id: 'second', label: L('Дополнительная принадлежность', 'Additional affiliation') },
  ] },
  { id: 'workshop_connections', name: L('Связи с мастерскими', 'Workshop Connections'), background: true, effects: [
    { type: 'grantFeat', feat: 'workshop_enthusiast' },
    { type: 'note', text: L('+1 очко модификаций мастерского оружия.', '+1 workshop weapon modification point.') },
  ] },
  { id: 'athlete_history', name: L('Атлетическое прошлое', 'Athlete History'), requires: { stats: { Str: 15 } }, effects: [{ type: 'stat', stats: { Str: 1 }, cap: 20 }] },
  { id: 'colossal_physique', name: L('Колоссальное телосложение', 'Colossal Physique'), requires: { stats: { Str: 17 }, feats: ['athlete_history'] }, effects: [] },
  { id: 'beyond_fast', name: L('Запредельная скорость', 'Beyond Fast'), requires: { stats: { Dex: 15 } }, effects: [{ type: 'stat', stats: { Dex: 1 }, cap: 20 }, { type: 'speed', value: 15 }] },
  { id: 'untraceable_speed', name: L('Неуловимая скорость', 'Untraceable Speed'), requires: { stats: { Dex: 17 }, feats: ['beyond_fast'] }, effects: [] },
  { id: 'strong_body', name: L('Крепкое тело', 'Strong Body'), requires: { stats: { Con: 15 } }, effects: [{ type: 'stat', stats: { Con: 1 }, cap: 20 }, { type: 'hpConMult', value: 2 }] },
  { id: 'human_wall', name: L('Живая стена', 'Human Wall'), requires: { stats: { Con: 17 }, feats: ['strong_body'] }, effects: [] },
  { id: 'resilient', name: L('Стойкий', 'Resilient'), repeatable: true, requires: { stats: { Con: 15 } }, effects: [{ type: 'hitDieStep', value: 1 }] },
  { id: 'astute_observation', name: L('Проницательность', 'Astute Observation'), requires: { stats: { Int: 15 } }, effects: [{ type: 'stat', stats: { Int: 1 }, cap: 20 }] },
  { id: 'analytical_mind', name: L('Аналитический ум', 'Analytical Mind'), requires: { stats: { Int: 17 }, feats: ['astute_observation'] }, effects: [] },
  { id: 'incredible_intuition', name: L('Невероятная интуиция', 'Incredible Intuition'), requires: { stats: { Wis: 15 } }, effects: [{ type: 'stat', stats: { Wis: 1 }, cap: 20 }] },
  { id: 'honed_psyche', name: L('Закалённая психика', 'Honed Psyche'), requires: { stats: { Wis: 17 }, feats: ['incredible_intuition'] }, effects: [] },
  { id: 'magnetising_charm', name: L('Притягательное обаяние', 'Magnetising Charm'), requires: { stats: { Cha: 15 } }, effects: [{ type: 'stat', stats: { Cha: 1 }, cap: 20 }, { type: 'dc', value: 1 }] },
  { id: 'overwhelming_presence', name: L('Подавляющее присутствие', 'Overwhelming Presence'), requires: { stats: { Cha: 17 }, feats: ['magnetising_charm'] }, effects: [{ type: 'dc', value: 2 }] },
  { id: 'slam_master', name: L('Мастер бросков', 'Slam Master'), requires: { stats: { Str: 16 } }, effects: [] },
  { id: 'acrobatic_fighter', name: L('Боец-акробат', 'Acrobatic Fighter'), requires: { stats: { Dex: 16 } }, effects: [] },
  { id: 'protector', name: L('Защитник', 'Protector'), requires: { anyStats: [{ Dex: 16 }, { Con: 16 }] }, effects: [] },
  { id: 'hardblood_arts', name: L('Искусства затвердевшей крови', 'Hardblood Arts'), requires: { bloodfiend: true }, effects: [
    { type: 'pick', id: 'art', label: L('Искусство затвердевшей крови', 'Hardblood Art'), parse: 'bullets', from: 'self', range: [0, 5] },
  ] },
  { id: 'big_sibling', name: L('Старший брат', 'Big Sibling'), requires: { level: 19, archetype: [22] }, effects: [] },
  { id: 'imperfect_replica', name: L('Несовершенная копия', 'Imperfect Replica'), requires: { level: 19, archetype: [23] }, effects: [] },
  { id: 'workshop_enthusiast', name: L('Энтузиаст мастерских', 'Workshop Enthusiast'), requires: { level: 4 }, effects: [{ type: 'slot', slot: 'workshop', value: 1 }] },
  { id: 'aimed_shots', name: L('Прицельные выстрелы', 'Aimed Shots'), requires: { stats: { Dex: 15 } }, effects: [] },
  { id: 'firearm_adept', name: L('Знаток огнестрела', 'Firearm Adept'), requires: { stats: { Dex: 16 }, text: true }, effects: [] },
  { id: 'blade_master', name: L('Мастер клинка', 'Blade Master'), requires: { anyStats: [{ Dex: 16 }, { Str: 16 }] }, effects: [] },
  { id: 'piercer', name: L('Пронзатель', 'Piercer'), requires: { anyStats: [{ Str: 16 }, { Dex: 16 }] }, effects: [] },
  { id: 'bludgeoner', name: L('Дробитель', 'Bludgeoner'), requires: { stats: { Str: 16 } }, effects: [] },
  { id: 'sole_status', name: L('Единственный статус', 'Sole Status'), background: true, effects: [] },
  { id: 'sin_affinity', name: L('Сродство с грехом', 'Sin Affinity'), requires: { level: 4 }, effects: [
    { type: 'pick', id: 'sin', label: L('Грех', 'Sin'), parse: 'bullets', from: 'self', range: [0, 7] },
    { type: 'pick', id: 'vuln', label: L('Уязвимость к греху', 'Sin vulnerability'),
      options: [L('Гнев', 'Wrath'), L('Похоть', 'Lust'), L('Лень', 'Sloth'), L('Зависть', 'Envy'), L('Уныние', 'Gloom'), L('Чревоугодие', 'Gluttony'), L('Гордыня', 'Pride')] },
  ] },
  { id: 'advanced_sin_affinity', name: L('Продвинутое сродство с грехом', 'Advanced Sin Affinity'), requires: { feats: ['sin_affinity'] }, effects: [
    { type: 'pick', id: 'sin2', label: L('Второй грех (I уровня)', 'Second sin (level I)'),
      options: [L('Гнев', 'Wrath'), L('Похоть', 'Lust'), L('Лень', 'Sloth'), L('Зависть', 'Envy'), L('Уныние', 'Gloom'), L('Чревоугодие', 'Gluttony'), L('Гордыня', 'Pride')] },
  ] },
  { id: 'mastered_sin_affinity', name: L('Совершенное сродство с грехом', 'Mastered Sin Affinity'), requires: { feats: ['advanced_sin_affinity'] }, effects: [
    { type: 'pick', id: 'sin3', label: L('Третий грех (I уровня)', 'Third sin (level I)'),
      options: [L('Гнев', 'Wrath'), L('Похоть', 'Lust'), L('Лень', 'Sloth'), L('Зависть', 'Envy'), L('Уныние', 'Gloom'), L('Чревоугодие', 'Gluttony'), L('Гордыня', 'Pride')] },
  ] },
  { id: 'shin_and_mang', name: L('Шин и Ман', 'Shin and Mang'), requires: { level: 9 }, effects: [] },
  { id: 'improved_shin_and_mang', name: L('Улучшенные Шин и Ман', 'Improved Shin and Mang'), requires: { feats: ['shin_and_mang'] }, effects: [] },
  { id: 'mastered_shin_and_mang', name: L('Совершенные Шин и Ман', 'Mastered Shin and Mang'), requires: { feats: ['improved_shin_and_mang'] }, effects: [] },
  { id: 'ego_weapon', name: L('Э.Г.О.-оружие', 'E.G.O Weapon'), requires: { notFeats: ['efflorescent_ego'] }, effects: [{ type: 'egoAttack' }] },
  { id: 'manifest_ego', name: L('Проявление Э.Г.О.', 'Manifest E.G.O'), requires: { level: 12, feats: ['ego_weapon'] }, effects: [
    { type: 'note', text: L('Во время проявления Э.Г.О.: +2 к каждой характеристике (временно, в расчёт не входит).',
      'While the E.G.O. is manifested: +2 to every ability score (temporary, not included in the totals).') },
  ] },
  { id: 'volatile_ego', name: L('Нестабильное Э.Г.О.', 'Volatile E.G.O.'), requires: { notFeats: ['ego_weapon'], text: true }, effects: [{ type: 'egoForm', form: 'volatile' }] },
  { id: 'efflorescent_ego', name: L('Расцветшее Э.Г.О.', 'Efflorescent E.G.O.'), requires: { notFeats: ['ego_weapon'] }, effects: [{ type: 'egoForm', form: 'efflorescent' }] },
];

/* =====================================================================
   РАСЫ
   ===================================================================== */
const RACES = [
  { id: 'human', name: L('Человек', 'Human'), speed: 30,
    traits: [
      [L('Характеристики', 'Ability Scores'), L('Увеличьте значение каждой характеристики на 1.', 'Increase each of your ability scores by 1.')],
      [L('Возраст и Мировоззрение', 'Age and Alignment'), L('Люди достигают совершеннолетия к 20 годам и живут меньше века. Не имеют склонности к определенному мировоззрению.', 'Humans reach adulthood by 20 and live less than a century. They have no tendency toward a particular alignment.')],
      [L('Размер и Скорость', 'Size and Speed'), L('Размер: Средний (Medium). Базовая скорость ходьбы: 30 футов.', 'Size: Medium. Base walking speed: 30 feet.')],
      [L('Языки', 'Languages'), L('Общий язык и один дополнительный на ваш выбор.', 'Common and one extra language of your choice.')],
    ],
    effects: [{ type: 'stat', stats: each(ALL, 1) }] },
  { id: 'variant_human', name: L('Человек (вариант)', 'Human (variant)'), speed: 30,
    traits: [
      [L('Характеристики', 'Ability Scores'), L('Увеличьте значения двух разных характеристик на 1.', 'Increase two different ability scores of your choice by 1.')],
      [L('Навык', 'Skill'), L('Вы получаете владение одним навыком на ваш выбор.', 'You gain proficiency in one skill of your choice.')],
      [L('Черта', 'Feat'), L('Вы получаете одну черту на ваш выбор, требованиям которой соответствуете.', 'You gain one feat of your choice whose requirements you meet.')],
      [L('Размер и Скорость', 'Size and Speed'), L('Размер: Средний (Medium). Базовая скорость ходьбы: 30 футов.', 'Size: Medium. Base walking speed: 30 feet.')],
      [L('Языки', 'Languages'), L('Общий язык и один дополнительный на ваш выбор.', 'Common and one extra language of your choice.')],
    ],
    effects: [
      { type: 'statChoice', id: 'asi', label: L('Две характеристики +1', 'Two ability scores +1'), amount: 1, count: 2, options: ALL },
      { type: 'featSlot', id: 'vh', label: L('Черта вариантного человека', 'Variant human feat') },
    ] },
  { id: 'bloodfiend', name: L('Кровавый Демон', 'Bloodfiend'), speed: 35, bloodfiend: true,
    traits: [
      [L('Физиология', 'Physiology'), L('Бледная кожа, красные глаза. Бессмертны от старости. Склонны к Законопослушному Злому мировоззрению (Lawful Evil). Размер Средний.', 'Pale skin, red eyes. They do not die of old age. They tend toward Lawful Evil. Size Medium.')],
      [L('Характеристики и Скорость', 'Ability Scores and Speed'), L('+1 к Силе, Ловкости и Телосложению. Скорость: 35 футов.', '+1 to Strength, Dexterity and Constitution. Speed: 35 feet.')],
      [L('Мощное телосложение', 'Powerful Build'), L('Значительно сильнее людей. Вы получаете черту Powerful Build.', 'Much stronger than humans. You gain the Powerful Build trait.')],
      [L('Клыки (Fangs)', 'Fangs'), L('Ваш укус — природное оружие, наносящее 1d4 + модификатор СИЛ или ЛОВ колющего урона.', 'Your bite is a natural weapon that deals 1d4 + STR or DEX modifier piercing damage.')],
      [L('Жажда крови (Bloodthirst)', 'Bloodthirst'), L('Вам необходимо потреблять 12 унций человеческой крови в день для когнитивной стабильности. Если не пить 3 дня — спасбросок Мудрости от краткосрочного безумия. Через неделю — от долгосрочного. Кровь животных заменяет человеческую по курсу 48 к 12 унциям, но спасает максимум на неделю. Семья более 10 сородичей снимает помеху со спасбросков безумия.', 'You must consume 12 ounces of human blood a day to stay cognitively stable. After 3 days without it — a Wisdom save against short-term madness; after a week — against long-term madness. Animal blood replaces human blood at 48 to 12 ounces, but lasts a week at most. A family of more than 10 kindred removes disadvantage on madness saves.')],
      [L('Регенерация', 'Regeneration'), L('Бонусным действием можно тратить Кости Хитов для лечения. Макс. за раз: половина модификатора ТЕЛ (округленно вниз) + ПБ. Не работает при голоде. За каждую потраченную кость нужно выпить 1 доп. унцию крови в этот день.', 'As a bonus action you can spend Hit Dice to heal. Max at once: half your CON modifier (rounded down) + PB. Does not work while starving. For each die spent you must drink 1 extra ounce of blood that day.')],
      [L('Ранг сородича (Kindred Ranking)', 'Kindred Ranking'), L('Вы подчиняетесь сородичу, который вас обратил (ваш ранг на 1 ниже его). Приказы высших сородичей — закон (провал спасброска МУД означает Испуг). Нанесение вреда высшему сородичу мгновенно вызывает Испуг и Оглушение, если только вы не страдаете от безумия из-за голода по его вине. На 17-м уровне вы можете обратить до 2-х людей.', 'You obey the kindred who turned you (your rank is 1 below theirs). Orders from higher kindred are law (a failed WIS save means Frightened). Harming a higher kindred instantly causes Frightened and Stunned, unless you suffer from hunger madness through their fault. At 17th level you can turn up to 2 humans.')],
      [L('Языки', 'Languages'), L('Общий язык и один дополнительный на ваш выбор.', 'Common and one extra language of your choice.')],
    ],
    effects: [{ type: 'stat', stats: each(PHYS, 1) }] },
  { id: 'half_distortion', name: L('Полу-Искажение', 'Half-Distortion'), speed: 30,
    traits: [
      [L('Физиология', 'Physiology'), L('Сохраняют черты оригинальной расы, но имеют метафизические признаки (обычно отражающие травму или грех). Увеличенный срок жизни (до х2 от оригинала). Размер оригинальной расы.', 'They keep the traits of their original race but have metaphysical marks (usually reflecting a trauma or sin). Extended lifespan (up to x2 of the original). Size of the original race.')],
      [L('Характеристики и Скорость', 'Ability Scores and Speed'), L('+1 к Силе ИЛИ Ловкости, +1 к Телосложению, +1 к Мудрости. Скорость: 30 футов.', '+1 to Strength OR Dexterity, +1 to Constitution, +1 to Wisdom. Speed: 30 feet.')],
      [L('Искаженный (Distorted)', 'Distorted'), L('Выберите 1 расовую черту вашей оригинальной расы (если это Человек — используйте черту Вариантного Человека). Этот выбор нельзя изменить.', 'Choose 1 racial trait of your original race (if Human — use the Variant Human feat). This choice cannot be changed.')],
      [L('Искушение (Temptation)', 'Temptation'), L('Вы поддались искушению Кармен. Вы получаете черту Сродство с Грехом (Sin Affinity) для греха, из-за которого исказились. Однако вы получаете уязвимость (х2 урон) к противоположному Греху (тому, от чего вы пытались сбежать).', 'You gave in to Carmen\'s temptation. You gain the Sin Affinity feat for the sin that distorted you. However, you gain vulnerability (x2 damage) to the opposite Sin (the one you tried to escape).')],
      [L('Аномалия (Anomaly)', 'Anomaly'), L('Вы чувствуете присутствие других искажений или аномалий. Преимущество на проверки Восприятия и Расследования для их идентификации.', 'You sense the presence of other distortions or abnormalities. Advantage on Perception and Investigation checks to identify them.')],
      [L('Языки', 'Languages'), L('Общий язык и один дополнительный на ваш выбор.', 'Common and one extra language of your choice.')],
    ],
    effects: [
      { type: 'statChoice', id: 'sd', label: L('Сила или Ловкость +1', 'Strength or Dexterity +1'), amount: 1, count: 1, options: ['Str', 'Dex'] },
      { type: 'stat', stats: { Con: 1, Wis: 1 } },
      { type: 'grantFeat', feat: 'sin_affinity', ignoreReq: true },
      { type: 'choice', id: 'origin', label: L('Оригинальная раса', 'Original race'),
        options: [L('Человек', 'Human'), L('Кровавый Демон', 'Bloodfiend')],
        optionEffects: {
          0: [{ type: 'featChoice', id: 'vh', label: L('Черта вариантного человека', 'Variant human feat'), any: true }],
          1: [{ type: 'pick', id: 'trait', label: L('Расовая черта Кровавого Демона', 'Bloodfiend racial trait'),
            options: [L('Мощное телосложение', 'Powerful Build'), L('Клыки (Fangs)', 'Fangs'), L('Регенерация', 'Regeneration'), L('Скорость 35 футов', 'Speed 35 feet')] }],
        } },
    ] },
];

/* =====================================================================
   ОСНОВНЫЕ КЛАССЫ
   ===================================================================== */
const ABNORMAL = ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha'];
const abnormalEffects = Object.fromEntries(ABNORMAL.map((s, i) => {
  const eff = [
    { type: 'stat', stats: { [s]: 1 }, cap: 22, level: 7 },
    { type: 'stat', stats: { [s]: 1 }, cap: 22, level: 14 },
    { type: 'statMaxPlus', stats: { [s]: 2 }, level: 20 },
    { type: 'stat', stats: { [s]: 2 }, cap: 24, level: 20 },
  ];
  if (s === 'Dex') eff.push({ type: 'speed', value: 10, level: 2 }, { type: 'speed', value: 10, level: 7 }, { type: 'speed', value: 15, level: 14 });
  if (s === 'Con') eff.push({ type: 'hpPerLevel', value: 1, level: 7 });
  if (s === 'Int' || s === 'Wis' || s === 'Cha') eff.push({ type: 'light', value: 1, level: 2 }, { type: 'light', value: 1, level: 7 }, { type: 'light', value: 2, level: 14 });
  return [i, eff];
}));

const BASES = [
  { id: 'fixer', file: 'fixer.json', archetypes: 'classes.json', hitDie: 10,
    name: L('Фиксер', 'Fixer'), archetypeLabel: L('Принадлежность Фиксера', 'Fixer Affiliation'),
    dcStats: ['Str', 'Dex'], hide: [0, 1, 2, 3, 22],
    effects: [
      { type: 'featSlot', id: 'bg', level: 1, label: L('Черта предыстории', 'Background feat'), filter: { background: true } },
      { type: 'pickList', id: 'style', label: L('Боевой стиль', 'Fighting Style'), talent: 8, parse: 'bold', levels: [2, 10] },
      { type: 'choice', id: 'abnormal', slot: true, level: 2, label: L('Аномальная способность', 'Abnormal Ability'), talent: 9, parse: 'bold', optionEffects: abnormalEffects },
      { type: 'choice', id: 'lightStat', slot: true, level: 2, label: L('Характеристика Света', 'Light ability'),
        options: [L('Интеллект', 'Intelligence'), L('Мудрость', 'Wisdom'), L('Харизма', 'Charisma')],
        optionEffects: { 0: [{ type: 'lightStat', stat: 'Int' }], 1: [{ type: 'lightStat', stat: 'Wis' }], 2: [{ type: 'lightStat', stat: 'Cha' }] } },
      { type: 'pickList', id: 'light', label: L('Техника Света', 'Light technique'), talent: 10, parse: 'bullets', levels: [2, 2, 4, 8, 12, 16, 19] },
      ...[4, 8, 12, 16, 19].map((lv) => ({ type: 'asiSlot', id: `asi${lv}`, level: lv })),
      { type: 'featSlot', id: 'growth9', level: 9, label: L('Личностный рост', 'Personal Development') },
      { type: 'featSlot', id: 'growth15', level: 15, label: L('Личностный рост', 'Personal Development') },
      { type: 'egoTiers' },
    ] },
  { id: 'bloodfiend', file: 'bloodfiend.json', archetypes: 'bloodarch.json', hitDie: 12, bloodfiend: true,
    name: L('Кровавый демон-сородич', 'Kindred Bloodfiend'), archetypeLabel: L('Род (принадлежность)', 'Kindred (affiliation)'),
    dcStats: ['Str', 'Dex'], hide: [0, 1, 2, 3],
    effects: [
      { type: 'featSlot', id: 'bg', level: 1, label: L('Черта предыстории', 'Background feat'), filter: { background: true } },
      { type: 'stat', stats: each(PHYS, 2), level: 1, talent: 4 },
      { type: 'speed', value: 10, level: 1, talent: 4 },
      { type: 'pickList', id: 'style', label: L('Боевой стиль', 'Fighting Style'), talent: 7, parse: 'bold', levels: [2, 10] },
      { type: 'choice', id: 'lightStat', slot: true, level: 2, label: L('Характеристика Света', 'Light ability'),
        options: [L('Интеллект', 'Intelligence'), L('Мудрость', 'Wisdom'), L('Харизма', 'Charisma')],
        optionEffects: { 0: [{ type: 'lightStat', stat: 'Int' }], 1: [{ type: 'lightStat', stat: 'Wis' }], 2: [{ type: 'lightStat', stat: 'Cha' }] } },
      { type: 'pickList', id: 'light', label: L('Техника Света', 'Light technique'), talent: 8, parse: 'bullets', levels: [2, 2, 4, 8, 12, 16, 19] },
      ...[4, 6, 8, 10, 12, 16, 19].map((lv) => ({ type: 'asiSlot', id: `asi${lv}`, level: lv })),
      { type: 'grantFeat', feat: 'hardblood_arts', level: 4 },
      { type: 'stat', stats: each(PHYS, 1), level: 7 },
      { type: 'speed', value: 10, level: 7 },
      { type: 'stat', stats: each(PHYS, 1), level: 14 },
      { type: 'statMaxPlus', stats: each(ALL, 2), level: 14 },
      { type: 'speed', value: 10, level: 14 },
      { type: 'stat', stats: each(ALL, 1), level: 20 },
      { type: 'speed', value: 10, level: 20 },
      { type: 'egoTiers' },
    ] },
];

/* Имена родов (bloodarch.json) — ключи ARCHETYPES['bloodarch.json'] ниже — индексы в этом списке */
const BLOODARCH_NAMES = [
  L('Род Королевской крови', 'Kindred of Royalty'),
  L('Род Злобы', 'Kindred of Malice'),
  L('Род Ненависти', 'Kindred of Rancor'),
];

/* Архетипы: ключ — поле No из classes.json или индекс в bloodarch.json */
const ARCHETYPES = {
  'classes.json': {
    1: [ // Фрилансер
      ...[1, 6, 10, 13, 17].map((lv) => ({ type: 'featSlot', id: `free${lv}`, level: lv, label: L('Сам себе прикрытие', 'Own Cover') })),
      { type: 'statChoice', id: 'tricks', level: 3, label: L('Фокусы для публики: +1', 'Tricks for the Crowd: +1'), amount: 1, count: 1, options: ALL },
      { type: 'slot', slot: 'workshop', value: 1, level: 10 },
      { type: 'statChoice', id: 'peak', level: 17, label: L('Фиксер на пике: +2 (и максимум +2)', 'Peak Fixer: +2 (and max +2)'), amount: 2, count: 1, options: ALL, maxPlus: 2 },
      { type: 'stat', stats: each(ALL, 1), level: 17 },
    ],
    2: [ // Остаток Лоботомии
      { type: 'choice', id: 'team', level: 6, label: L('Отдел (Руководитель команды)', 'Department (Team Leader)'), talentLevel: 6, parse: 'bullets',
        optionEffects: { 2: [{ type: 'asiSlot', id: 'team', noFeat: true, level: 6 }], 3: [{ type: 'hpPerLevel', value: 1 }], 4: [{ type: 'speed', value: 10 }] } },
      { type: 'stat', stats: each(ALL, 2), level: 17 },
      { type: 'statMaxPlus', stats: each(ALL, 2), level: 17 },
    ],
    5: [{ type: 'grantFeat', feat: 'protector', ignoreReq: true, level: 1 }],
    6: [{ type: 'grantFeat', feat: 'protector', ignoreReq: true, level: 1 }],
    16: [{ type: 'speed', value: 10, level: 1 }],
    30: [{ type: 'hitDie', value: 6, level: 1 }],
    37: [{ type: 'speed', value: 10, level: 1 }],
    41: [{ type: 'bloodfiend' }],
    46: [{ type: 'speed', value: 10, level: 1 }],
    47: [
      { type: 'statChoice', id: 'captain', level: 17, label: L('Капитан: Сила или Ловкость +2 (и максимум)', 'Captain: Strength or Dexterity +2 (and max)'), amount: 2, count: 1, options: ['Str', 'Dex'], maxPlus: 2 },
      { type: 'stat', stats: { Con: 2 }, level: 17 },
      { type: 'statMaxPlus', stats: { Con: 2 }, level: 17 },
    ],
  },
  'bloodarch.json': {
    0: [ // Род Королевской крови
      { type: 'stat', stats: { Cha: 2 }, level: 1, cap: 24 },
      { type: 'statMax', stats: { Cha: 24 }, level: 1 },
      { type: 'note', text: L('Владение двумя навыками Харизмы на выбор.', 'Proficiency in two Charisma skills of your choice.') },
    ],
    1: [ // Род Злобы
      { type: 'statMax', stats: each(ALL, 24), level: 1 },
      { type: 'stat', stats: each(PHYS, 2), level: 1 },
      { type: 'speed', value: 5, level: 1 },
      { type: 'featSlot', id: 'malice', level: 1, label: L('Бесплатная черта Тела', 'Free Body feat'), filter: { base: ['Body'] } },
      { type: 'stat', stats: each(PHYS, 1), level: 3 },
      { type: 'stat', stats: each(PHYS, 1), level: 6 },
      { type: 'speed', value: 10, level: 6 },
      { type: 'stat', stats: { Str: 2, Con: 2 }, level: 10 },
      { type: 'stat', stats: { Dex: 2 }, level: 13 },
      { type: 'statMax', stats: each(PHYS, 30), level: 13 },
      { type: 'speed', value: 30, level: 13 },
      { type: 'stat', stats: each(PHYS, 2), level: 17 },
    ],
    2: [ // Род Ненависти
      { type: 'suppress', talent: 4, level: 1 },
      { type: 'grantFeat', feat: 'resilient', level: 1, ignoreReq: true },
    ],
  },
};

/* Снаряжение принадлежностей: No архетипа → индексы equipment.json (не-Э.Г.О.).
   Броня из списка — «униформа» принадлежности. Нет брони — по правилам Фиксера вместо неё любой артефакт. */
const GEAR = {
  4: [L('Адаптивное оружие Ханы', 'Hana\'s Adaptive Weaponry')],
  7: [L('Клинок Ассоциации Семь', 'Seven Section\'s Blade')],
  8: [L('Плащ Ассоциации Лю', 'Liu Association\'s Coat')],
  9: [L('Плащ Ассоциации Лю', 'Liu Association\'s Coat')],
  10: [L('Академическая стола Диечи', 'Dieci Academic Stole')],
  11: [L('Академическая стола Диечи', 'Dieci Academic Stole')],
  12: [L('Рапира Ассоциации Синк', 'Cinq Association\'s Rapier'), L('Стильная синяя шляпа Синка', 'Cinq\'s Stylish Blue Hat')],
  13: [L('Рапира Ассоциации Синк', 'Cinq Association\'s Rapier'), L('Стильная синяя шляпа Синка', 'Cinq\'s Stylish Blue Hat')],
  14: [L('Алебарда Ассоциации Уфи', 'Oufi Association Halberd'), L('Униформа Ассоциации Уфи', 'Oufi Association Uniform')],
  15: [L('Турумаги Рода Клинка', 'Blade Lineage Durumagi'), L('Бамбуковая шляпа', 'Bamboo Hat')],
  16: [L('Катана Клана Курокумо', 'Kurokumo Clan\'s Katana'), L('Одеяния Клана Курокумо', 'Kurokumo Clan Robes'), L('Ножны Клана Курокумо', 'Kurokumo Clan Sheath')],
  17: [L('Рубашка Банды ТинТан', 'TingTang Gang Shirt')],
  18: [L('Бита Мёртвых Кроликов', 'Dead Rabbits Bat'), L('Одежда Мёртвых Кроликов', 'Dead Rabbits Clothing')],
  20: [L('Дробовик авангарда Уджат', 'Udjat Vanguard Shotgun')],
  21: [L('Несанкционированное изобретение «Виброварка-Морф»', 'Vibroweld Morph Unauthorized Invention')],
  22: [L('Цепи Среднего Пальца', 'The Middle\'s Chains')],
  23: [L('Униформа Индекса', 'Index Uniform')],
  25: [L('Клинок Звезды Тяньтуй', 'Tiantui Star\'s Blade')],
  29: [L('Газовый гарпун', 'Gas Harpoon'), L('Шинель гарпунёра «Пекода»', 'Pequod Harpooner Overcoat')],
  30: [L('Серпы Чистильщиков', 'Sweeper Sickles')],
  37: [L('Катана Ассоциации Ши', 'Shi Association\'s Katana')],
  40: [L('Скованный гроб', 'Chained Coffin')],
  47: [L('Костюм отряда иссечения K-Корп', 'K-Corp Excision Team Suit')],
  48: [L('Винтовка и нож «Кроликов» R-Корп', 'R-Corp Rabbit Rifle and Knife'), L('Булава «Оленей» R-Корп', 'R-Corp Reindeer Mace'), L('Молот «Носорогов» R-Корп', 'R-Corp Rhino Hammer'), L('Усиленная батарея R-Корп', 'R-Corp Enhanced Battery')],
  50: [L('Огромный гвоздь N-Корп', 'N-Corp Oversized Nail'), L('Свирепый гвоздь N-Корп', 'N-Corp\'s Vicious Nail'), L('Доспех крестоносца N-Корп', 'N-Corp Crusader\'s Armor'), L('Маска крестоносца с жизнеобеспечением', 'Life Support Crusader Mask'), L('Грубые гвозди', 'Crude Nails')],
  53: [L('Проклятый тесак', 'Cursewrit Butcherblade')],
  54: [L('Посох ветви Сы Стаи Хэйшоу', 'Heishou Pack - Si Branch Staff')],
};

/* =====================================================================
   СБОРКА
   ===================================================================== */
const pickLang = (v, lang) => {
  if (Array.isArray(v)) return v.map((x) => pickLang(x, lang));
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 2 && keys.includes('ru') && keys.includes('en')) return v[lang];
    return Object.fromEntries(keys.map((k) => [k, pickLang(v[k], lang)]));
  }
  return v;
};
const LINK_RE = /`([^`\n]*?)::([^`\n]*)`/g;

const lower = (v) => String(v ?? '').trim().toLowerCase();
/** Индекс записи в файле канона: по id (если есть) или по имени на этом языке. */
function locate(list, ref, lang, what, file) {
  const name = typeof ref.name === 'object' ? ref.name[lang] : ref.name;
  let i = ref.id ? list.findIndex((x) => x && x.id === ref.id) : -1;
  if (i < 0) i = list.findIndex((x) => x && lower(x.Name) === lower(name));
  if (i < 0) throw new Error(`${file}: не найдена ${what} «${name}». Её переименовали? Поправьте name в scripts/gen-builder-data.mjs`);
  return i;
}

for (const [dir, lang] of Object.entries(LANGS)) {
  const feats = load(dir, 'feats.json');
  const equipment = load(dir, 'equipment.json');
  const classes = load(dir, 'classes.json');
  const featIdx = FEATS.map((meta) => locate(feats, meta, lang, 'черта', `${dir}/feats.json`));
  const nameToId = new Map(FEATS.map((meta, k) => [lower(feats[featIdx[k]].Name), meta.id]));
  const extra = feats.filter((f, i) => !featIdx.includes(i)).map((f) => f.Name);
  if (extra.length) console.warn(`gen-builder-data: ${dir}/feats.json — черты без метаданных (в конструкторе без авто-расчёта): ${extra.join(', ')}`);

  const featsOut = FEATS.map((meta, k) => {
    const i = featIdx[k];
    const f = feats[i];
    const links = { feats: [], other: [] };
    for (const m of String(f.desc || '').matchAll(LINK_RE)) {
      const id = nameToId.get(m[2].trim().toLowerCase());
      if (id && id !== meta.id) { if (!links.feats.includes(id)) links.feats.push(id); }
      else if (!id && !links.other.includes(m[2].trim())) links.other.push(m[2].trim());
    }
    for (const id of [...(meta.requires?.feats || []), ...(meta.requires?.notFeats || [])]) {
      if (!links.feats.includes(id)) links.feats.push(id);
    }
    return pickLang({
      id: meta.id, index: i, name: f.Name, base: f.Base || [],
      background: !!meta.background, repeatable: !!meta.repeatable,
      requires: meta.requires || {}, effects: meta.effects, links,
    }, lang);
  });
  writeFileSync(out(dir, 'Builder_feats.json'), JSON.stringify({
    _doc: lang === 'ru'
      ? 'Метаданные черт для Конструктора персонажа. Генерируется scripts/gen-builder-data.mjs — правьте генератор и перезапускайте его.'
      : 'Feat metadata for the Character Builder. Generated by scripts/gen-builder-data.mjs — edit the generator and re-run it.',
    feats: featsOut,
  }, null, 2) + '\n');

  writeFileSync(out(dir, 'Builder_races.json'), JSON.stringify({
    _doc: lang === 'ru' ? 'Расы для Конструктора персонажа. Генерируется scripts/gen-builder-data.mjs.' : 'Races for the Character Builder. Generated by scripts/gen-builder-data.mjs.',
    races: RACES.map((r) => pickLang({
      id: r.id, name: r.name, speed: r.speed, bloodfiend: !!r.bloodfiend,
      traits: r.traits.map(([name, desc]) => ({ name, desc })), effects: r.effects,
    }, lang)),
  }, null, 2) + '\n');

  const gear = {};
  for (const [no, items] of Object.entries(GEAR)) {
    gear[no] = items.map((name) => {
      const i = locate(equipment, { name }, lang, 'вещь снаряжения', `${dir}/equipment.json`);
      return { index: i, name: equipment[i].Name, type: equipment[i].ItemType };
    });
  }
  const archNames = Object.fromEntries(classes.map((c) => [c.No, c.Name]));
  const bloodarch = load(dir, 'bloodarch.json');
  writeFileSync(out(dir, 'Builder_classes.json'), JSON.stringify({
    _doc: lang === 'ru' ? 'Основные классы и архетипы для Конструктора персонажа. Генерируется scripts/gen-builder-data.mjs.' : 'Base classes and archetypes for the Character Builder. Generated by scripts/gen-builder-data.mjs.',
    egoTiers: [{ level: 4, rank: 4 }, { level: 8, rank: 5 }, { level: 12, rank: 6 }, { level: 16, rank: 7 }, { level: 19, rank: 8 }],
    bases: BASES.map((b) => pickLang(b, lang)),
    archetypes: {
      'classes.json': Object.fromEntries(Object.entries(ARCHETYPES['classes.json']).map(([no, eff]) => [no, { name: archNames[no], effects: pickLang(eff, lang) }])),
      'bloodarch.json': Object.fromEntries(Object.entries(ARCHETYPES['bloodarch.json']).map(([k, eff]) => {
        const i = locate(bloodarch, { name: BLOODARCH_NAMES[k] }, lang, 'род', `${dir}/bloodarch.json`);
        return [i, { name: bloodarch[i].Name, effects: pickLang(eff, lang) }];
      })),
    },
    gear,
  }, null, 2) + '\n');
  console.log(`gen-builder-data: ${dir} — ${featsOut.length} черт, ${RACES.length} рас, ${BASES.length} классов`);
}
