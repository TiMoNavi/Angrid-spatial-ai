#!/usr/bin/env python3
"""Run the unchanged reference TSDF script on private copies of the captures.

Run with Open3D, Pillow and NumPy installed (see experiment/README.md).
The ZIPs and reference checkout are read-only; all output stays in .private.
"""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys
import zipfile


EXPERIMENT = Path(__file__).resolve().parents[1]
REFERENCE_SCRIPT = EXPERIMENT.parent / 'reference/3d-model-anything/.agents/skills/scan-to-threejs/scripts/reconstruct_bundle.py'


def extract_inputs(archive, destination):
    """Extract only metadata and depth/photo files consumed by the reference."""
    with zipfile.ZipFile(archive) as zf:
        frames = json.loads(zf.read('Room/depth/frames.json'))
        photos = json.loads(zf.read('Room/photos/photos.json'))
        names = {'depth/frames.json', 'photos/photos.json'}
        for frame in frames:
            names.update(frame[key] for key in ('file', 'confidence', 'rgb') if frame.get(key))
        names.update(photo['file'] for photo in photos)
        for name in sorted(names):
            relative = PurePosixPath(name)
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError('Unsafe bundle path: ' + name)
            target = destination.joinpath(*relative.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            content = zf.read('Room/' + name)
            if not target.exists() or target.read_bytes() != content:
                target.write_bytes(content)
    return len(frames), len(photos), len(names)


def prepare(scan_id, archive):
    private = EXPERIMENT / '.private' / scan_id
    room = private / 'converted.json'
    if not room.exists():
        raise FileNotFoundError('Run tools/prepare_data.py first: ' + str(room))
    bundle = private / 'reference-source/Room'
    frames, photos, files = extract_inputs(archive, bundle)
    out = private / 'reference-depth'
    out.mkdir(parents=True, exist_ok=True)
    config = {
        'scanId': scan_id,
        'sourceArchive': archive.name,
        'script': str(REFERENCE_SCRIPT.relative_to(EXPERIMENT.parent)),
        'scriptSha256': hashlib.sha256(REFERENCE_SCRIPT.read_bytes()).hexdigest(),
        'depthFrames': frames,
        'originalPhotos': photos,
        'extractedFiles': files,
        'voxelM': 0.02,
        'maxDepthM': 3.5,
        'minConfidence': 1,
        'truncationVoxels': 8,
        'outputCoordinates': 'scan_world: session-world; scan_room: already room-local, +Y up, meters',
    }
    command = [sys.executable, '-B', '-u', str(REFERENCE_SCRIPT), str(bundle),
               '--room', str(room), '--voxel', '0.02', '--max-depth', '3.5',
               '--min-confidence', '1', '-o', str(out)]
    print(f'{scan_id}: {frames} depth frames, {photos} original photos, {files} files; running unchanged reference', flush=True)
    with (out / 'reconstruction.log').open('w', encoding='utf-8') as log:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in process.stdout:
            print(line, end='', flush=True)
            log.write(line)
            log.flush()
        code = process.wait()
    if code:
        raise subprocess.CalledProcessError(code, command)
    (out / 'run-config.json').write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    from prepare_mesh_voxels import prepare as prepare_mesh
    prepare_mesh(scan_id)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--first', type=Path, default=Path.home() / 'Downloads/Office.zip')
    parser.add_argument('--second', type=Path, default=Path.home() / 'Downloads/Office 2.zip')
    parser.add_argument('--scan', choices=('both', 'office-1', 'office-2'), default='both')
    args = parser.parse_args()
    # Start with the second capture: its exported mesh supplies another reference.
    for scan_id, archive in (('office-2', args.second), ('office-1', args.first)):
        if args.scan in ('both', scan_id):
            prepare(scan_id, archive)


if __name__ == '__main__':
    main()
