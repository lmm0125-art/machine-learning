# Data

The recordings are course material provided by Hanyang University and Hexar
Humancare through the LMS. **They are not redistributed in this repository.**
Download them from the course page and place them as shown below.

```
data/
├── raw/                     # labelled recordings (Data1, distributed week 11)
│   ├── circle/*.txt
│   ├── diagonal_left/*.txt
│   ├── diagonal_right/*.txt
│   ├── horizontal/*.txt
│   └── vertical/*.txt
└── demo/                    # unlabelled recordings for the live demo
    └── *.txt
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
