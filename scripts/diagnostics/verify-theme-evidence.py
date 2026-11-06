"""Verify a deduplicated theme evidence archive without extracting files."""
import argparse,hashlib,json,zipfile
from pathlib import Path

def verify(path):
 with zipfile.ZipFile(path)as archive:
  assert archive.testzip()is None,'CRC failure'
  index=archive.read('index.json');manifest=json.loads(index)
  checked=set()
  for row in manifest['files']:
   object_path=row['object'];assert object_path.startswith('objects/') and '..'not in Path(object_path).parts
   if object_path not in checked:
    content=archive.read(object_path);assert len(content)==row['bytes'] and hashlib.sha256(content).hexdigest()==row['sha256'],row['path'];checked.add(object_path)
  return{'files':len(manifest['files']),'uniqueObjects':len(checked),'indexSHA256':hashlib.sha256(index).hexdigest(),'archiveSHA256':hashlib.sha256(Path(path).read_bytes()).hexdigest(),'bytes':Path(path).stat().st_size,'CRC':True,'allSHA256':True}

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('archive');args=parser.parse_args();print(json.dumps(verify(args.archive),indent=2))
