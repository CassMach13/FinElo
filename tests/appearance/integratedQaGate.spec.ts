import{describe,it,expect}from'vitest';
import {readSealed} from '../transactions/approvedManualSave';
import{readFileSync}from'node:fs';
import{createHash}from'node:crypto';
import{isIntegratedQaAllowed}from'../../scripts/diagnostics/integrated-qa-gate';
import{authenticatedAppearancePresentation}from'./authenticatedAppearancePresentation';
import product from './integrated-product-baseline.json';

describe('4D entrada sintética isolada, sem liberação do produto',()=>{
 it('admite somente staging com flag existente e backend fictício no loopback',()=>{
  expect(isIntegratedQaAllowed('staging','true','127.0.0.1','https://integrated-fixture.invalid')).toBe(true);
 });
 it.each([
  ['production','true','127.0.0.1','https://integrated-fixture.invalid'],
  ['development','true','127.0.0.1','https://integrated-fixture.invalid'],
  ['staging','false','127.0.0.1','https://integrated-fixture.invalid'],
  ['staging','true','finelo-br.vercel.app','https://integrated-fixture.invalid'],
  ['staging','true','127.0.0.1','https://real.supabase.co'],
 ])('nega %s/%s/%s/%s',(mode,flag,host,backend)=>expect(isIntegratedQaAllowed(mode,flag,host,backend)).toBe(false));
 it('não é importada pelo index ou App publicado',()=>{
  expect(readFileSync('index.html','utf8')).not.toContain('integrated-');
  expect(readFileSync('src/App.tsx','utf8')).not.toContain('integrated-');
 });
 it('mantém os 284 selos do 4C, com as exceções exatas de apresentação reversíveis',()=>{
  expect(Object.fromEntries(Object.keys(product.files).map(file=>{
   let source=authenticatedAppearancePresentation(file,readSealed(file));
   if(file==='src/components/views/DashboardView.tsx')source=source.replace('<p data-finance="info" className="text-highlight/80 text-sm">','<p className="text-highlight/80 text-sm">');
   if(file==='src/components/goals/GoalFormModal.tsx')source=source.replace('<Modal manageFocus','<Modal').replace('autoFocus={false}','autoFocus');
   return[file,createHash('sha256').update(source).digest('hex')];
  }))).toEqual(product.normalizedFiles);
 });
});
