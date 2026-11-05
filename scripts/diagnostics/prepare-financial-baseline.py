"""Read an immutable Git source baseline into the diagnostic namespace, without overwriting differing files."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

parser=argparse.ArgumentParser()
parser.add_argument('--base',default='6fa1188')
args=parser.parse_args()
repo=Path(__file__).resolve().parents[2]
target=(repo/'scripts/diagnostics/theme-financial-baseline').resolve()
assert target.is_relative_to(repo/'scripts/diagnostics')
commit=subprocess.check_output(['git','rev-parse',args.base+'^{commit}'],cwd=repo,text=True).strip()
archive=subprocess.check_output(['git','archive','--format=tar',commit,'src'],cwd=repo)
files={}
with tarfile.open(fileobj=io.BytesIO(archive)) as source:
    for member in source.getmembers():
        destination=(target/member.name).resolve()
        if not destination.is_relative_to(target) or member.issym() or member.islnk():raise RuntimeError('Unsafe baseline member')
        if member.isdir():continue
        data=source.extractfile(member).read()
        if destination.exists() and destination.read_bytes()!=data:raise RuntimeError('Existing baseline differs: '+member.name)
        files[member.name]=hashlib.sha256(data).hexdigest()
    # Verify all existing sources before writing anything.
    for existing in target.rglob('*') if target.exists() else []:
        if existing.is_file() and existing.name!='baseline.json' and existing.relative_to(target).as_posix() not in files:raise RuntimeError('Unexpected file in baseline: '+str(existing))
    for member in source.getmembers():
        destination=target/member.name
        if member.isdir():destination.mkdir(parents=True,exist_ok=True)
        elif not destination.exists():
            destination.parent.mkdir(parents=True,exist_ok=True)
            destination.write_bytes(source.extractfile(member).read())
manifest={'purpose':'finelo-financial-presentation-baseline','base':commit,'files':files}
(target/'baseline.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps({'base':commit,'verified_source_files':len(files),'directory':str(target)}))
