"""
add_vote_round.py

Registers a new "이달의 조식" (Breakfast of the Month) vote round in
monthly-vote.json. Invoked by the "Add vote round" GitHub Actions workflow
(workflow_dispatch), itself only triggered by the password-gated Cloudflare
Worker behind the admin editor page - this script trusts the workflow's
inputs, but still validates shape defensively (never eval()'d, never passed
through a shell).

Reads ROUND_JSON from the environment (populated by the workflow from its
workflow_dispatch input), a JSON object shaped like:
    {
      "target_month": "2026-08",       # YYYY-MM, the month whose posts are
                                        # the candidates
      "candidates": [... 12 page_ids ...],
      "vote_start": "2026-09-01",       # YYYY-MM-DD
      "vote_end": "2026-09-07"          # YYYY-MM-DD, inclusive
    }

The round's id is vote_start's "YYYY-MM" - refuses to add a second round
for the same voting month. Each candidate must be a page_id belonging to a
live (not deleted) record. winner starts unset (null) and is only filled in
later by finalize_vote_round.py once voting closes.

Usage (set by the workflow, not run manually):
    ROUND_JSON='{"target_month": "2026-08", "candidates": [...], ...}' \
        python add_vote_round.py
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RECIPES_PATH = os.path.join(HERE, 'recipes.json')
VOTE_PATH = os.path.join(HERE, 'monthly-vote.json')

DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
MONTH_RE = re.compile(r'^\d{4}-\d{2}$')


def main():
    raw = os.environ.get('ROUND_JSON', '')
    try:
        round_data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f'Invalid ROUND_JSON: {e}', file=sys.stderr)
        sys.exit(1)

    if not isinstance(round_data, dict):
        print('ROUND_JSON must be a JSON object.', file=sys.stderr)
        sys.exit(1)

    target_month = round_data.get('target_month')
    candidates = round_data.get('candidates')
    vote_start = round_data.get('vote_start')
    vote_end = round_data.get('vote_end')

    if not (isinstance(target_month, str) and MONTH_RE.match(target_month)):
        print(f'Invalid target_month: {target_month!r}', file=sys.stderr)
        sys.exit(1)
    if not (isinstance(vote_start, str) and DATE_RE.match(vote_start)):
        print(f'Invalid vote_start: {vote_start!r}', file=sys.stderr)
        sys.exit(1)
    if not (isinstance(vote_end, str) and DATE_RE.match(vote_end)):
        print(f'Invalid vote_end: {vote_end!r}', file=sys.stderr)
        sys.exit(1)
    if vote_end < vote_start:
        print('vote_end must not be before vote_start.', file=sys.stderr)
        sys.exit(1)
    if not isinstance(candidates, list) or len(candidates) != 12:
        print('candidates must be a list of exactly 12 page_ids.', file=sys.stderr)
        sys.exit(1)
    candidates = [str(c) for c in candidates]
    if len(set(candidates)) != 12:
        print('candidates must be 12 distinct page_ids.', file=sys.stderr)
        sys.exit(1)

    with open(RECIPES_PATH, encoding='utf-8') as f:
        records = json.load(f)
    live_ids = {r.get('page_id') for r in records if not r.get('deleted') and r.get('page_id')}
    missing = [c for c in candidates if c not in live_ids]
    if missing:
        print(f'Unknown or deleted page_id(s): {missing}', file=sys.stderr)
        sys.exit(1)

    if os.path.exists(VOTE_PATH):
        with open(VOTE_PATH, encoding='utf-8') as f:
            vote_data = json.load(f)
    else:
        vote_data = {'rounds': []}

    round_id = vote_start[:7]  # YYYY-MM of the voting period itself
    if any(r.get('id') == round_id for r in vote_data['rounds']):
        print(f'A vote round already exists for {round_id!r}.', file=sys.stderr)
        sys.exit(1)

    vote_data['rounds'].append({
        'id': round_id,
        'target_month': target_month,
        'candidates': candidates,
        'vote_start': vote_start,
        'vote_end': vote_end,
        'winner': None,
    })
    vote_data['rounds'].sort(key=lambda r: r['id'])

    with open(VOTE_PATH, 'w', encoding='utf-8') as f:
        json.dump(vote_data, f, ensure_ascii=False, indent=1)
        f.write('\n')

    print(f'Added vote round {round_id!r} for target_month {target_month!r}: {candidates}')


if __name__ == '__main__':
    main()
