/** Local experiment only. The production SW policy is never changed here. */
import {defineConfig,loadConfigFromFile,mergeConfig} from 'vite';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {createIntegratedPwaConfig} from './integrated-pwa.config';

export default defineConfig(async env=>{
  if(env.mode!=='staging'||process.env.VITE_SUPABASE_URL!=='https://integrated-fixture.invalid'||process.env.VITE_APPEARANCE_PILOT!=='true')throw Error('Synthetic local PWA build only');
  const policy=process.env.FINELO_PWA_R1_POLICY || 'original';
  if(!['original','proposed-prompt'].includes(policy))throw Error('Unknown local PWA experiment');
  let source;
  if(policy==='proposed-prompt'){
    // This disposable sibling preserves the production config's relative imports.
    // The runner verifies it differs ONLY by skipWaiting:false, then removes it.
    const root=process.cwd();
    const original=readFileSync(path.join(root,'vite.config.ts'),'utf8');
    const proposal=readFileSync(path.join(root,'.pwa-r1-proposed-vite.config.ts'),'utf8');
    if(original.split('skipWaiting: true,').length!==2 || proposal!==original.replace('skipWaiting: true,','skipWaiting: false,'))throw Error('Proposal is not the one-line reviewed experiment');
    const loaded=await loadConfigFromFile(env,path.join(root,'.pwa-r1-proposed-vite.config.ts'),root,'silent');
    if(!loaded)throw Error('Cannot load isolated proposal');
    source=loaded.config;
  }
  const original=await createIntegratedPwaConfig(env,source);
  const revision=process.env.FINELO_QA_BUILD==='b'?'b':'a';
  return mergeConfig(original,{plugins:[{
    name:'pwa-r1-rendered-build-observer',
    transform(code,id){
      if(id.replaceAll('\\','/').endsWith('/scripts/diagnostics/integrated-preview-runtime.tsx')){
        // Marker is executed by the compiled runtime, independent of the HTML meta.
        return code+`\ndocument.documentElement.dataset.pwaR1Build=${JSON.stringify(revision)};`;
      }
    },
    transformIndexHtml:{order:'post',handler:()=>[{tag:'meta',attrs:{name:'qa-pwa-policy',content:policy},injectTo:'head'}]},
  }]});
});
