"""
apply_edit.py

Applies a content edit to recipes.json. Invoked by the "Apply content edit"
GitHub Actions workflow (workflow_dispatch), which itself is only triggered
by the password-gated Cloudflare Worker behind admin/edit.html — this
script trusts the workflow's inputs, but still validates shape/whitelists
fields defensively (never eval()'d, never passed through a shell).

Reads PAGE_ID and PATCH_JSON from the environment (populated by the
workflow from its workflow_dispatch inputs). Only the whitelisted fields
present in PATCH_JSON are overwritten on the matching live record.

If any of the translatable fields (title/intro/ingredients/steps) change,
the record's _en translation is cleared so it naturally reappears in the
normal "any posts missing an English translation?" check instead of
silently drifting out of sync with the edited Korean text.

Usage (set by the workflow, not run manually):
    PAGE_ID=... PATCH_JSON='{"title": "..."}' python apply_edit.py
"""
import json
import os
import sys

RECIPES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'recipes.json')
ALLOWED_FIELDS = {'title', 'intro', 'ingredients', 'steps', 'hashtags', 'credit'}
TRANSLATABLE_FIELDS = {'title', 'intro', 'ingredients', 'steps'}


def main():
    page_id = os.environ.get('PAGE_ID', '').strip()
    patch_raw = os.environ.get('PATCH_JSON', '')

    if not page_id:
        print('No page_id provided.', file=sys.stderr)
        sys.exit(1)

    try:
        patch = json.loads(patch_raw)
    except json.JSONDecodeError as e:
        print(f'Invalid patch JSON: {e}', file=sys.stderr)
        sys.exit(1)

    if not isinstance(patch, dict):
        print('Patch must be a JSON object.', file=sys.stderr)
        sys.exit(1)

    patch = {k: v for k, v in patch.items() if k in ALLOWED_FIELDS}
    if not patch:
        print('No editable fields in patch, nothing to do.')
        return

    with open(RECIPES_PATH, encoding='utf-8') as f:
        data = json.load(f)

    target = None
    for r in data:
        if r.get('page_id') == page_id and not r.get('deleted'):
            target = r
            break

    if target is None:
        print(f'No live record found with page_id={page_id!r}', file=sys.stderr)
        sys.exit(1)

    changed_translatable = False
    for key, value in patch.items():
        if key == 'hashtags':
            if not isinstance(value, list):
                print('hashtags must be a list of strings.', file=sys.stderr)
                sys.exit(1)
            value = [str(v) for v in value]
        else:
            value = str(value) if value is not None else None
        if target.get(key) != value:
            if key in TRANSLATABLE_FIELDS:
                changed_translatable = True
            target[key] = value

    if changed_translatable and target.get('_en'):
        del target['_en']
        print(f'Cleared stale _en translation for {page_id!r} (will need re-translation).')

    with open(RECIPES_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')

    print(f'Applied edit to {page_id!r}: fields {sorted(patch.keys())}')


if __name__ == '__main__':
    main()
