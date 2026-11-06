import {functionalSourceHash} from './functionalSourceHash';import{readFileSync}from'node:fs';import{describe,it,expect}from'vitest';import baseline from './investment-presentation-baseline.json';import{financialImplementationFingerprint}from'./financialPresentationFingerprint';
import postcss from 'postcss';
describe('Ciclo4B conserva contratos e dados de investimentos/patrimônio',()=>{
 it.each(Object.entries(baseline.files))('%s preserva classes, geometria e implementação financeira',(path,sha)=>{expect(financialImplementationFingerprint(path,readFileSync(path,'utf8'),baseline.additionalPresentationAttributes,baseline.additionalPresentationComponents)).toBe(sha)});
 it('preserva os160 módulos de finanças, ownership, importação e infraestrutura selados',()=>{expect(Object.fromEntries(Object.keys(baseline.financialSources).map(p=>[p,functionalSourceHash(p,readFileSync(p,'utf8'))]))).toEqual(baseline.financialSources)});
 it('recria somente a tela de investimentos por sessão, sem mudar o restante do MainLayout',()=>{
  const source=readFileSync(baseline.sessionEntry.path,'utf8');
  expect(source.match(/investments: <InvestmentsView key=\{user\?\.id\} \/>/g)).toHaveLength(1);
  const original=source.replace('investments: <InvestmentsView key={user?.id} />','investments: <InvestmentsView />');
  expect(financialImplementationFingerprint(baseline.sessionEntry.path,original,baseline.additionalPresentationAttributes,baseline.additionalPresentationComponents)).toBe(baseline.sessionEntry.fingerprint);
 });
 it('restringe as adaptações de pintura à tela e ao Claro, sem propriedades geométricas',()=>{
  const css=postcss.parse(readFileSync('src/components/appearance/investments.css','utf8'));
  const paint=new Set(['color','background','background-color','background-image','border-color','box-shadow','fill','stroke','stop-color','opacity','outline','outline-offset','visibility','pointer-events']);
  css.walkRules(rule=>{
   expect(rule.parent?.type).toBe('atrule');expect((rule.parent as postcss.AtRule).name).toBe('media');expect((rule.parent as postcss.AtRule).params).toBe('screen');
   rule.walkDecls(decl=>expect(paint.has(decl.prop),decl.prop).toBe(true));
   for(const selector of rule.selectors){
    if(selector.includes('[data-finelo-theme="light"]'))continue;
    expect(selector).toMatch(/investment-(hint|menu|chart-tooltip)/);
    rule.walkDecls(decl=>expect(['visibility','opacity','pointer-events']).toContain(decl.prop));
   }
  });
 });
});
