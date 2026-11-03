"""Run the trained model on unlabelled recordings (the demo folder).

    python -m rehab_cls.predict --checkpoint runs/exp/checkpoint.pt \
        --input data/demo --out-dir runs/predict

For every recording the script reports

* a prediction per repetition, and
* a prediction per recording, obtained by averaging the repetition
  probabilities (a small ensemble over the reps the patient performed).

Averaging matters: a single recording holds 3-4 repetitions and one of them is
usually a truncated warm-up.  The recording-level vote is noticeably more stable
than reading a single repetition.
"""

from __future__ import annotations

import argparse
import csv
import os
from collections import defaultdict
from typing import Dict, List

import numpy as np
import torch

from .data import (
    Segment,
    build_features,
    feature_indices,
    normalise_segments_per_recording,
    parse_recording,
)
from .plotting import plot_attention
from .utils import load_checkpoint, resolve_device

csv.field_size_limit(10**7)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Predict exercise classes for unlabelled recordings.")
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--input", required=True, help="folder holding flat *.txt recordings")
    p.add_argument("--out-dir", default="runs/predict")
    p.add_argument("--min-length", type=int, default=40)
    p.add_argument("--max-plots", type=int, default=12,
                   help="how many attention heat-maps to write (0 = none)")
    p.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda", "mps"])
    return p


def load_unlabelled(folder: str, keep: np.ndarray, min_length: int) -> List[Segment]:
    segments: List[Segment] = []
    for name in sorted(os.listdir(folder)):
        if not name.lower().endswith(".txt"):
            continue
        path = os.path.join(folder, name)
        for rep_idx, rep in enumerate(parse_recording(path)):
            if rep.shape[0] < min_length:
                continue
            segments.append(
                Segment(frames=rep[:, keep].astype(np.float32), label=-1,
                        source=name, index=rep_idx)
            )
    return segments


def main(argv: List[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    device = resolve_device(args.device)
    model, payload = load_checkpoint(args.checkpoint, device=device)

    labels: List[str] = payload["labels"]
    drop = payload["drop_columns"]
    keep = feature_indices(drop)

    from .data import FeatureScaler

    scaler = FeatureScaler.from_dict(payload["scaler"])
    metadata = payload.get("metadata", {})
    features = metadata.get("features", "raw")

    expected = payload["model_config"]["input_dim"]
    found = len(keep) * (2 if features == "raw_delta" else 1)
    if found != expected:
        raise SystemExit(
            f"Checkpoint expects {expected} input channels but this code produces {found}. "
            "The checkpoint was trained with a different feature layout."
        )

    segments = load_unlabelled(args.input, keep, args.min_length)
    if metadata.get("per_recording_norm"):
        normalise_segments_per_recording(segments)
    if not segments:
        raise SystemExit(f"No repetition of at least {args.min_length} frames found in {args.input}")

    os.makedirs(args.out_dir, exist_ok=True)

    rows: List[Dict[str, object]] = []
    per_file: Dict[str, List[np.ndarray]] = defaultdict(list)
    attention_cache: Dict[tuple, np.ndarray] = {}

    model.eval()
    with torch.no_grad():
        for seg in segments:
            frame_features = scaler.transform(build_features(seg.frames, features))
            assert frame_features.shape[1] == payload["model_config"]["input_dim"]
            x = torch.from_numpy(frame_features).unsqueeze(0).to(device)
            logits, weights = model(x)
            probs = torch.softmax(logits, dim=1)[0].cpu().numpy()
            pred = int(probs.argmax())
            per_file[seg.source].append(probs)
            attention_cache[(seg.source, seg.index)] = weights[0, : seg.length].cpu().numpy()
            rows.append(
                {
                    "file": seg.source,
                    "repetition": seg.index,
                    "frames": seg.length,
                    "prediction": labels[pred],
                    "confidence": round(float(probs[pred]), 4),
                    **{f"p_{lab}": round(float(p), 4) for lab, p in zip(labels, probs)},
                }
            )

    # Recording-level vote.
    file_rows = []
    for source, probs_list in per_file.items():
        mean_probs = np.mean(np.stack(probs_list, axis=0), axis=0)
        pred = int(mean_probs.argmax())
        file_rows.append(
            {
                "file": source,
                "repetitions": len(probs_list),
                "prediction": labels[pred],
                "confidence": round(float(mean_probs[pred]), 4),
                **{f"p_{lab}": round(float(p), 4) for lab, p in zip(labels, mean_probs)},
            }
        )
        # Agreement between repetitions is a free uncertainty signal.
        predictions = [labels[int(p.argmax())] for p in probs_list]
        agreement = predictions.count(labels[pred]) / len(predictions)
        file_rows[-1]["vote_agreement"] = round(agreement, 3)

    file_rows.sort(key=lambda r: r["file"])
    rows.sort(key=lambda r: (r["file"], r["repetition"]))

    rep_csv = os.path.join(args.out_dir, "predictions_per_repetition.csv")
    file_csv = os.path.join(args.out_dir, "predictions_per_recording.csv")
    for path, data in ((rep_csv, rows), (file_csv, file_rows)):
        with open(path, "w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(data[0].keys()))
            writer.writeheader()
            writer.writerows(data)

    print(f"{'recording':<28s} {'reps':>4s}  {'prediction':<15s} {'conf':>6s}  {'agreement':>9s}")
    for row in file_rows:
        print(f"{row['file']:<28s} {row['repetitions']:>4d}  {row['prediction']:<15s} "
              f"{row['confidence']:>6.3f}  {row['vote_agreement']:>9.3f}")

    if args.max_plots:
        plots_dir = os.path.join(args.out_dir, "attention")
        os.makedirs(plots_dir, exist_ok=True)
        for (source, index), weights in list(attention_cache.items())[: args.max_plots]:
            stem = os.path.splitext(source)[0]
            plot_attention(
                weights,
                os.path.join(plots_dir, f"{stem}_rep{index}.png"),
                title=f"{source} · repetition {index}",
            )
        print(f"attention heat-maps -> {plots_dir}")

    print(f"per-repetition -> {rep_csv}")
    print(f"per-recording -> {file_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
