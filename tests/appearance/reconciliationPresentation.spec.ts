import {functionalSourceHash} from './functionalSourceHash';
import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import baseline from './reconciliation-presentation-baseline.json';
import {financialImplementationFingerprint} from './financialPresentationFingerprint';

describe('lote 3D conserva a operação e apresentação legadas da conciliação',()=>{
 it.each(Object.entries(baseline.files))('%s mantém o contrato anterior à pintura',(path,hash)=>{
  expect(financialImplementationFingerprint(path,readFileSync(path,'utf8'),baseline.additionalPresentationAttributes,baseline.additionalPresentationComponents)).toBe(hash);
 });
 it('preserva os 156 módulos financeiros, incluindo serviço, intenção e dois livros',()=>{
  const actual=Object.fromEntries(Object.keys(baseline.financialSources).map(path=>[path,functionalSourceHash(path,readFileSync(path,'utf8'))]));
  expect(actual).toEqual(baseline.financialSources);
 });
});
