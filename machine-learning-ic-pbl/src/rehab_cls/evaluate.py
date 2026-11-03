"""Evaluate a trained checkpoint on a labelled folder and produce report figures.

    python -m rehab_cls.evaluate --checkpoint runs/exp/checkpoint.pt \
        --data-root data/raw --figures-dir docs/figures

Figures written
---------------
``confusion.png``             confusion matrix on the labelled data
``attention_examples.png``    attention of a few repetitions
``attention_profile.png``     mean attention per class, aligned in relative time
"""

from __future__ import annotations

import argparse
import os
from collections import defaultdict
from typing import Dict, List

import numpy as np
import torch
from torch.utils.data import DataLoader

from .data import (
    MotionData,
    MotionDataset,
    collate,
    load_segments,
    normalise_per_recording,
    split_by_source,
)
from .metrics import classification_metrics, confusion_matrix, format_metrics
from .plotting import plot_attention_grid, plot_class_attention_profile, plot_confusion
from .utils import load_checkpoint, resolve_device, write_json

N_BINS = 24


def relative_attention(weights: np.ndarray, length: int, n_bins: int = N_BINS) -> np.ndarray:
    """Re-bin attention weights by relative position inside the repetition.

    Raw indices are not comparable across repetitions (100 vs 60 frames), but
    "where in the movement" is.  Each weight is dropped into one of ``n_bins``
    buckets, then the buckets are averaged.
    """
    used = weights[:length]
    if used.size == 0:
        return np.zeros(n_bins, dtype=np.float32)
    idx = np.floor(np.linspace(0, n_bins, num=used.size, endpoint=False)).astype(int)
    idx = np.clip(idx, 0, n_bins - 1)
    bins = np.bincount(idx, weights=used, minlength=n_bins).astype(np.float32)
    counts = np.bincount(idx, minlength=n_bins).astype(np.float32)
    return np.divide(bins, counts, out=np.zeros_like(bins), where=counts > 0)


def collect_outputs(model, loader, device) -> Dict[str, object]:
    model.eval()
    y_true, y_pred, sources, lengths = [], [], [], []
    probs, attention = [], []
    with torch.no_grad():
        for batch in loader:
            x = batch["x"].to(device)
            mask = batch["mask"].to(device)
            logits, weights = model(x, mask)
            y_true.extend(batch["y"].tolist())
            y_pred.extend(logits.argmax(1).cpu().tolist())
            probs.append(torch.softmax(logits, dim=1).cpu().numpy())
            attention.extend(weights.cpu().numpy())
            lengths.extend(batch["lengths"].tolist())
            sources.extend(batch["source"])
    return {
        "y_true": np.asarray(y_true),
        "y_pred": np.asarray(y_pred),
        "probs": np.concatenate(probs, axis=0) if probs else np.zeros((0, 1)),
        "attention": attention,
        "lengths": lengths,
        "sources": sources,
    }


def main(argv: List[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Evaluate a trained checkpoint.")
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--data-root", required=True)
    p.add_argument("--split", default="test", choices=["train", "val", "test", "all"],
                   help="re-create a split with the seed stored in the checkpoint, or score everything")
    p.add_argument("--min-length", type=int, default=40)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda", "mps"])
    p.add_argument("--figures-dir", default=None)
    p.add_argument("--out-json", default=None)
    args = p.parse_args(argv)

    device = resolve_device(args.device)
    model, payload = load_checkpoint(args.checkpoint, device=device)
    labels = payload["labels"]
    drop = payload["drop_columns"]

    metadata = payload.get("metadata", {})
    features = metadata.get("features", "raw")

    data = load_segments(args.data_root, labels=labels, drop_columns=drop,
                         min_length=args.min_length)
    if metadata.get("per_recording_norm"):
        data = normalise_per_recording(data)
    if args.split == "all":
        subset = data
    elif metadata.get("split") and args.split in metadata["split"]:
        # The checkpoint remembers which recordings it was trained on, so the
        # held-out set can be rebuilt exactly instead of guessed from a seed.
        members = set(metadata["split"][args.split])
        subset = MotionData([s for s in data.segments if s.source in members], data.labels)
    else:
        seed = int(metadata.get("seed", 42))
        subset = split_by_source(data, seed=seed)[args.split]

    dataset = MotionDataset(subset.segments, _scaler_from(payload), feature_mode=features)
    loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=False, collate_fn=collate)
    out = collect_outputs(model, loader, device)

    metrics = classification_metrics(out["y_true"], out["y_pred"], labels)
    print(f"split: {args.split} | n={metrics['n_samples']}")
    print(format_metrics(metrics, labels))

    if args.figures_dir:
        os.makedirs(args.figures_dir, exist_ok=True)
        plot_confusion(
            confusion_matrix(out["y_true"], out["y_pred"], len(labels)),
            labels,
            os.path.join(args.figures_dir, "confusion.png"),
            title=f"Confusion matrix ({args.split})",
        )

        # One or two correctly classified examples per class makes the
        # explainability story concrete: the peak should sit on an informative
        # phase, not on padding.
        picks: List[int] = []
        quota = {name: 0 for name in labels}
        for i, (true, pred) in enumerate(zip(out["y_true"], out["y_pred"])):
            if true != pred:
                continue
            name = labels[true]
            if quota[name] < 1:
                picks.append(i)
                quota[name] += 1
        if not picks:
            picks = list(range(min(6, len(out["y_true"]))))
        samples = [
            {
                "weights": out["attention"][i],
                "length": out["lengths"][i],
                "label": labels[out["y_true"][i]],
            }
            for i in picks
        ]
        if samples:
            plot_attention_grid(samples, os.path.join(args.figures_dir, "attention_examples.png"))

        per_class_bins: Dict[str, List[np.ndarray]] = defaultdict(list)
        for i, true_label in enumerate(out["y_true"]):
            per_class_bins[labels[true_label]].append(
                relative_attention(out["attention"][i], out["lengths"][i])
            )
        profiles = {k: np.mean(v, axis=0) for k, v in per_class_bins.items() if v}
        if profiles:
            plot_class_attention_profile(profiles, os.path.join(args.figures_dir, "attention_profile.png"))

    if args.out_json:
        write_json(args.out_json, {"split": args.split, "metrics": metrics,
                                  "sources": out["sources"],
                                  "y_true": out["y_true"].tolist(),
                                  "y_pred": out["y_pred"].tolist()})
    return 0


def _scaler_from(payload):
    from .data import FeatureScaler

    return FeatureScaler.from_dict(payload["scaler"])


if __name__ == "__main__":
    raise SystemExit(main())
