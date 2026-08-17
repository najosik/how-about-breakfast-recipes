"""
add_post.py

Creates a brand-new recipes.json record for a date that has no entry at
all yet - backing the admin editor's "빠진 날짜" (missing dates) tool,
used to fill in days where Instagram has a real post but the site never
picked it up, one day at a time.

Invoked by the "Add missing post" GitHub Actions workflow (workflow_dispatch),
itself only triggered by the password-gated Cloudflare Worker. Reads DATE
and PATCH_JSON from the environment.

diary_no is assigned as (current max live diary_no) + 1, regardless of
where DATE actually falls chronologically. This site already tolerates
diary_no drift from past backfills (see build_public_data.py's docstring),
so a simple monotonic counter here is far safer than renumbering every
later record on every manual insert. page_id is intentionally left unset;
the next build_public_data.py run mints and persists one automatically
(see assign_unique_page_ids there).

Usage (set by the workflow, not run manually):
    DATE=2023-05-04 PATCH_JSON='{"title": "..."}' python add_post.py
"""
import json
import os
import re
import sys

RECIPES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'recipes.json')
ALLOWED_FIELDS = {
    'title', 'intro', 'ingredients', 'steps', 'hashtags', 'credit',
    'weather', 'calories', 'image', 'gallery', 'failed',
}
LIST_FIELDS = {'hashtags', 'gallery'}


def main():
    date = os.environ.get('DATE', '').strip()
    patch_raw = os.environ.get('PATCH_JSON', '')

    if not re.match(r'^\d{4}-\d{2}-\d{2}$', date):
        print(f'Invalid date: {date!r}', file=sys.stderr)
        sys.exit(1)

    try:
        patch = json.loads(patch_raw)
    except json.JSONDecodeError as e:
        print(f'Invalid patch JSON: {e}', file=sys.stderr)
        sys.exit(1)

    if not isinstance(patch, dict):
        print('Patch must be a JSON object.', file=sys.stderr)
        sys.exit(1)

    with open(RECIPES_PATH, encoding='utf-8') as f:
        data = json.load(f)

    live = [r for r in data if not r.get('deleted')]
    if any(r.get('date') == date for r in live):
        print(f'A live record for {date} already exists - refusing to create a duplicate.', file=sys.stderr)
        sys.exit(1)

    next_diary_no = max((r.get('diary_no') or 0) for r in live) + 1 if live else 1

    record = {
        'date': date,
        'date_raw': date.replace('-', ''),
        'diary_no': next_diary_no,
        'weather': None,
        'failed': False,
        'calories': None,
        'title': None,
        'credit': None,
        'hashtags': [],
        'intro': None,
        'ingredients': None,
        'steps': None,
    }

    for key in ALLOWED_FIELDS:
        if key not in patch:
            continue
        value = patch[key]
        if key in LIST_FIELDS:
            if not isinstance(value, list):
                print(f'{key} must be a list.', file=sys.stderr)
                sys.exit(1)
            record[key] = [str(v) for v in value if str(v).strip()]
        elif key == 'failed':
            record[key] = bool(value)
        elif key == 'calories':
            try:
                record[key] = int(value) if value not in (None, '') else None
            except (TypeError, ValueError):
                record[key] = None
        else:
            record[key] = str(value) if value not in (None, '') else None

    if record.get('image') and not record.get('gallery'):
        record['gallery'] = [record['image']]
    elif record.get('gallery') and not record.get('image'):
        record['image'] = record['gallery'][0]

    data.append(record)
    data.sort(key=lambda r: (r.get('date') or '0000-00-00', r.get('diary_no') or 0), reverse=True)

    with open(RECIPES_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')

    print(f'Added new record for {date} (diary_no {next_diary_no}).')


if __name__ == '__main__':
    main()
