"""Replay the reviewed 4D harness, independently of the corrected working file."""
import json
import runpy
import subprocess
from pathlib import Path
from playwright.sync_api import Browser
from pwa_r1_observation import Observer, OUT, ROOT, disk_http, digest, write

REVIEWED = 'c7f1a5c668ef4f39b9b0d489a93c02fa07e72308'
observer = Observer('reconstruction-reviewed-c7')
original_context = Browser.new_context
original_close = Browser.close
original_run = subprocess.run

def context(self, *args, **kwargs):
    result = original_context(self, *args, **kwargs)
    observer.attach(result)
    return result

def build(*args, **kwargs):
    revision = kwargs.get('env', {}).get('FINELO_QA_BUILD')
    observer.event('build-start', revision=revision)
    result = original_run(*args, **kwargs)
    observer.event('build-end', revision=revision, returncode=result.returncode)
    if revision == 'b':
        observer.event('published-b-disk-http', values=disk_http())
        observer.save()
    return result

def close(self, *args, **kwargs):
    for ctx in self.contexts:
        for page in list(ctx.pages):
            if page.is_closed():
                continue
            observer.snapshot(page, 'before-any-correction-final-old-page')
            page.screenshot(path=str(OUT / 'before-old-document.png'))
    observer.save()
    return original_close(self, *args, **kwargs)

if __name__ == '__main__':
    assert digest((ROOT/'vite.config.ts').read_text(encoding='utf8').encode()) == '91b292fd907c9ab5f79ee74e827f8ec1cc08282688638d38b25272ad624183c9', 'Historical replay requires the frozen 9c792ee checkout, including its configuration; do not replay old assumptions with the new product policy'
    files = ['scripts/diagnostics/integrated-validate-pwa.py', 'scripts/diagnostics/integrated-pwa.config.ts',
             'scripts/diagnostics/integrated_fixture_backend.py', 'vite.config.ts', 'src/components/pwa/ReloadPrompt.tsx']
    harness = subprocess.check_output(['git','show',REVIEWED+':scripts/diagnostics/integrated-validate-pwa.py'],cwd=ROOT)
    write('reviewed-replay-sources.json', {'reviewed':REVIEWED,'executedHarnessSHA256':digest(harness),
                                         'workingFiles':{name:digest((ROOT/name).read_bytes())for name in files}})
    Browser.new_context = context
    Browser.close = close
    subprocess.run = build
    try:
        exec(compile(harness, 'reviewed-c7/integrated-validate-pwa.py', 'exec'),
             {'__name__':'__main__','__file__':str(ROOT/'scripts/diagnostics/integrated-validate-pwa.py')})
        original = ROOT / 'node_modules/.finelo-cycle4d-tools/evidence/pwa-validation.json'
        (OUT / 'reconstructed-reviewed-c7-harness-result.json').write_bytes(original.read_bytes())
    finally:
        observer.save()
        Browser.new_context = original_context
        Browser.close = original_close
        subprocess.run = original_run
