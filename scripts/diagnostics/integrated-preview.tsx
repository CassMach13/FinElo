import {isIntegratedQaAllowed} from './integrated-qa-gate';
if(!isIntegratedQaAllowed(import.meta.env.MODE,import.meta.env.VITE_APPEARANCE_PILOT,location.hostname,import.meta.env.VITE_SUPABASE_URL))throw Error('QA integrado indisponível fora do loopback sintético autorizado.');
// Native browser storage and BroadcastChannel are deliberately preserved for multi-tab tests.
const nativeFetch=fetch.bind(globalThis);
globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.origin);if(u.origin===location.origin||u.origin==='https://integrated-fixture.invalid')return nativeFetch(input,init);return Promise.reject(new Error('Rede externa bloqueada pelo QA local'));};
await import('./integrated-preview-runtime');
