import {functionalSourceHash} from './functionalSourceHash';
import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import baseline from './card-presentation-baseline.json';
import {financialImplementationFingerprint} from './financialPresentationFingerprint';

describe('lote 3C conserva as classes e as implementações financeiras revisadas',()=>{
 it.each(Object.entries(baseline.files))('%s mantém o contrato anterior ao tema',(path,hash)=>{
  expect(financialImplementationFingerprint(path,readFileSync(path,'utf8'),baseline.additionalPresentationAttributes,baseline.additionalPresentationComponents)).toBe(hash);
 });
 it('preserva os 156 módulos de domínio, serviços, store e métricas',()=>{
  const actual=Object.fromEntries(Object.keys(baseline.financialSources).map(path=>[path,functionalSourceHash(path,readFileSync(path,'utf8'))]));
  expect(actual).toEqual(baseline.financialSources);
 });
});
