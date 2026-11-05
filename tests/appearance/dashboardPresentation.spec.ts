import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';
import {describe,expect,it} from 'vitest';
import baseline from './dashboard-presentation-baseline.json';
import {financialImplementationFingerprint} from './financialPresentationFingerprint';

describe('Ciclo 4A preserva os cálculos e a apresentação legada do Dashboard',()=>{
 it.each(Object.entries(baseline.files))('%s preserva o contrato anterior à pintura',(path,hash)=>{
  expect(financialImplementationFingerprint(path,readFileSync(path,'utf8'),baseline.additionalPresentationAttributes,baseline.additionalPresentationComponents)).toBe(hash);
 });
 it('preserva todos os 156 módulos financeiros selados antes da conversão',()=>{
  expect(Object.fromEntries(Object.keys(baseline.financialSources).map(path=>[path,createHash('sha256').update(readFileSync(path,'utf8').replaceAll('\r\n','\n')).digest('hex')]))).toEqual(baseline.financialSources);
 });
 it('restringe a pintura à tela e ao Claro, exceto o acesso por teclado ao conteúdo existente',()=>{
  const css=postcss.parse(readFileSync('src/components/appearance/dashboard.css','utf8'));
  const disclosures=new Set(["[data-finance~=\"dashboard-hint-trigger\"]:focus-within > [data-finance~=\"dashboard-hint\"]", "[data-finance~=\"dashboard-month\"]:focus-within > [data-finance~=\"dashboard-month-tooltip\"]", "[data-finance~=\"dashboard-hint-trigger\"]:is(:hover, :focus-within) > [data-finance~=\"dashboard-hint\"], [data-finance~=\"dashboard-month\"]:is(:hover, :focus-within) > [data-finance~=\"dashboard-month-tooltip\"]", "[data-finance~=\"dashboard-hint-trigger\"][data-finance-hint-dismissed] > [data-finance~=\"dashboard-hint\"]", "[data-finance~=\"dashboard-month\"][data-finance-hint-dismissed] > [data-finance~=\"dashboard-month-tooltip\"]", "[data-finance~=\"dashboard-chart-tooltip\"]"]);
  css.walkRules(rule=>{
   expect(rule.parent?.type).toBe('atrule');
   expect((rule.parent as postcss.AtRule).name).toBe('media');
   expect((rule.parent as postcss.AtRule).params).toBe('screen');
   if(!disclosures.has(rule.selector.replace(/\s+/g,' '))) expect(rule.selector).toContain('[data-finelo-theme="light"]');
  });
 });
 it('limita declarações a pintura, sem alterar geometria ou impressão',()=>{
  const css=postcss.parse(readFileSync('src/components/appearance/dashboard.css','utf8'));
  const paint=/^(--dashboard-|color$|background(-color|-image|-size)?$|border-color$|box-shadow$|opacity$|fill$|stroke(-dasharray)?$|stop-color$|outline(-offset)?$)/;
  css.walkDecls(decl=>{
   if(decl.prop==='pointer-events'){
    expect(decl.value).toMatch(/^(auto|none)$/);
   }else if(decl.prop==='display'){
    if(decl.value==='none'){expect((decl.parent as postcss.Rule).selector).toContain('[data-finance-hint-dismissed]');return;}
    expect((decl.parent as postcss.Rule).selector).toBe('[data-finance~="dashboard-hint-trigger"]:focus-within > [data-finance~="dashboard-hint"]');
    expect(decl.value).toBe('block');
   }else expect(decl.prop).toMatch(paint);
  });
 });
});
