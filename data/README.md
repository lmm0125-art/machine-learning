# Data

The recordings are course material provided by Hanyang University and Hexar
Humancare through the LMS. **They are not redistributed in this repository.**
Download them from the course page and place them as shown below.

```
data/
├── raw/                     # labelled recordings, Data1 (distributed week 11)
│   ├── circle/*.txt
│   ├── diagonal_left/*.txt
│   ├── diagonal_right/*.txt
│   ├── horizontal/*.txt
│   └── vertical/*.txt
├── raw2/                    # labelled recordings, Data2 (noisy release, week 13)
│   ├── circle/*.txt
│   ├── diagonal_left/*.txt
│   ├── diagonal_right/*.txt
│   ├── horizontal/*.txt
│   └── vertical/*.txt
├── combined/                # optional Data1 + Data2 training pool (generated)
└── demo/                    # unlabelled recordings for the live demo
    └── *.txt
```

`raw2` follows the same 28-column format and the same five class folders as
`raw`. It contains 28 recordings and 94 repetitions survive the default
`min_length=40` filter. `combined/` is not shipped: build it by copying the two
labelled sets into one tree with prefixed file names, or simply pass both roots
to the training script:

```bash
# group CV on Data2, with Data1 used only as extra training data
python -m rehab_cls.train --data-root data/raw2 --extra-data-root data/raw \
    --cv 5 --val-frac 0.25 --features raw_delta --per-recording-norm \
    --hidden 96 --dropout 0.4 --epochs 80 --patience 15
```

`data/` is listed in `.gitignore` on purpose.

## Recording format

One line = one frame. Values are separated by `,` or `/`:

```
r,39534,813639,61/63/38/61,0/100/-113/-4,0/0/0/0,392/-440/-84,0/0,-1870/-1576/-12086,-264/113/398,-1610/-9/327,,#
```

* `r` — a regular frame carrying 28 numbers.
* `s,0,,#` — a **segment boundary**: the subject finished one repetition and
  started the next one. A recording holds three to five of them.
* `,#` — end-of-line marker.

The 28 columns are documented in `src/rehab_cls/data.py`; eight of them are
recording metadata (`frame_id`, `timestamp`) or constant zero, and are dropped
by default.

## Sanity check

After placing the files:

```bash
python scripts/check_data.py --root data/raw
```

It prints the number of recordings, repetitions and the length distribution per
class, and fails loudly if the layout is wrong.
