#!/usr/bin/env python3
"""Check the committed public file boundary and asset hashes before deployment."""
import hashlib, json, re, subprocess
from pathlib import Path
root = Path(__file__).resolve().parent.parent
files = subprocess.check_output(['git', 'ls-files'], cwd=root, text=True).splitlines()
errors = []
manifest = json.loads((root / 'docs/public-assets.json').read_text())
for name in files:
    path = root / name
    if path.is_symlink(): errors.append(f'Symlink is not distributable: {name}')
    if any(part in name.split('/') for part in ['kaitlin-office', 'playroom', 'gym', 'living-room', 'house-layout', 'captures-in', 'recordings', 'xcuserdata']):
        errors.append(f'Private or generated path: {name}')
    if name.startswith('demos/') and name != 'demos/index.ts' and name.split('/')[1] not in ['office-v2', 'office-latest', 'office-v4']:
        errors.append(f'Unreviewed demo: {name}')
    if name.startswith('data/'):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if manifest.get(name) != digest: errors.append(f'Unreviewed or changed asset: {name}')
    if path.suffix in ['.ts', '.js', '.swift', '.md', '.json', '.yml', '.yaml', '.html', '.plist', '.py', '.sh']:
        text = path.read_text()
        if re.search(r'/Users/' + r'[^/\s]+/', text): errors.append(f'Personal absolute path: {name}')
        if re.search(r'(?:gh[pousr]_[A-Za-z0-9]{30,}|sk-proj-[A-Za-z0-9_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)', text):
            errors.append(f'Credential-like content: {name}')
for name in manifest:
    if name not in files: errors.append(f'Asset missing from tracked files: {name}')
if errors: raise SystemExit('\n'.join(errors))
print(f'Public boundary passed: {len(files)} files, {len(manifest)} explicitly reviewed assets.')
