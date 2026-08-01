"""
rewrite_image_paths_to_r2.py

Rewrites every local images/... path in recipes.json to the full Cloudflare
R2 public URL, so the deployed site (which never gets the local images/
folder, since it's gitignored) loads photos from R2 instead.

Touches only: image, gallery, video, photo_candidates. Every other field is
left untouched. Safe to re-run: paths that are already full URLs are left
as-is.

Usage:
    python rewrite_image_paths_to_r2.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RECIPES_PATH = os.path.join(HERE, 'recipes.json')
CRED_PATH = os.path.join(HERE, '.r2-credentials.json')


def load_base_url():
    with open(CRED_PATH, encoding='utf-8') as f:
        return json.load(f)['public_base_url'].rstrip('/')


def rewrite_path(p, base_url):
    if not p or p.startswith('http://') or p.startswith('https://'):
        return p
    return base_url + '/' + p


def main():
    base_url = load_base_url()
    with open(RECIPES_PATH, encoding='utf-8') as f:
        records = json.load(f)

    changed = 0
    for r in records:
        touched = False
        if r.get('image'):
            new_v = rewrite_path(r['image'], base_url)
            if new_v != r['image']:
                r['image'] = new_v
                touched = True
        if r.get('video'):
            new_v = rewrite_path(r['video'], base_url)
            if new_v != r['video']:
                r['video'] = new_v
                touched = True
        if r.get('gallery'):
            new_list = [rewrite_path(p, base_url) for p in r['gallery']]
            if new_list != r['gallery']:
                r['gallery'] = new_list
                touched = True
        if r.get('photo_candidates'):
            new_candidates = [[rewrite_path(p, base_url) for p in group] for group in r['photo_candidates']]
            if new_candidates != r['photo_candidates']:
                r['photo_candidates'] = new_candidates
                touched = True
        if touched:
            changed += 1

    with open(RECIPES_PATH, 'w', encoding='utf-8') as f:
        json.dump(records, f, ensure_ascii=False, indent=1)

    print(f'records updated: {changed} / {len(records)}')


if __name__ == '__main__':
    main()
