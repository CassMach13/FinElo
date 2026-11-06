"""Preserve separated legacy residual FAILs, cooperative matrix and every attempt."""
import argparse,hashlib,json,re,runpy,subprocess,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
TOOLS=ROOT/'node_modules/.finelo-cycle4d-r2b-tools';OUT=TOOLS/'evidence'
COMPACT=ROOT/'docs/temas/evidencias-ciclo-4d-r2b'
def digest(data):return hashlib.sha256(data).hexdigest()
def encode(value):return json.dumps(value,ensure_ascii=False,indent=2).encode('utf8')
def counts(rows):return {'total':len(rows),'PASS':sum(r['status']=='PASS'for r in rows),'FAIL':sum(r['status']=='FAIL'for r in rows)}
def audit(rows):
    single={'pending','uncertain','three-mixed','offline-after-commit','delayed-result','negative','zero','refused'}
    accepted={'pending','uncertain','offline-after-commit','delayed-result','negative','zero'}
    records=[]
    for row in rows:
        finance=row['finance'];scenario=row['scenario'];attempts=finance['attempts'];writes=finance['writes']
        expected_attempts=1 if scenario in single else 0;expected_writes=1 if scenario in accepted else 0
        amount=-250 if scenario=='negative'else 0 if scenario=='zero'else 1250
        expected_balance=100000+(amount if expected_writes else 0)
        ok=(len(attempts)==expected_attempts and len(writes)==expected_writes and finance['balances']=={'QA-A':expected_balance,'QA-B':200000}
            and len({a['id']for a in attempts})==len(attempts))
        records.append({'name':row['name'],'status':'PASS'if ok else'FAIL','attempts':len(attempts),'expectedAttempts':expected_attempts,
            'writes':len(writes),'expectedWrites':expected_writes,'balance':finance['balances']['QA-A'],'expectedBalance':expected_balance})
    return records
def package(previous,target):
    assert not target.exists(),'Never overwrite a package'
    assert digest(previous.read_bytes())=='12d8c7fa215cbb828eb0dd251898e12f0683371a0f08fc1dc731d10d26126456'
    batch=json.loads((OUT/'cooperative-verified-matrix.json').read_text(encoding='utf8'))
    retries=json.loads((OUT/'lifecycle-observation-verified-matrix.json').read_text(encoding='utf8'))
    first_sources=json.loads((OUT/'cooperative-verified-sources.json').read_text(encoding='utf8'))
    retry_sources=json.loads((OUT/'lifecycle-observation-verified-sources.json').read_text(encoding='utf8'))
    assert first_sources['artifacts']==retry_sources['artifacts'],'Do not combine tests of different runtime artifacts'
    def key(row):return row['browser'],row['theme'],row['scenario']
    coop=json.loads((OUT/'cooperative-reference-final-matrix.json').read_text(encoding='utf8'))
    legacy=json.loads((OUT/'legacy-final-matrix.json').read_text(encoding='utf8'))
    financial=audit(coop)
    assert len(coop)==70 and len({r['name']for r in coop})==70
    attempts=[]
    for file in sorted(OUT.glob('*-matrix.json')):
        rows=json.loads(file.read_text(encoding='utf8'));attempts.append({'file':file.name,**counts(rows)})
    metrics={'base':'25a218d9c38f31134c39ebf4313a862a497e8649','overallVerdict':'NO-GO','productChanged':False,
        'legacyCounts':counts(legacy),'legacySessions':len({r['session']for r in legacy}),
        'legacyResidualFailures':sum(bool(r.get('residual'))for r in legacy),'legacyUnexpected':sum(bool(r.get('unexpected'))for r in legacy),
        'legacy':legacy,'cooperativeBatchCounts':counts(batch),'cooperativeRetryCounts':counts(retries),
        'coverageMeaning':'Final complete reference batch; earlier 68/2 and its two targeted PASS retries remain separate historical attempts',
        'earlierBatchAndTargetedRetriesHadIdenticalRuntimeArtifacts':True,
        'cooperativeFinalCounts':counts(coop),'financialAuditCounts':counts(financial),'financialAudit':financial,
        'cooperative':[{k:v for k,v in r.items()if k not in ['responses','navigations','finance','before','after','traceback','clientEvents']}for r in coop],
        'attempts':attempts,'validation':json.loads((OUT/'validation.json').read_text(encoding='utf8')),
        'nativeFreeze':'NOT CONFIRMED: failed attempts preserved','physicalInstalledPWA':'NOT TESTED','remoteAuth':'BLOCKED',
        'productIntegration':'NOT IMPLEMENTED; no production patch applied'}
    COMPACT.mkdir(exist_ok=True);(COMPACT/'metrics.json').write_bytes(encode(metrics))
    rows=[];objects={}
    def add(label,data):
        hashed=digest(data);obj='objects/'+hashed;objects.setdefault(obj,data)
        rows.append({'path':label,'bytes':len(data),'sha256':hashed,'object':obj})
    with zipfile.ZipFile(previous)as old:
        assert old.testzip()is None
        for row in json.loads(old.read('index.json'))['files']:
            if row['path'].startswith(('raw-artifacts/','reproduction/','sources/')):
                data=old.read(row['object']);assert digest(data)==row['sha256'];add('historical-r1/'+row['path'],data)
    for directory,prefix in[(OUT,'evidence'),(TOOLS/'sources','source-snapshots')]:
        for file in sorted(directory.rglob('*')):
            if file.is_file()and file.suffix in ['.json','.png','.js','.py','.html','.css']:add(prefix+'/'+file.relative_to(directory).as_posix(),file.read_bytes())
    for file in sorted(TOOLS.glob('*.log')):
        text=file.read_text(encoding='utf8',errors='replace')
        pattern=re.compile(r'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]+\.|\bBearer\s+\S+|[\"\'](?:access_token|refresh_token|password|authorization)[\"\']\s*:',re.I)
        sanitized=''.join('[credential-shaped diagnostic line removed]\n'if pattern.search(line)else line for line in text.splitlines(True))
        add('sanitized-logs/'+file.name,sanitized.encode())
    for file in sorted((ROOT/'scripts/diagnostics/pwa-r2b').iterdir()):
        if file.is_file():add('reproduction/'+file.relative_to(ROOT).as_posix(),file.read_bytes())
    for name in ['scripts/diagnostics/pwa-r2b-review-diff.py','scripts/diagnostics/package-pwa-r2b-evidence.py',
        'scripts/diagnostics/pwa-r2/activation-gate-proposal.js','tests/appearance/pwaR2bIsolation.spec.ts',
        'docs/temas/ciclo-4d-r2b-estrategia-migracao.md',*[f'docs/temas/proposta-r2b-{layer}.patch'for layer in['interface','worker','migracao']]]:
        add('reproduction/'+name,(ROOT/name).read_bytes())
    add('evidence/metrics.json',encode(metrics))
    index={'cycle':'4D-R2B separated migration and cooperative prototype','base':'25a218d9c38f31134c39ebf4313a862a497e8649',
        'productChanged':False,'canonicalReport':'evidence/metrics.json','files':rows}
    with zipfile.ZipFile(target,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=9)as archive:
        archive.writestr('index.json',encode(index))
        for name,data in objects.items():archive.writestr(name,data)
    verify=runpy.run_path(str(ROOT/'scripts/diagnostics/verify-theme-evidence.py'))['verify']
    first=verify(target);second=verify(target);assert first==second
    # Compact screenshots are selected by purpose; complete set remains external.
    images=[]
    for name in ['cooperative-reference-final-chrome-light-clean-b.png','legacy-chrome-original-before-button.png','legacy-chrome-original-after-button.png']:
        if not(OUT/name).exists():continue
        data=(OUT/name).read_bytes();(COMPACT/name).write_bytes(data);images.append({'file':name,'bytes':len(data),'sha256':digest(data)})
    result={'archive':target.name,'checks':[first,second],'images':images,'pngBytes':sum(i['bytes']for i in images),'overallVerdict':'NO-GO','productChanged':False}
    (COMPACT/'manifest.json').write_bytes(encode(result));print(json.dumps(result,indent=2))
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('previous',type=Path);parser.add_argument('target',type=Path);args=parser.parse_args();package(args.previous,args.target)
