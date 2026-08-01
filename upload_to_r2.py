"""
upload_to_r2.py

Uploads everything in images/ to the Cloudflare R2 bucket configured in
.r2-credentials.json (gitignored, never commit that file). Keeps the same
relative path as the object key (e.g. local images/1796.jpg -> bucket key
images/1796.jpg), so recipes.json paths only need a base-URL prefix, not a
rename.

Safe to re-run: skips objects that already exist in the bucket with the same
size, so interrupted runs can just be restarted.

Usage:
    python upload_to_r2.py
"""
import json
import os
import sys
import mimetypes

import boto3
from botocore.config import Config

HERE = os.path.dirname(os.path.abspath(__file__))
CRED_PATH = os.path.join(HERE, '.r2-credentials.json')
IMAGES_DIR = os.path.join(HERE, 'images')


def load_credentials():
    with open(CRED_PATH, encoding='utf-8') as f:
        return json.load(f)


def make_client(cred):
    return boto3.client(
        's3',
        endpoint_url=cred['endpoint'],
        aws_access_key_id=cred['access_key_id'],
        aws_secret_access_key=cred['secret_access_key'],
        config=Config(signature_version='s3v4'),
        region_name='auto',
    )


def list_existing_sizes(client, bucket):
    """Returns {key: size} for every object already in the bucket."""
    sizes = {}
    paginator = client.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=bucket):
        for obj in page.get('Contents', []):
            sizes[obj['Key']] = obj['Size']
    return sizes


def main():
    cred = load_credentials()
    client = make_client(cred)
    bucket = cred['bucket']

    print('Listing existing objects in bucket (for resume support)...')
    existing = list_existing_sizes(client, bucket)
    print(f'  {len(existing)} objects already in bucket')

    local_files = []
    for root, _dirs, files in os.walk(IMAGES_DIR):
        for name in files:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, HERE).replace(os.sep, '/')
            local_files.append((full, rel))
    print(f'Found {len(local_files)} local files under images/')

    uploaded, skipped, failed = 0, 0, 0
    for i, (full, rel) in enumerate(local_files, 1):
        size = os.path.getsize(full)
        if existing.get(rel) == size:
            skipped += 1
            continue
        content_type = mimetypes.guess_type(full)[0] or 'application/octet-stream'
        try:
            client.upload_file(full, bucket, rel, ExtraArgs={'ContentType': content_type})
            uploaded += 1
        except Exception as e:
            failed += 1
            print(f'  ! failed: {rel}: {e}', file=sys.stderr)
        if i % 200 == 0:
            print(f'  ...{i}/{len(local_files)} processed (uploaded={uploaded}, skipped={skipped}, failed={failed})')

    print()
    print('=== done ===')
    print(f'uploaded: {uploaded}')
    print(f'skipped (already present, same size): {skipped}')
    print(f'failed: {failed}')


if __name__ == '__main__':
    main()
