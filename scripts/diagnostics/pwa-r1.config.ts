/** Local experiment only. The production SW policy is never changed here. */
import {defineConfig,loadConfigFromFile,mergeConfig} from 'vite';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createIntegratedPwaConfig} from './integrated-pwa.config';

export default defineConfig(async env=>{
  if(env.mode!=='staging'||process.env.VITE_SUPABASE_URL!=='https://integrated-fixture.invalid'||process.env.VITE_APPEARANCE_PILOT!=='true')throw Error('Synthetic local PWA build only');
  const policy=process.env.FINELO_PWA_R1_POLICY || 'current-prompt';
  if(!['original','proposed-prompt','current-prompt'].includes(policy))throw Error('Unknown local PWA experiment');
  let source;
  if(policy==='original'){
    // Historical means the immutable reviewed policy, not the current product.
    const root=process.cwd();
    const current=readFileSync(path.join(root,'vite.config.ts'),'utf8').replaceAll('\r\n','\n');
    const historical=readFileSync(path.join(root,'.pwa-r1-reviewed-vite.config.ts'),'utf8').replaceAll('\r\n','\n');
    if(createHash('sha256').update(historical).digest('hex')!=='91b292fd907c9ab5f79ee74e827f8ec1cc08282688638d38b25272ad624183c9' || current!==historical.replace('skipWaiting: true,','skipWaiting: false,'))throw Error('Historical policy or authorized product delta changed');
    const loaded=await loadConfigFromFile(env,path.join(root,'.pwa-r1-reviewed-vite.config.ts'),root,'silent');
    if(!loaded)throw Error('Cannot load frozen historical policy');
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
