"""Dataset parsing and loading for the rehabilitation motion task.

Raw recordings
--------------
Each recording is a plain-text file.  One line is one frame, and every numeric
value is separated either by ``','`` or by ``'/'``::

    r,39534,813639,61/63/38/61,0/100/-113/-4,0/0/0/0,392/-440/-84,0/0,<...>,,#

Two non-data records appear in the files:

``r``  regular frame (28 numeric values).
``s``  segment boundary: the subject finished one repetition of the exercise
       and started the next one.  These lines carry no motion information.

The trailing ``,#`` is an end-of-line marker.

Because one file usually contains three or four repetitions, the parser keeps
the repetitions apart.  Treating a whole file as a single sequence (the
original approach) mixes several reps into one sample and dilutes the
attention map; splitting on ``s`` triples the number of training samples.

Feature columns
---------------
The 28 raw columns are, in order:

===== ==========================================
index content
===== ==========================================
0     frame counter (monotonic, recording meta)
1     timestamp in ms (monotonic, recording meta)
2-5   joint angles
6-9   joint angular velocities
10-13 accelerometer block (constant 0 in this release)
14-16 position block
17-18 auxiliary block (constant 0 in this release)
19-21 linear acceleration block
22-24 angular rate block
25-27 gravity / orientation block
===== ==========================================

Columns 0 and 1 are recording metadata rather than motion, and columns
10-13, 17 and 18 are exactly zero in every frame of the released dataset.
``DEFAULT_DROP_COLUMNS`` removes all eight, leaving 20 informative channels.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Sequence, Tuple

import numpy as np

#: Number of numeric columns produced by one ``r`` record.
RAW_DIM = 28

#: Columns that carry recording metadata instead of motion.
METADATA_COLUMNS: Tuple[int, ...] = (0, 1)

#: Columns that are constant zero for every frame of both released datasets.
CONSTANT_COLUMNS: Tuple[int, ...] = (10, 11, 12, 13, 17, 18)

DEFAULT_DROP_COLUMNS: Tuple[int, ...] = METADATA_COLUMNS + CONSTANT_COLUMNS

#: Default class order.  Kept fixed so checkpoints stay comparable.
DEFAULT_LABELS: Tuple[str, ...] = (
    "circle",
    "diagonal_left",
    "diagonal_right",
    "horizontal",
    "vertical",
)


# --------------------------------------------------------------------------- #
# Parsing
# --------------------------------------------------------------------------- #
def _numbers(field: str) -> List[float]:
    """Extract every number from one comma-separated field."""
    if not field:
        return []
    out: List[float] = []
    for token in field.replace("/", ",").split(","):
        token = token.strip()
        if not token:
            continue
        try:
            out.append(float(token))
        except ValueError:
            # Tolerate stray characters such as the trailing '#'.  Anything
            # that still looks like a number is kept, the rest is discarded.
            cleaned = "".join(ch if (ch.isdigit() or ch in "-+.") else " " for ch in token)
            for piece in cleaned.split():
                try:
                    out.append(float(piece))
                except ValueError:
                    continue
    return out


def parse_recording(path: str, split_repetitions: bool = True) -> List[np.ndarray]:
    """Parse one recording into a list of repetitions.

    Returns a list of ``(T, RAW_DIM)`` float32 arrays.  Empty repetitions
    (consecutive ``s`` markers) are dropped.  With
    ``split_repetitions=False`` the whole file is returned as a single array,
    which reproduces the behaviour of the original implementation.
    """
    segments: List[List[List[float]]] = [[]]
    with open(path, "r", encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            fields = line.split(",")
            head = fields[0].strip()

            if head == "s":
                # Start of a new repetition.
                if split_repetitions and segments[-1]:
                    segments.append([])
                continue
            if head != "r":
                continue

            values: List[float] = []
            for column in fields[1:]:
                values.extend(_numbers(column))
            if len(values) < RAW_DIM:
                # A truncated record cannot be aligned with the others.
                continue
            segments[-1].append(values[:RAW_DIM])

    parsed = [np.asarray(seg, dtype=np.float32) for seg in segments if seg]
    return [seg for seg in parsed if seg.shape[0] > 0]


def feature_indices(drop_columns: Sequence[int] = DEFAULT_DROP_COLUMNS) -> np.ndarray:
    """Column indices kept after dropping the given raw columns."""
    drop = set(int(c) for c in drop_columns)
    return np.asarray([i for i in range(RAW_DIM) if i not in drop], dtype=np.int64)


# --------------------------------------------------------------------------- #
# Containers
# --------------------------------------------------------------------------- #
@dataclass
class Segment:
    """One repetition of an exercise."""

    frames: np.ndarray          # (T, D) already column-selected, not normalised
    label: int
    source: str                 # recording file name (group id)
    index: int                  # repetition index inside the recording
    label_name: str = ""

    @property
    def length(self) -> int:
        return int(self.frames.shape[0])


@dataclass
class MotionData:
    """A split of segments plus the label vocabulary."""

    segments: List[Segment]
    labels: List[str]
    classes: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.int64))

    def __len__(self) -> int:
        return len(self.segments)

    def class_counts(self) -> Dict[str, int]:
        counts = {name: 0 for name in self.labels}
        for seg in self.segments:
            counts[self.labels[seg.label]] += 1
        return counts

    def groups(self) -> List[str]:
        return [seg.source for seg in self.segments]


# --------------------------------------------------------------------------- #
# Loading
# --------------------------------------------------------------------------- #
def discover_recordings(root: str, labels: Sequence[str] = DEFAULT_LABELS) -> List[Tuple[str, str]]:
    """List ``(path, label)`` pairs under a ``root/<label>/<file>.txt`` tree."""
    if not os.path.isdir(root):
        raise FileNotFoundError(
            f"Dataset root not found: {root}\n"
            "Expected <root>/<class name>/*.txt, e.g. <root>/circle/1.txt"
        )
    found: List[Tuple[str, str]] = []
    for label in labels:
        folder = os.path.join(root, label)
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            if name.lower().endswith(".txt"):
                found.append((os.path.join(folder, name), label))
    return found


def load_segments(
    root: str,
    labels: Sequence[str] = DEFAULT_LABELS,
    drop_columns: Sequence[int] = DEFAULT_DROP_COLUMNS,
    min_length: int = 40,
    max_length: int | None = None,
    split_repetitions: bool = True,
) -> MotionData:
    """Load every repetition under ``root`` into memory.

    Parameters
    ----------
    min_length:
        Repetitions shorter than this are discarded.  The recordings contain
        truncated head/tail repetitions (as short as a single frame) that carry
        no usable motion.
    split_repetitions:
        When ``False`` the whole file is treated as one sample.  This
        reproduces the behaviour of the original implementation and is only
        kept for the ablation in the report.
    """
    labels = list(labels)
    label_to_idx = {name: i for i, name in enumerate(labels)}
    keep = feature_indices(drop_columns)

    segments: List[Segment] = []
    for path, label in discover_recordings(root, labels):
        reps = parse_recording(path, split_repetitions=split_repetitions)
        for rep_idx, rep in enumerate(reps):
            if rep.shape[0] < min_length:
                continue
            if max_length is not None:
                rep = rep[:max_length]
            segments.append(
                Segment(
                    frames=rep[:, keep].astype(np.float32),
                    label=label_to_idx[label],
                    source=os.path.relpath(path, root),
                    index=rep_idx,
                    label_name=label,
                )
            )

    if not segments:
        raise RuntimeError(
            f"No usable repetitions found under {root}. "
            f"Check the folder layout and the minimum length ({min_length})."
        )
    return MotionData(segments=segments, labels=labels)


# --------------------------------------------------------------------------- #
# Splitting
# --------------------------------------------------------------------------- #
def stratify_by_source(data: MotionData) -> Tuple[np.ndarray, np.ndarray]:
    """Return ``(source_names, source_labels)`` one entry per recording."""
    seen: Dict[str, int] = {}
    for seg in data.segments:
        seen.setdefault(seg.source, seg.label)
    names = np.asarray(sorted(seen))
    targets = np.asarray([seen[name] for name in names])
    return names, targets


def split_by_source(
    data: MotionData,
    ratios: Tuple[float, float, float] = (0.7, 0.15, 0.15),
    seed: int = 42,
) -> Dict[str, MotionData]:
    """Split by *recording*, not by repetition.

    Repetitions coming from the same recording are strongly correlated, so
    putting some of them in train and the rest in test leaks information and
    inflates the score.  The split is therefore computed on the file level and
    then propagated to every repetition of that file.
    """
    from sklearn.model_selection import train_test_split

    names, targets = stratify_by_source(data)
    train_r, dev_r = ratios[0], ratios[1] + ratios[2]

    def _split(x, y, size, seed_):
        """Stratified when the classes are big enough, plain otherwise."""
        try:
            return train_test_split(x, y, train_size=size, random_state=seed_, stratify=y)
        except ValueError:
            if len(x) < 2:
                return x, x[:0], y, y[:0]
            cut = max(1, min(len(x) - 1, int(round(len(x) * size))))
            return x[:cut], x[cut:], y[:cut], y[cut:]

    train_names, rest_names, _, rest_targets = _split(names, targets, train_r, seed)
    if len(rest_names) < 2:
        val_names, test_names = rest_names, rest_names[:0]
    else:
        rel = ratios[2] / max(dev_r, 1e-9)
        val_names, test_names, _, _ = _split(rest_names, rest_targets, 1.0 - rel, seed)

    buckets = {
        "train": set(train_names.tolist()),
        "val": set(val_names.tolist()),
        "test": set(test_names.tolist()),
    }
    out: Dict[str, MotionData] = {}
    for split, members in buckets.items():
        out[split] = MotionData(
            segments=[s for s in data.segments if s.source in members],
            labels=data.labels,
        )
    return out


# --------------------------------------------------------------------------- #
# Normalisation
# --------------------------------------------------------------------------- #
class FeatureScaler:
    """Per-channel z-score normalisation fitted on the training split only.

    The raw channels span four orders of magnitude (joint angles are ~60,
    acceleration is ~1e4).  Without scaling, the first LSTM layer saturates and
    the small but informative channels are effectively invisible.
    """

    def __init__(self, mean: np.ndarray, std: np.ndarray, clip: float = 5.0):
        self.mean = np.asarray(mean, dtype=np.float32)
        self.std = np.asarray(std, dtype=np.float32)
        self.clip = float(clip)

    @classmethod
    def fit(cls, segments: Iterable[Segment], clip: float = 5.0,
            feature_mode: str = "raw") -> "FeatureScaler":
        frames = [build_features(seg.frames, feature_mode) for seg in segments]
        if not frames:
            raise ValueError("Cannot fit the scaler on an empty split")
        stacked = np.concatenate(frames, axis=0)
        mean = stacked.mean(axis=0)
        std = stacked.std(axis=0)
        std = np.where(std < 1e-6, 1.0, std)
        return cls(mean, std, clip=clip)

    def transform(self, frames: np.ndarray) -> np.ndarray:
        out = (frames.astype(np.float32) - self.mean) / self.std
        if self.clip:
            out = np.clip(out, -self.clip, self.clip)
        return out.astype(np.float32)

    def to_dict(self) -> Dict[str, object]:
        return {
            "mean": self.mean.tolist(),
            "std": self.std.tolist(),
            "clip": self.clip,
        }

    @classmethod
    def from_dict(cls, payload: Dict[str, object]) -> "FeatureScaler":
        return cls(payload["mean"], payload["std"], clip=float(payload["clip"]))


# --------------------------------------------------------------------------- #
# Augmentation
# --------------------------------------------------------------------------- #
def time_warp(frames: np.ndarray, factor: float) -> np.ndarray:
    """Resample the sequence along time by ``factor`` (1.0 = unchanged)."""
    length = int(round(frames.shape[0] * factor))
    length = max(length, 4)
    src = np.linspace(0.0, 1.0, num=frames.shape[0], dtype=np.float32)
    dst = np.linspace(0.0, 1.0, num=length, dtype=np.float32)
    warped = np.stack(
        [np.interp(dst, src, frames[:, c]).astype(np.float32) for c in range(frames.shape[1])],
        axis=1,
    )
    return warped


def augment(
    frames: np.ndarray,
    rng: np.random.Generator,
    p_warp: float = 0.5,
    p_jitter: float = 0.5,
    p_scale: float = 0.3,
    jitter_sigma: float = 0.05,
) -> np.ndarray:
    """Light, label-preserving augmentation.

    The dataset holds only ~30 recordings, so augmentation is the cheapest way
    to reduce over-fitting.  Speed (time warping), sensor noise (jitter) and
    amplitude (scale) are perturbed; the shape of the trajectory is preserved.
    """
    out = frames
    if rng.random() < p_warp:
        out = time_warp(out, float(rng.uniform(0.85, 1.15)))
    if rng.random() < p_scale:
        out = out * float(rng.uniform(0.95, 1.05))
    if rng.random() < p_jitter:
        out = out + rng.normal(0.0, jitter_sigma, size=out.shape).astype(np.float32)
    return out.astype(np.float32)


# --------------------------------------------------------------------------- #
# Feature construction
# --------------------------------------------------------------------------- #
FEATURE_MODES = ("raw", "raw_delta")


def build_features(frames: np.ndarray, mode: str = "raw") -> np.ndarray:
    """Optionally append first-order differences (velocity) to the raw channels.

    Which joint moves *and how fast* separates a circle from a straight line
    far better than position alone, so the derivative channels carry most of
    the discriminative signal for this task.
    """
    if mode == "raw":
        return frames
    if mode == "raw_delta":
        delta = np.diff(frames, axis=0, prepend=frames[:1])
        return np.concatenate([frames, delta], axis=1).astype(np.float32)
    raise ValueError(f"Unknown feature mode: {mode}")


def normalise_segments_per_recording(segments: Sequence[Segment]) -> Sequence[Segment]:
    """Subtract each recording's own mean/std from all of its repetitions."""
    by_source: Dict[str, List[np.ndarray]] = {}
    for seg in segments:
        by_source.setdefault(seg.source, []).append(seg.frames)

    stats = {}
    for src, frames_list in by_source.items():
        stacked = np.concatenate(frames_list, axis=0)
        mean, std = stacked.mean(0), stacked.std(0)
        stats[src] = (mean, np.where(std < 1e-6, 1.0, std))

    for seg in segments:
        mean, std = stats[seg.source]
        seg.frames = ((seg.frames - mean) / std).astype(np.float32)
    return segments


def normalise_per_recording(data: MotionData) -> MotionData:
    """Remove the per-recording offset of every channel.

    Sensor placement and subject posture shift all channels by a constant per
    session.  Subtracting the recording mean keeps the shape of the movement and
    drops that nuisance factor.
    """
    normalise_segments_per_recording(data.segments)
    return data


# --------------------------------------------------------------------------- #
# Torch glue
# --------------------------------------------------------------------------- #
def _torch():
    import torch  # imported lazily so the parsing helpers stay torch-free

    return torch


class MotionDataset:
    """``torch.utils.data.Dataset`` over normalised repetitions.

    ``scaler`` is applied lazily so the arrays stay small in memory.
    """

    def __init__(
        self,
        segments: Sequence[Segment],
        scaler: FeatureScaler,
        augmenter: np.random.Generator | None = None,
        feature_mode: str = "raw",
    ):
        self.segments = list(segments)
        self.scaler = scaler
        self.augmenter = augmenter
        self.feature_mode = feature_mode

    def __len__(self) -> int:
        return len(self.segments)

    def __getitem__(self, idx: int):
        seg = self.segments[idx]
        frames = seg.frames
        if self.augmenter is not None:
            frames = augment(frames, self.augmenter)
        frames = self.scaler.transform(build_features(frames, self.feature_mode))
        item = {
            "x": _torch().from_numpy(frames),
            "y": _torch().tensor(seg.label, dtype=_torch().long),
            "length": _torch().tensor(frames.shape[0], dtype=_torch().long),
            "source": seg.source,
            "index": seg.index,
        }
        return item


def collate(batch: Sequence[dict]) -> dict:
    """Pad a batch and build the validity mask used by the attention layer."""
    torch = _torch()
    lengths = torch.stack([item["length"] for item in batch])
    max_len = int(lengths.max().item())
    dim = batch[0]["x"].shape[1]

    padded = torch.zeros(len(batch), max_len, dim, dtype=torch.float32)
    for i, item in enumerate(batch):
        padded[i, : item["x"].shape[0]] = item["x"]

    steps = torch.arange(max_len).unsqueeze(0)
    mask = steps < lengths.unsqueeze(1)          # True = real time step

    return {
        "x": padded,
        "mask": mask,
        "y": torch.stack([item["y"] for item in batch]),
        "lengths": lengths,
        "source": [item["source"] for item in batch],
        "index": [int(item["index"]) for item in batch],
    }
