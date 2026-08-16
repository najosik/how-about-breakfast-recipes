"""
upload_pending_images.py

Uploads every file in .pending-uploads/ to the Cloudflare R2 bucket
(same credentials/bucket as upload_to_r2.py), using key `images/<filename>`
so the result is reachable at the usual https://images.how-about-breakfast.com/images/<filename> URL.

This exists so a single missing photo can be delivered to R2 without needing
a PC: the file is committed to .pending-uploads/ and pushed to main, which
triggers the "Upload pending images" GitHub Actions workflow to run this
script. On success, each uploaded file is deleted locally so the workflow's
own commit clears .pending-uploads/ back to empty.

Refuses to overwrite an existing object under the same key (backfill numbers
are chosen to be collision-free ahead of time; a pre-existing object at that
key means something unexpected and should be looked at, not silently replaced).

Usage:
    python upload_pending_images.py
"""
import json
import os
import sys
import mimetypes

import boto3
from botocore.config import Config

HERE = os.path.dirname(os.path.abspath(__file__))
CRED_PATH = os.path.join(HERE, '.r2-credentials.json')
PENDING_DIR = os.path.join(HERE, '.pending-uploads')


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


def object_exists(client, bucket, key):
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except client.exceptions.ClientError:
        return False


def main():
    if not os.path.isdir(PENDING_DIR):
        print('No .pending-uploads/ directory, nothing to do.')
        return

    files = [
        name for name in sorted(os.listdir(PENDING_DIR))
        if os.path.isfile(os.path.join(PENDING_DIR, name)) and not name.startswith('.')
    ]
    if not files:
        print('No pending files, nothing to do.')
        return

    cred = load_credentials()
    client = make_client(cred)
    bucket = cred['bucket']

    uploaded, skipped, failed = 0, 0, 0
    for name in files:
        full = os.path.join(PENDING_DIR, name)
        key = f'images/{os.path.basename(name)}'
        if object_exists(client, bucket, key):
            skipped += 1
            print(f'  ! skipped (already exists in bucket): {key}', file=sys.stderr)
            continue
        content_type = mimetypes.guess_type(full)[0] or 'application/octet-stream'
        try:
            client.upload_file(full, bucket, key, ExtraArgs={'ContentType': content_type})
            os.remove(full)
            uploaded += 1
            print(f'  uploaded: {key}')
        except Exception as e:
            failed += 1
            print(f'  ! failed: {key}: {e}', file=sys.stderr)

    print()
    print('=== done ===')
    print(f'uploaded: {uploaded}')
    print(f'skipped (already present in bucket): {skipped}')
    print(f'failed: {failed}')
    if failed:
        sys.exit(1)


if __name__ == '__main__':
    main()
