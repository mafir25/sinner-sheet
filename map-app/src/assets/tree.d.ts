import type { AssetEntry, DirNode } from '../model/types';

export const IMAGE_EXT: string[];
export const KINDS: string[];
export const BASE_PPC: number;
export function isImage(path: string): boolean;
export function dirOf(path: string): string;
export function baseOf(path: string): string;
export function prettyName(file: string): string;
export function normName(n: unknown, fallback: string): { ru: string; en: string };
export function svgSize(text: string): { w: number; h: number } | null;
export function pngSize(bytes: Uint8Array): { w: number; h: number } | null;
export function footprintFor(size: { w: number; h: number } | null, ppc?: number): [number, number];
export function buildPack(files: { path: string; size: { w: number; h: number } | null }[], metas?: Record<string, unknown>): { tree: DirNode; assets: AssetEntry[] };
export function findDir(tree: DirNode, path: string): DirNode | null;
export type ChainLevel = { kind: 'dir' | 'file'; options: string[]; value: string; dir?: string };
export function variantChain(tree: DirNode, assetPath: string): ChainLevel[];
export function firstAsset(node: DirNode | null): string | null;
export function switchDir(tree: DirNode, assets: AssetEntry[], oldPath: string, oldDir: string, newDir: string): string | null;
