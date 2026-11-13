import {functionalSourceHash} from './functionalSourceHash';
import{readFileSync}from'node:fs';
import{describe,it,expect}from'vitest';
import postcss from'postcss';
import baseline from'./remaining-presentation-baseline.json';
import{financialImplementationFingerprint}from'./financialPresentationFingerprint';
import{remainingSessionPresentation}from'./remainingSessionPresentation';

describe('4C preserva implementações e a fronteira pública anterior à pintura',()=>{
 it.each(Object.entries(baseline.files))('%s mantém classes, geometria e lógica',(file,sha)=>{
  expect(financialImplementationFingerprint(file,remainingSessionPresentation(file,readFileSync(file,'utf8')),baseline.additionalPresentationAttributes,baseline.additionalPresentationComponents)).toBe(sha);
 });
 it('mantém os 163 arquivos funcionais selados',()=>{
  const actual=Object.fromEntries(Object.keys(baseline.functionalSources).map(p=>[p,functionalSourceHash(p,readFileSync(p,'utf8'))]));
  expect(actual).toEqual(baseline.functionalSources);
 });
 it('isola a pintura ao Claro em tela, sem alterar geometria ou impressão',()=>{
  const css=postcss.parse(readFileSync('src/components/appearance/remaining.css','utf8'));
  const paint=new Set(['color','background','background-color','background-image','border-color','box-shadow','fill','stroke','stop-color','opacity','outline','outline-offset','visibility','pointer-events']);
  css.walkRules(rule=>{
   expect(rule.parent?.type).toBe('atrule');expect((rule.parent as postcss.AtRule).name).toBe('media');expect((rule.parent as postcss.AtRule).params).toBe('screen');
   for(const selector of rule.selectors)expect(selector).toContain('[data-finelo-theme="light"]');
   rule.walkDecls(decl=>expect(paint.has(decl.prop),decl.prop).toBe(true));
  });
 });
});
