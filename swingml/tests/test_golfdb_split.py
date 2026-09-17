"""Grouping real footage so a golfer cannot appear on both sides of the split.

GolfDB's own four splits are not disjoint by golfer - 100 of its 246 players
appear in all four - so a holdout taken from them would put the same golfer,
frequently the same tournament and camera, in training and in test. The real
footage number is the one this corpus exists to move, so it is the last number
that can afford to be flattering.

Grouping by player alone does not fix it either: fifteen source videos carry
more than one player, and most videos contributed two clips of one swing from
two camera positions. The groups are therefore the connected components of the
player-video graph, which contains both.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from make_golfdb_dataset import Annotation
from split_golfdb import choose_holdout, group_of_clip, order_key


def annotation(clip_id: int, player: str, youtube_id: str) -> Annotation:
    return Annotation(
        clip_id=clip_id,
        player=player,
        youtube_id=youtube_id,
        view="face-on",
        club="driver",
        slow=False,
        split=1,
        events=np.arange(8, dtype=np.int64),
    )


def test_one_player_across_two_videos_is_one_group() -> None:
    group = group_of_clip([annotation(0, "A PLAYER", "vid1"), annotation(1, "A PLAYER", "vid2")])
    assert group[0] == group[1]


def test_two_players_sharing_a_video_are_one_group() -> None:
    """The case that defeats grouping by player: a video of two golfers."""
    group = group_of_clip([annotation(0, "FIRST", "shared"), annotation(1, "SECOND", "shared")])
    assert group[0] == group[1]


def test_a_shared_video_merges_both_players_other_videos_too() -> None:
    """Transitivity, which is why this is a union-find and not a pairing."""
    group = group_of_clip(
        [
            annotation(0, "FIRST", "first-only"),
            annotation(1, "FIRST", "shared"),
            annotation(2, "SECOND", "shared"),
            annotation(3, "SECOND", "second-only"),
        ]
    )
    assert len({group[i] for i in range(4)}) == 1


def test_unrelated_players_stay_apart() -> None:
    group = group_of_clip([annotation(0, "FIRST", "vid1"), annotation(1, "SECOND", "vid2")])
    assert group[0] != group[1]


def test_group_names_do_not_depend_on_the_order_rows_were_read() -> None:
    """Otherwise the split moves when the extraction workers finish in a new order."""
    records = [
        annotation(0, "FIRST", "first-only"),
        annotation(1, "FIRST", "shared"),
        annotation(2, "SECOND", "shared"),
    ]
    assert group_of_clip(records) == group_of_clip(list(reversed(records)))


def test_holdout_reaches_the_target_share() -> None:
    sizes = {f"player:P{i:03d}": 5 for i in range(100)}
    held = choose_holdout(sizes, 0.2)
    assert 0.2 <= sum(sizes[name] for name in held) / 500 <= 0.25


def test_adding_a_group_does_not_move_the_existing_ones() -> None:
    """The reason the order is hashed rather than permuted.

    A permutation is a function of how many groups there are, so one new golfer
    would reshuffle every assignment and quietly move footage across the
    boundary, changing what the holdout measures without changing any code.
    """
    sizes = {f"player:P{i:03d}": 5 for i in range(60)}
    before = choose_holdout(sizes, 0.2)
    grown = dict(sizes)
    grown["player:NEWCOMER"] = 5
    after = choose_holdout(grown, 0.2)
    moved = {n for n in sizes if (n in before) != (n in after)}
    # One group may cross as the target shifts; a reshuffle moves dozens.
    assert len(moved) <= 1, f"{len(moved)} groups moved when one was added"


def test_the_hash_order_is_not_alphabetical() -> None:
    """A holdout taken in name order would be all the players early in the alphabet."""
    names = [f"player:P{i:03d}" for i in range(50)]
    assert sorted(names, key=order_key) != names
