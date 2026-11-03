"""Classical baseline: hand-crafted statistics + linear / RBF models.

The report claims the LSTM beats "baseline methods"; this script makes that
claim checkable instead of rhetorical.  Each repetition is summarised by simple
descriptive statistics per channel (mean, std, min, max, slope, path length)
and classified with a standard scikit-learn model.

    python -m rehab_cls.baseline --data-root data/raw
"""

from __future__ import annotations

import argparse
import os
from typing import List

import numpy as np

from .data import DEFAULT_DROP_COLUMNS, DEFAULT_LABELS, MotionData, load_segments, split_by_source
from .metrics import classification_metrics, format_metrics
from .utils import write_json


def summarise(frames: np.ndarray) -> np.ndarray:
    """Turn a ``(T, D)`` repetition into a fixed-length feature vector."""
    t = np.arange(frames.shape[0], dtype=np.float32)
    t = (t - t[-1] / 2.0) / max(t[-1], 1.0)          # centred, scaled time
    slope = (t[:, None] * frames).sum(axis=0) / max((t**2).sum(), 1e-6)
    diff = np.abs(np.diff(frames, axis=0)).sum(axis=0) if frames.shape[0] > 1 else np.zeros(frames.shape[1])
    return np.concatenate(
        [frames.mean(0), frames.std(0), frames.min(0), frames.max(0), slope, diff]
    )


def featurise(data: MotionData) -> tuple:
    x = np.stack([summarise(seg.frames) for seg in data.segments])
    y = np.asarray([seg.label for seg in data.segments])
    return x, y


def main(argv: List[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Classical baseline for comparison.")
    p.add_argument("--data-root", required=True)
    p.add_argument("--min-length", type=int, default=40)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--seeds", type=int, default=1)
    p.add_argument("--cv", type=int, default=0, help="0 = hold-out, N = N-fold group CV")
    p.add_argument("--out-json", default=None)
    args = p.parse_args(argv)

    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    from sklearn.svm import SVC

    data = load_segments(args.data_root, labels=DEFAULT_LABELS,
                         drop_columns=DEFAULT_DROP_COLUMNS, min_length=args.min_length)

    models = {
        "logreg": lambda: make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=1.0)),
        "svm_rbf": lambda: make_pipeline(
            StandardScaler(),
            SVC(kernel="rbf", C=10.0, gamma="scale", probability=True, random_state=0),
        ),
    }

    results = {name: {"accuracy": [], "macro_f1": [], "rec_accuracy": [], "rec_macro_f1": []}
               for name in models}

    def folds(seed: int):
        if args.cv <= 1:
            yield split_by_source(data, seed=seed)
            return
        from sklearn.model_selection import StratifiedGroupKFold

        names = np.asarray(sorted(set(data.groups())))
        lookup = {s.source: s.label for s in data.segments}
        targets = np.asarray([lookup[n] for n in names])
        cv = StratifiedGroupKFold(n_splits=args.cv, shuffle=True, random_state=seed)
        for train_idx, test_idx in cv.split(names, targets, groups=names):
            train_names = set(names[train_idx].tolist())
            test_names = set(names[test_idx].tolist())
            yield {
                "train": MotionData([s for s in data.segments if s.source in train_names], data.labels),
                "test": MotionData([s for s in data.segments if s.source in test_names], data.labels),
            }

    for offset in range(args.seeds):
        seed = args.seed + offset
        for split in folds(seed):
            x_tr, y_tr = featurise(split["train"])
            x_te, y_te = featurise(split["test"])
            for name, factory in models.items():
                clf = factory().fit(x_tr, y_tr)
                pred = clf.predict(x_te)
                metrics = classification_metrics(y_te, pred, data.labels)
                results[name]["accuracy"].append(metrics["accuracy"])
                results[name]["macro_f1"].append(metrics["macro_f1"])

                # Recording-level vote: same aggregation the LSTM uses, so the
                # two models can be compared on the question the brief asks.
                proba = clf.predict_proba(x_te)
                by_source = {}
                truth = {}
                for i, seg in enumerate(split["test"].segments):
                    by_source.setdefault(seg.source, []).append(proba[i])
                    truth[seg.source] = seg.label
                sources = sorted(by_source)
                rec_true = [truth[s] for s in sources]
                rec_pred = [int(np.mean(np.stack(by_source[s]), axis=0).argmax()) for s in sources]
                rec = classification_metrics(rec_true, rec_pred, data.labels)
                results[name]["rec_accuracy"].append(rec["accuracy"])
                results[name]["rec_macro_f1"].append(rec["macro_f1"])
                if offset == 0 and name == "logreg":
                    print(f"[{name}] n_train={len(y_tr)} n_test={len(y_te)} "
                          f"acc {metrics['accuracy']:.3f} macro-F1 {metrics['macro_f1']:.3f}")

    summary = {
        name: {
            "accuracy_mean": float(np.mean(v["accuracy"])),
            "accuracy_std": float(np.std(v["accuracy"])),
            "macro_f1_mean": float(np.mean(v["macro_f1"])),
            "macro_f1_std": float(np.std(v["macro_f1"])),
            "recording_accuracy_mean": float(np.mean(v["rec_accuracy"])),
            "recording_accuracy_std": float(np.std(v["rec_accuracy"])),
            "recording_macro_f1_mean": float(np.mean(v["rec_macro_f1"])),
            "recording_macro_f1_std": float(np.std(v["rec_macro_f1"])),
        }
        for name, v in results.items()
    }
    for name, row in summary.items():
        print(f"=== {name}")
        print(f"    per repetition: accuracy {row['accuracy_mean']:.4f} ± {row['accuracy_std']:.4f} | "
              f"macro-F1 {row['macro_f1_mean']:.4f} ± {row['macro_f1_std']:.4f}")
        print(f"    per recording : accuracy {row['recording_accuracy_mean']:.4f} ± "
              f"{row['recording_accuracy_std']:.4f} | macro-F1 {row['recording_macro_f1_mean']:.4f} ± "
              f"{row['recording_macro_f1_std']:.4f}")

    if args.out_json:
        write_json(args.out_json, summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
