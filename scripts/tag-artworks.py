#!/usr/bin/env python3
"""Tag artwork previews with an optional RAM++ or administrator-supplied adapter."""
import argparse
import datetime
import fcntl
import io
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import zipfile

os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('TRANSFORMERS_OFFLINE', '1')
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
sys.dont_write_bytecode = True


def save_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False, encoding='utf-8') as stream:
        json.dump(data, stream, ensure_ascii=False)
        temporary = stream.name
    os.replace(temporary, path)


def load_json(path, fallback):
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        return fallback


def normalize_tags(value):
    # Categorize depicted content rather than guessing personal sensitive traits.
    excluded = {'asian', 'african american', 'caucasian', 'ethnicity', 'race', 'gay',
                'lesbian', 'transgender', 'muslim', 'christian', 'jewish', 'hindu',
                'buddhist', 'pregnant', 'autistic', 'disabled', 'homeless'}
    if isinstance(value, str):
        value = re.split(r'[|,]', value)
    if not isinstance(value, (list, tuple)) or any(not isinstance(tag, str) for tag in value):
        raise ValueError('A tagger must return a list of strings or a comma/pipe-separated string')
    return sorted({tag.strip().lower() for tag in value
                   if tag.strip() and tag.strip().lower() not in excluded})


def load_tagger(engine):
    if engine == 'ram++':
        from tagger_ram import RAMTagger
        return RAMTagger()
    plugin = os.environ.get('TAGGER_PLUGIN')
    if not plugin:
        raise ValueError('Set TAGGER_PLUGIN for the custom engine')
    spec = importlib.util.spec_from_file_location('gallery_custom_tagger', Path(plugin).resolve())
    if spec is None or spec.loader is None:
        raise ValueError('Could not load TAGGER_PLUGIN')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    tagger = module.create_tagger()
    if not callable(tagger):
        raise ValueError('create_tagger() must return a callable')
    return tagger


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--status', required=True)
    parser.add_argument('--engine', choices=['ram++', 'custom'], default='ram++')
    args = parser.parse_args()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    lock = open(output.with_suffix('.lock'), 'a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('A tagging job is already running.', flush=True)
        return

    status = {'state': 'loading', 'pid': os.getpid(), 'processed': 0, 'total': 0, 'failed': 0, 'device': None}

    def report(**updates):
        status.update(updates)
        status['updatedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        save_json(args.status, status)

    report()
    try:
        from PIL import Image, ImageOps

        manifest = load_json(args.input, [])
        database = load_json(output, {'model': args.engine, 'items': {}})
        records = database['items']
        pending = [entry for entry in manifest if records.get(entry['id'], {}).get('version') != entry['version'] or records.get(entry['id'], {}).get('error')]
        report(total=len(pending))
        if not pending:
            report(state='complete')
            return

        tagger = load_tagger(args.engine)
        report(state='running', device=getattr(tagger, 'device', None))
        print(f'Tagging {len(pending)} artworks with {args.engine}.', flush=True)

        for entry in pending:
            try:
                file = Path(entry['file'])
                if file.suffix.lower() == '.procreate':
                    with zipfile.ZipFile(file) as archive:
                        info = archive.getinfo('QuickLook/Thumbnail.png')
                        if info.file_size > 40 * 1024 * 1024:
                            raise ValueError('Embedded preview is too large')
                        source = io.BytesIO(archive.read(info))
                else:
                    source = file
                with Image.open(source) as original:
                    image = ImageOps.exif_transpose(original).convert('RGBA')
                    background = Image.new('RGBA', image.size, 'white')
                    image = Image.alpha_composite(background, image).convert('RGB')
                generated = tagger(image)
                status['device'] = getattr(tagger, 'device', None)
                records[entry['id']] = {'version': entry['version'], 'tags': normalize_tags(generated), 'engine': args.engine,
                    'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
            except Exception as error:
                records[entry['id']] = {'version': entry['version'], 'tags': [], 'error': 'Preview could not be tagged.'}
                status['failed'] += 1
                print(f"Skipped {entry['id']}: {error}", flush=True)
            status['processed'] += 1
            save_json(output, database)
            report()
            if status['processed'] % 20 == 0:
                print(f"Tagged {status['processed']} / {status['total']}; failed {status['failed']}.", flush=True)
        report(state='complete')
        print('Tagging complete.', flush=True)
    except Exception as error:
        report(state='error', error='The tagger could not run. Check the server tagging log and engine configuration.')
        print(f'Tagging failed: {error}', file=sys.stderr, flush=True)
        raise
    finally:
        lock.close()


if __name__ == '__main__':
    main()
