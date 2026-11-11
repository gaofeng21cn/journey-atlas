"""Pack selected retired files, verify every byte, then optionally remove them."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import zipfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def archive_files(plan, remove=False):
    root = Path(plan['root']).resolve()
    target = Path(plan['archive']).absolute()
    files = plan['files']
    if not files or len(set(files)) != len(files):
        raise ValueError('归档须提供非空且无重复的相对文件清单')
    if target.exists():
        raise ValueError('归档目标已存在，不能覆盖：' + str(target))
    entries = []
    for name in files:
        path = root / name
        if Path(name).is_absolute() or '..' in Path(name).parts or name == 'manifest.json':
            raise ValueError('归档成员路径无效：' + name)
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root):
            raise ValueError('归档成员必须是根目录内的普通文件：' + name)
        data = path.read_bytes()
        entries.append({'path': name, 'bytes': len(data), 'sha256': digest(data)})
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix='.packing-', suffix='.zip', dir=target.parent)
    os.close(handle)
    try:
        with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for entry in entries:
                data = (root / entry['path']).read_bytes()
                if digest(data) != entry['sha256']:
                    raise ValueError('归档过程中源文件变化：' + entry['path'])
                archive.writestr(entry['path'], data)
            manifest = {'root': str(root), 'reason': plan.get('reason', ''), 'files': entries,
                        'metadata': plan.get('metadata', {})}
            archive.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        with zipfile.ZipFile(temporary) as archive:
            if set(archive.namelist()) != {'manifest.json', *(e['path'] for e in entries)}:
                raise ValueError('归档成员集合不一致')
            for entry in entries:
                data = archive.read(entry['path'])
                if len(data) != entry['bytes'] or digest(data) != entry['sha256']:
                    raise ValueError('归档回读不一致：' + entry['path'])
        # Exclusive publication prevents a concurrent run replacing an archive.
        os.link(temporary, target)
        if remove:
            for entry in entries:
                if digest((root / entry['path']).read_bytes()) != entry['sha256']:
                    raise ValueError('删除前源文件变化，保留归档：' + entry['path'])
            for entry in entries:
                path = root / entry['path']
                if digest(path.read_bytes()) != entry['sha256']:
                    raise ValueError('删除前源文件变化，保留归档：' + entry['path'])
                path.unlink()
        return {'archive': str(target), 'files': len(entries), 'sourceBytes': sum(e['bytes'] for e in entries),
                'archiveBytes': target.stat().st_size, 'sha256': digest(target.read_bytes()), 'removed': remove}
    finally:
        Path(temporary).unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True)
    parser.add_argument('--remove', action='store_true')
    args = parser.parse_args()
    print(json.dumps(archive_files(json.loads(Path(args.plan).read_text()), args.remove), ensure_ascii=False))
