import {functionalSourceHash} from './functionalSourceHash';
import {readSealed} from '../transactions/approvedManualSave';
import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import baseline from './import-presentation-baseline.json';
import {financialImplementationFingerprint} from './financialPresentationFingerprint';

describe('lote 3B conserva os caminhos financeiros revisados em 6f7a94b',()=>{
  it.each(Object.entries(baseline.files))('%s preserva classes e implementação original',(path,hash)=>{
    // 4B paints only the Assets section of Settings; the original AST/hash stays authoritative.
    const presentation=[...baseline.additionalPresentationComponents,...(path==='src/components/views/SettingsView.tsx'?['investments.css']:[])];
    expect(financialImplementationFingerprint(path,readSealed(path),baseline.additionalPresentationAttributes,presentation)).toBe(hash);
  });
  it('não altera parsers, persistência, classificação, dedupe, parcelas ou datas',()=>{
    const actual=Object.fromEntries(Object.keys(baseline.financialSources).map(path=>[
      path,functionalSourceHash(path,readSealed(path)),
    ]));
    expect(actual).toEqual(baseline.financialSources);
  });
});
