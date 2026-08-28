"""
finalize_vote_round.py

Closes a "이달의 조식" (Breakfast of the Month) vote round by recording its
winner in monthly-vote.json. Invoked by the "Finalize vote round" GitHub
Actions workflow (workflow_dispatch), itself only triggered by the
password-gated Cloudflare Worker behind the admin editor page - the admin
reads the final tally from the public vote-api Worker, then submits the
winning page_id here.

Reads ROUND_ID and WINNER_PAGE_ID from the environment. The winner must be
one of that round's registered candidates. Setting a winner is what makes
build_public_data.py render the "이달의 조식" medal badge on that record's
card and detail page - see MEDAL_WINNERS in build_public_data.py.

Usage (set by the workflow, not run manually):
    ROUND_ID=2026-09 WINNER_PAGE_ID=some-page-id python finalize_vote_round.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VOTE_PATH = os.path.join(HERE, 'monthly-vote.json')


def main():
    round_id = os.environ.get('ROUND_ID', '').strip()
    winner = os.environ.get('WINNER_PAGE_ID', '').strip()

    if not round_id:
        print('No round_id provided.', file=sys.stderr)
        sys.exit(1)
    if not winner:
        print('No winner_page_id provided.', file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(VOTE_PATH):
        print('monthly-vote.json does not exist yet.', file=sys.stderr)
        sys.exit(1)

    with open(VOTE_PATH, encoding='utf-8') as f:
        vote_data = json.load(f)

    target = None
    for r in vote_data.get('rounds', []):
        if r.get('id') == round_id:
            target = r
            break

    if target is None:
        print(f'No vote round found with id={round_id!r}', file=sys.stderr)
        sys.exit(1)
    if winner not in target.get('candidates', []):
        print(f'{winner!r} is not a candidate of round {round_id!r}.', file=sys.stderr)
        sys.exit(1)
    if target.get('winner'):
        print(f'Round {round_id!r} already has a winner ({target["winner"]!r}) - refusing to overwrite.', file=sys.stderr)
        sys.exit(1)

    target['winner'] = winner

    with open(VOTE_PATH, 'w', encoding='utf-8') as f:
        json.dump(vote_data, f, ensure_ascii=False, indent=1)
        f.write('\n')

    print(f'Finalized round {round_id!r}: winner = {winner!r}')


if __name__ == '__main__':
    main()
