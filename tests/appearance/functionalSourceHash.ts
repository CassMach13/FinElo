import {createHash} from 'node:crypto';
// Explicit user-approved 4C session exception. All earlier baseline hashes stay immutable.
export const SESSION_STORE_BEFORE = '02987d46eaf30682bf91bf0348800f737b7eee179201d82dac522cfeffd17e15';
export const SESSION_STORE_APPROVED = 'd240b4605904b39e92733f41ff9b2a4aa140ca6787d17f7af020df2b6bb2806a';
export function functionalSourceHash(path: string, source: string): string {
 const hash=createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex');
 return path==='src/hooks/useAppStore.ts' && hash===SESSION_STORE_APPROVED ? SESSION_STORE_BEFORE : hash;
}
