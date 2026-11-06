/** Separate, loopback-only synthetic build. Never used by npm run build or deployment. */
import {defineConfig,mergeConfig}from'vite';
import base from'../../vite.config';
import{readFileSync}from'node:fs';
import path from'node:path';

export default defineConfig(async env=>{
 if(env.mode!=='staging'||process.env.VITE_SUPABASE_URL!=='https://integrated-fixture.invalid'||process.env.VITE_APPEARANCE_PILOT!=='true')throw Error('Synthetic local PWA build only');
 const original=typeof base==='function'?await base(env):await base;
 const root=process.cwd(),out=path.resolve(root,'node_modules/.finelo-cycle4d-tools/pwa-dist');
 if(!out.startsWith(root+path.sep))throw Error('Unexpected QA output directory');
 return mergeConfig(original,{build:{outDir:out},plugins:[{
  name:'synthetic-integrated-entry',enforce:'pre',
  transformIndexHtml:{order:'pre',handler:()=>readFileSync(path.join(root,'scripts/diagnostics/integrated-preview.html'),'utf8').replace('</head>',`<meta name="qa-build" content="${process.env.FINELO_QA_BUILD==='b'?'b':'a'}"></head>`)},
  transform(code,id){
   if(!id.replaceAll('\\','/').endsWith('/scripts/diagnostics/integrated-preview-runtime.tsx'))return;
   const needle="const{default:App}=await load('/App.tsx');";
   if(!code.includes(needle))throw Error('QA App import changed');
   return code.replace(needle,"const{default:App}=await import('../../src/App');");
  },
 }]});
});
