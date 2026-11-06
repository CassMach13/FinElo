import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import type {ConfigEnv} from 'vite';
import experiment from '../../scripts/diagnostics/pwa-r1.config';

const factory=experiment as (env:ConfigEnv)=>Promise<any>;
function setup(mode='staging',flag='true',backend='https://integrated-fixture.invalid'){
  vi.stubEnv('VITE_APPEARANCE_PILOT',flag);
  vi.stubEnv('VITE_SUPABASE_URL',backend);
  vi.stubEnv('FINELO_PWA_R1_POLICY','proposed-prompt');
  vi.stubEnv('GEMINI_API_KEY','');
  return {command:'build',mode} as ConfigEnv;
}
afterEach(()=>vi.unstubAllEnvs());
describe('4D-R1: proposta isolada não muda a política publicada',()=>{
  it.each([
    ['production','true','https://integrated-fixture.invalid'],
    ['development','true','https://integrated-fixture.invalid'],
    ['staging','false','https://integrated-fixture.invalid'],
    ['staging','true','https://real.supabase.co'],
  ])('nega %s/%s/%s antes de ler a configuração proposta',async(mode,flag,backend)=>{
    await expect(factory(setup(mode,flag,backend))).rejects.toThrow('Synthetic local PWA build only');
  });
  it('recusa política desconhecida',async()=>{
    const env=setup();vi.stubEnv('FINELO_PWA_R1_POLICY','global-auto-update');
    await expect(factory(env)).rejects.toThrow('Unknown local PWA experiment');
  });
  it('a comparação original não depende da cópia de proposta',async()=>{
    const env=setup();vi.stubEnv('FINELO_PWA_R1_POLICY','original');
    const config=await factory(env);
    expect(config.build.outDir.replaceAll('\\','/')).toMatch(/node_modules\/\.finelo-cycle4d-tools\/pwa-dist$/);
    expect(config.plugins.flat().some((plugin:any)=>plugin.name==='pwa-r1-rendered-build-observer')).toBe(true);
  });
  it('preserva integralmente configuração e interface de produção aprovadas em c7f1a5c',()=>{
    const expected={
      'vite.config.ts':'91b292fd907c9ab5f79ee74e827f8ec1cc08282688638d38b25272ad624183c9',
      'src/components/pwa/ReloadPrompt.tsx':'b9aee0ed818acb214d29112452ca4b66456ca0a2a826dc7f69d9ed4650573b6f',
    };
    for(const[file,hash]of Object.entries(expected)){
      expect(createHash('sha256').update(readFileSync(file,'utf8').replaceAll('\r\n','\n')).digest('hex')).toBe(hash);
    }
  });
});
