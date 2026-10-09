export function mapUrl(id: string, name?: string): string;
export function mapMarkdown(id: string, name: string): string;
export function parseMapHash(hash: string): { id: string; name: string } | null;
export function siteLink(raw: string, origin?: string): { title: string; url: string } | null;
export function kbMarkdown(raw: string): string | null;
export function listLocalMaps(): Promise<{ id: string; name: string; updatedAt: number; thumb: string }[]>;
