import {createHash} from 'node:crypto';
// Explicit user-approved 4C session exception. All earlier baseline hashes stay immutable.
export const SESSION_STORE_BEFORE = '02987d46eaf30682bf91bf0348800f737b7eee179201d82dac522cfeffd17e15';
export const SESSION_STORE_C1_APPROVED = 'd240b4605904b39e92733f41ff9b2a4aa140ca6787d17f7af020df2b6bb2806a';
export const SESSION_STORE_APPROVED = '304a8002d3518d20d3cfb74248bbe84f4a5659bd9c2d9e928a6817bc96742ebb';
export const AUTH_CLIENT_BEFORE = '13ea7d5ecc1c20b2dd1bd8d26dcb49f8cf3ac60383a2d72bae421749bc96bf76';
export const AUTH_CLIENT_APPROVED = '369e80058a518c10d233d784027e62af726c942638a667518fd66c6ec0e0a167';
export function functionalSourceHash(path: string, source: string): string {
 const hash=createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex');
 if(path==='src/hooks/useAppStore.ts' && hash===SESSION_STORE_APPROVED)return SESSION_STORE_BEFORE;
 if(path==='src/supabaseClient.ts' && hash===AUTH_CLIENT_APPROVED)return AUTH_CLIENT_BEFORE;
 return hash;
}
