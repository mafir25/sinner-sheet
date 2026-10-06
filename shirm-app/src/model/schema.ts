// Модель данных Ширмы v2.
// Каждый объект на доске — отдельный «item»: узел, рамка или связь.
// В Firestore каждый item хранится отдельным документом (обход лимита 1 МБ на документ).
import { z } from 'zod';

export const SCHEMA_VERSION = 2;

const color = z.string().regex(/^#[0-9a-fA-F]{3,8}$/).catch('#40E0D0');

export const TagSchema = z.object({
  text: z.string().max(80),
  color,
});
export type Tag = z.infer<typeof TagSchema>;

export type Section = {
  id: string;
  title: string;
  aliases: string[];
  body: string;
  children: Section[];
};
export const SectionSchema: z.ZodType<Section> = z.lazy(() =>
  z.object({
    id: z.string(),
    title: z.string().catch(''),
    aliases: z.array(z.string()).catch([]),
    body: z.string().catch(''),
    children: z.array(SectionSchema).catch([]),
  }),
);

export const NodeSchema = z.object({
  kind: z.literal('node'),
  id: z.string(),
  title: z.string().catch(''),
  titleColor: color.optional(),
  aliases: z.array(z.string()).catch([]),
  tags: z.array(TagSchema).catch([]),
  body: z.string().catch(''),
  sections: z.array(SectionSchema).catch([]),
  shape: z.enum(['circle', 'square', 'icon']).catch('circle'),
  color,
  size: z.number().min(0.4).max(4).catch(1),
  image: z.string().catch(''),
  x: z.number().catch(0),
  y: z.number().catch(0),
  frameId: z.string().nullable().catch(null),
  hidden: z.boolean().catch(false),
});
export type NodeItem = z.infer<typeof NodeSchema>;

export const FrameSchema = z.object({
  kind: z.literal('frame'),
  id: z.string(),
  title: z.string().catch(''),
  color,
  variant: z.enum(['frame', 'image']).catch('frame'),
  image: z.string().catch(''),
  // левый верхний угол и размер
  x: z.number().catch(0),
  y: z.number().catch(0),
  w: z.number().min(20).catch(200),
  h: z.number().min(20).catch(200),
  hidden: z.boolean().catch(false),
});
export type FrameItem = z.infer<typeof FrameSchema>;

export const LinkSchema = z.object({
  kind: z.literal('link'),
  id: z.string(),
  from: z.string(),
  to: z.string(),
  label: z.string().catch(''),
  color,
  hidden: z.boolean().catch(false),
});
export type LinkItem = z.infer<typeof LinkSchema>;

export const ItemSchema = z.discriminatedUnion('kind', [NodeSchema, FrameSchema, LinkSchema]);
export type Item = NodeItem | FrameItem | LinkItem;
export type ItemMap = Record<string, Item>;

/** Проверяет item и подставляет значения по умолчанию. Возвращает null, если item не спасти. */
export function parseItem(raw: unknown): Item | null {
  const r = ItemSchema.safeParse(raw);
  return r.success ? (r.data as Item) : null;
}

export type AccessLevel = 'private' | 'friends' | 'public';

export type ScreenMeta = {
  id: string;
  name: string;
  creatorEmail: string;
  accessLevel: AccessLevel;
  allowedUsers: string[];
  adminUsers: string[];
  schemaVersion: number;
  /** базовый мир из world.json (канон): правят только Админы с правом на раздел «Мир» */
  isLocal?: boolean;
  /** для базового мира: items уже внутри */
  localItems?: ItemMap;
  /** для базового мира: id ширмы внутри world.json и её исходный JSON (чтобы заметить чужие правки) */
  baseId?: string;
  baseRaw?: string;
  /** для базового мира: текущий пользователь может править канон */
  canonEdit?: boolean;
  /** старый формат (v1), если ширма ещё не переведена */
  legacyGraph?: unknown;
  /** у переведённой ширмы ещё лежит старая копия graphData */
  hasLegacyData?: boolean;
};

export const uid = (p = 'i') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function emptyNode(x: number, y: number): NodeItem {
  return {
    kind: 'node', id: uid('n'), title: '', aliases: [], tags: [], body: '', sections: [],
    shape: 'circle', color: '#40E0D0', size: 1, image: '', x, y, frameId: null, hidden: false,
  };
}

export function emptySection(): Section {
  return { id: uid('s'), title: '', aliases: [], body: '', children: [] };
}

/** Размер узла на доске (px в координатах мира). */
export const NODE_BASE = 22;
export const nodeRadius = (n: { size: number }) => (NODE_BASE * n.size) / 2;

export const isNode = (i: Item | undefined): i is NodeItem => !!i && i.kind === 'node';
export const isFrame = (i: Item | undefined): i is FrameItem => !!i && i.kind === 'frame';
export const isLink = (i: Item | undefined): i is LinkItem => !!i && i.kind === 'link';
