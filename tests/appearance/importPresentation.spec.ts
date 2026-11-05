import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import baseline from './import-presentation-baseline.json';
import {financialImplementationFingerprint} from './financialPresentationFingerprint';

describe('lote 3B conserva os caminhos financeiros revisados em 6f7a94b',()=>{
  it.each(Object.entries(baseline.files))('%s preserva classes e implementação original',(path,hash)=>{
    expect(financialImplementationFingerprint(path,readFileSync(path,'utf8'),baseline.additionalPresentationAttributes,baseline.additionalPresentationComponents)).toBe(hash);
  });
  it('não altera parsers, persistência, classificação, dedupe, parcelas ou datas',()=>{
    const actual=Object.fromEntries(Object.keys(baseline.financialSources).map(path=>[
      path,createHash('sha256').update(readFileSync(path,'utf8').replaceAll('\r\n','\n')).digest('hex'),
    ]));
    expect(actual).toEqual(baseline.financialSources);
  });
});
