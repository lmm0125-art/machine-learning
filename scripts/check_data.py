"""Print a summary of a dataset folder and fail if the layout is wrong.

    python scripts/check_data.py --root data/raw
"""

from __future__ import annotations

import argparse
import os
import statistics
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src"))

from rehab_cls.data import (  # noqa: E402
    DEFAULT_DROP_COLUMNS,
    DEFAULT_LABELS,
    discover_recordings,
    load_segments,
    parse_recording,
)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--root", required=True)
    p.add_argument("--labels", nargs="*", default=list(DEFAULT_LABELS))
    args = p.parse_args()

    recordings = discover_recordings(args.root, args.labels)
    print(f"{len(recordings)} recordings found under {args.root}")
    if not recordings:
        print("ERROR: no recordings — expected <root>/<class>/*.txt")
        return 1

    by_class: dict[str, list[int]] = {}
    total_frames = 0
    for path, label in recordings:
        reps = parse_recording(path)
        lengths = [r.shape[0] for r in reps]
        by_class.setdefault(label, []).extend(lengths)
        total_frames += sum(lengths)
        print(f"  {os.path.relpath(path, args.root):<32s} {len(reps):2d} reps  "
              f"lengths {lengths}")

    print()
    for label, lengths in sorted(by_class.items()):
        print(f"{label:<16s} reps {len(lengths):3d}  "
              f"min/median/max {min(lengths)}/{int(statistics.median(lengths))}/{max(lengths)}")
    print(f"frames parsed: {total_frames}")

    data = load_segments(args.root, labels=args.labels, drop_columns=DEFAULT_DROP_COLUMNS, min_length=40)
    print(f"kept after min_length=40: {len(data.segments)} repetitions "
          f"({len(set(data.groups()))} recordings), feature dim "
          f"{data.segments[0].frames.shape[1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
