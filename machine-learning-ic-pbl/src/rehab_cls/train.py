"""Train and evaluate the explainable LSTM-attention classifier.

Two evaluation protocols are available:

``--cv 0`` (default)
    One stratified split of *recordings* into train / val / test.
``--cv 5``
    Repeated stratified group k-fold over recordings.  With only 34 recordings a
    single split is extremely noisy, so the report quotes the mean and standard
    deviation of the folds instead of one lucky number.

Both protocols split **whole recordings**, never single repetitions, and fit the
normaliser on the training part only.

Examples
--------
    python -m rehab_cls.train --data-root data/raw --out-dir runs/exp1
    python -m rehab_cls.train --data-root data/raw --cv 5 --features raw_delta
"""

from __future__ import annotations

import argparse
import copy
import os
import time
from typing import Dict, List, Sequence, Set, Tuple

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader

from .data import (
    DEFAULT_DROP_COLUMNS,
    DEFAULT_LABELS,
    FEATURE_MODES,
    FeatureScaler,
    MotionData,
    MotionDataset,
    collate,
    load_segments,
    normalise_per_recording,
    split_by_source,
    stratify_by_source,
)
from .metrics import classification_metrics, confusion_matrix, format_metrics
from .model import AttentionLSTM, ModelConfig
from .plotting import plot_confusion, plot_training_curves
from .utils import count_parameters, resolve_device, save_checkpoint, set_seed, write_json


# --------------------------------------------------------------------------- #
# Arguments
# --------------------------------------------------------------------------- #
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Train the LSTM + attention motion classifier.")
    p.add_argument("--data-root", required=True, help="dataset root, <root>/<class>/*.txt")
    p.add_argument("--out-dir", default="runs/exp", help="checkpoint, metrics and figures")
    p.add_argument("--figures-dir", default=None, help="copy report figures here as well")

    # data
    p.add_argument("--min-length", type=int, default=40,
                   help="drop repetitions shorter than this many frames")
    p.add_argument("--max-length", type=int, default=0, help="0 = keep every frame")
    p.add_argument("--features", default="raw", choices=list(FEATURE_MODES),
                   help="raw channels, or raw + first differences (velocity)")
    p.add_argument("--per-recording-norm", action="store_true",
                   help="z-score each recording against itself before training")
    p.add_argument("--no-split-reps", action="store_true",
                   help="ablation: treat a whole recording as one sample")
    p.add_argument("--leaky-split", action="store_true",
                   help="ablation: split random repetitions instead of recordings")
    p.add_argument("--no-augment", action="store_true", help="disable warping / jitter")

    # model
    p.add_argument("--hidden", type=int, default=64)
    p.add_argument("--layers", type=int, default=1)
    p.add_argument("--dropout", type=float, default=0.3)

    # optimisation
    p.add_argument("--epochs", type=int, default=120)
    p.add_argument("--patience", type=int, default=25)
    p.add_argument("--batch-size", type=int, default=16)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--weight-decay", type=float, default=1e-4)
    p.add_argument("--label-smoothing", type=float, default=0.05)

    # protocol
    p.add_argument("--cv", type=int, default=0, help="0 = single split, N = N-fold group CV")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--seeds", type=int, default=1,
                   help="extra repetitions with seeds seed..seed+N-1")
    p.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda", "mps"])
    p.add_argument("--num-threads", type=int, default=0, help="0 = leave torch default")
    p.add_argument("--quiet", action="store_true")
    p.add_argument("--train-final", action="store_true",
                   help="after CV, refit on every recording and save checkpoint_final.pt")
    p.add_argument("--final-epochs", type=int, default=0,
                   help="epochs for the refit (0 = median best epoch of the CV runs)")
    return p


# --------------------------------------------------------------------------- #
# Splitting
# --------------------------------------------------------------------------- #
def split_by_sample(data: MotionData, ratios=(0.7, 0.15, 0.15), seed: int = 42) -> Dict[str, MotionData]:
    """Leaky split, kept only for the ablation table.

    Repetitions of the same recording land on both sides of the split, so the
    score is optimistic.  The original implementation effectively did this.
    """
    from sklearn.model_selection import train_test_split

    idx = np.arange(len(data.segments))
    targets = np.asarray([s.label for s in data.segments])
    train_idx, rest_idx = train_test_split(
        idx, train_size=ratios[0], random_state=seed, stratify=targets
    )
    val_idx, test_idx = train_test_split(
        rest_idx, train_size=ratios[1] / (ratios[1] + ratios[2]),
        random_state=seed, stratify=targets[rest_idx],
    )
    pick = lambda ids: MotionData([data.segments[i] for i in ids], data.labels)  # noqa: E731
    return {"train": pick(train_idx), "val": pick(val_idx), "test": pick(test_idx)}


def _carve_validation(data: MotionData, train_names: Sequence[str], frac: float,
                      seed: int) -> Tuple[Set[str], Set[str]]:
    """Hold out ``frac`` of the training recordings for early stopping."""
    from sklearn.model_selection import train_test_split

    names, targets = stratify_by_source(data)
    lookup = dict(zip(names.tolist(), targets.tolist()))
    train_names = np.asarray(sorted(train_names))
    y = np.asarray([lookup[n] for n in train_names])

    if len(train_names) < 4:
        return set(train_names.tolist()), set()

    try:
        fit_names, val_names = train_test_split(
            train_names, train_size=1.0 - frac, random_state=seed, stratify=y
        )
    except ValueError:
        cut = max(1, int(round(len(train_names) * (1.0 - frac))))
        fit_names, val_names = train_names[:cut], train_names[cut:]
    return set(fit_names.tolist()), set(val_names.tolist())


def make_splits(data: MotionData, args, seed: int) -> List[Dict[str, MotionData]]:
    """Return one split dict per fold (a single one when ``--cv 0``)."""
    if args.leaky_split:
        return [split_by_sample(data, seed=seed)] if args.cv <= 1 else _leaky_folds(data, args.cv, seed)

    if args.cv <= 1:
        return [split_by_source(data, seed=seed)]

    from sklearn.model_selection import StratifiedGroupKFold

    names, targets = stratify_by_source(data)
    folds = StratifiedGroupKFold(n_splits=args.cv, shuffle=True, random_state=seed)
    splits: List[Dict[str, MotionData]] = []
    for fold, (train_idx, test_idx) in enumerate(folds.split(names, targets, groups=names)):
        fit_names, val_names = _carve_validation(data, names[train_idx], 0.15, seed)
        test_names = set(names[test_idx].tolist())
        splits.append(
            {
                "train": MotionData([s for s in data.segments if s.source in fit_names], data.labels),
                "val": MotionData([s for s in data.segments if s.source in val_names], data.labels),
                "test": MotionData([s for s in data.segments if s.source in test_names], data.labels),
            }
        )
        assert fit_names.isdisjoint(test_names), f"fold {fold} leaks recordings"
    return splits


def _leaky_folds(data: MotionData, n_splits: int, seed: int) -> List[Dict[str, MotionData]]:
    from sklearn.model_selection import StratifiedKFold

    idx = np.arange(len(data.segments))
    targets = np.asarray([s.label for s in data.segments])
    out = []
    for fit_idx, test_idx in StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=seed).split(idx, targets):
        cut = max(1, int(round(len(fit_idx) * 0.85)))
        val_idx, fit_idx = fit_idx[cut:], fit_idx[:cut]
        pick = lambda ids: MotionData([data.segments[i] for i in ids], data.labels)  # noqa: E731
        out.append({"train": pick(fit_idx), "val": pick(val_idx), "test": pick(test_idx)})
    return out


# --------------------------------------------------------------------------- #
# Loaders and loops
# --------------------------------------------------------------------------- #
def make_loaders(split: Dict[str, MotionData], scaler: FeatureScaler, args,
                 seed: int) -> Dict[str, DataLoader]:
    rng = np.random.default_rng(seed) if not args.no_augment else None
    loaders: Dict[str, DataLoader] = {}
    for name, part in split.items():
        dataset = MotionDataset(
            part.segments,
            scaler,
            augmenter=rng if (name == "train" and rng is not None) else None,
            feature_mode=args.features,
        )
        loaders[name] = DataLoader(
            dataset,
            batch_size=args.batch_size,
            shuffle=(name == "train"),
            collate_fn=collate,
            num_workers=0,
            generator=torch.Generator().manual_seed(seed),
        )
    return loaders


def run_epoch(model: AttentionLSTM, loader: DataLoader, device: torch.device,
              criterion: nn.Module, optimizer: torch.optim.Optimizer | None = None) -> Dict[str, object]:
    training = optimizer is not None
    model.train(training)

    total_loss, total, correct = 0.0, 0, 0
    y_true: List[int] = []
    y_pred: List[int] = []
    probs: List[np.ndarray] = []
    attention: List[np.ndarray] = []
    lengths: List[int] = []
    sources: List[str] = []

    for batch in loader:
        x = batch["x"].to(device)
        mask = batch["mask"].to(device)
        y = batch["y"].to(device)

        with torch.set_grad_enabled(training):
            logits, weights = model(x, mask)
            loss = criterion(logits, y)
            if training:
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
                optimizer.step()

        total_loss += float(loss.item()) * len(y)
        total += len(y)
        correct += int((logits.argmax(1) == y).sum().item())
        y_true.extend(y.detach().cpu().tolist())
        y_pred.extend(logits.argmax(1).detach().cpu().tolist())
        probs.append(torch.softmax(logits, dim=1).detach().cpu().numpy())
        attention.extend(weights.detach().cpu().numpy())
        lengths.extend(batch["lengths"].tolist())
        sources.extend(batch["source"])

    return {
        "loss": total_loss / max(total, 1),
        "accuracy": correct / max(total, 1),
        "y_true": np.asarray(y_true),
        "y_pred": np.asarray(y_pred),
        "probs": np.concatenate(probs, axis=0) if probs else np.zeros((0, 1)),
        "attention": attention,
        "lengths": lengths,
        "sources": sources,
    }


def aggregate_by_recording(out: Dict[str, object]) -> Tuple[np.ndarray, np.ndarray]:
    """Average repetition probabilities per recording.

    The clinical question is "which exercise did this patient perform", i.e. one
    answer per recording, not one per repetition.
    """
    buckets: Dict[str, List[np.ndarray]] = {}
    truth: Dict[str, int] = {}
    for i, source in enumerate(out["sources"]):
        buckets.setdefault(source, []).append(out["probs"][i])
        truth[source] = int(out["y_true"][i])
    sources = sorted(buckets)
    y_true = np.asarray([truth[s] for s in sources])
    y_pred = np.asarray([int(np.mean(np.stack(buckets[s]), axis=0).argmax()) for s in sources])
    return y_true, y_pred


def fit_once(data: MotionData, split: Dict[str, MotionData], args, seed: int,
             device: torch.device, tag: str) -> Dict[str, object]:
    scaler = FeatureScaler.fit(split["train"].segments, feature_mode=args.features)
    loaders = make_loaders(split, scaler, args, seed)

    config = ModelConfig(
        input_dim=int(split["train"].segments[0].frames.shape[1]) * (2 if args.features == "raw_delta" else 1),
        hidden_dim=args.hidden,
        num_layers=args.layers,
        num_classes=len(data.labels),
        dropout=args.dropout,
    )
    model = AttentionLSTM(config).to(device)
    criterion = nn.CrossEntropyLoss(label_smoothing=args.label_smoothing)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode="max", factor=0.5, patience=max(4, args.patience // 3)
    )

    history = {"train_loss": [], "val_loss": [], "train_acc": [], "val_acc": [], "val_f1": []}
    best_state, best_score, best_epoch, stale = None, -1.0, 0, 0

    for epoch in range(1, args.epochs + 1):
        train_out = run_epoch(model, loaders["train"], device, criterion, optimizer)
        val_out = run_epoch(model, loaders["val"], device, criterion)
        val_metrics = classification_metrics(val_out["y_true"], val_out["y_pred"], data.labels)

        history["train_loss"].append(train_out["loss"])
        history["train_acc"].append(train_out["accuracy"])
        history["val_loss"].append(val_out["loss"])
        history["val_acc"].append(val_metrics["accuracy"])
        history["val_f1"].append(val_metrics["macro_f1"])

        score = val_metrics["macro_f1"]
        scheduler.step(score)

        if score > best_score + 1e-9:
            best_score, best_epoch, stale = score, epoch, 0
            best_state = copy.deepcopy(model.state_dict())
        else:
            stale += 1

        if not args.quiet and (epoch % 20 == 0 or epoch == 1):
            print(f"    epoch {epoch:03d} | train {train_out['loss']:.3f} "
                  f"| val acc {val_metrics['accuracy']:.3f} | val macro-F1 {score:.3f}")

        if args.patience > 0 and stale >= args.patience:
            if not args.quiet:
                print(f"    early stop at epoch {epoch} (best epoch {best_epoch})")
            break

    # patience <= 0 means "train the full budget and keep the last weights":
    # inside a small cross-validation fold the inner validation split is too
    # small to pick an epoch reliably.
    if args.patience > 0 and best_state is not None:
        model.load_state_dict(best_state)
    else:
        best_epoch = args.epochs
    test_out = run_epoch(model, loaders["test"], device, criterion)
    test_metrics = classification_metrics(test_out["y_true"], test_out["y_pred"], data.labels)
    rec_true, rec_pred = aggregate_by_recording(test_out)
    rec_metrics = classification_metrics(rec_true, rec_pred, data.labels)

    if args.figures_dir:
        stem = f"{tag}_s{seed}"
        plot_training_curves(history, os.path.join(args.figures_dir, f"{stem}_curves.png"),
                             title=f"Training ({tag}, seed {seed})")
        plot_confusion(
            confusion_matrix(test_out["y_true"], test_out["y_pred"], len(data.labels)),
            data.labels,
            os.path.join(args.figures_dir, f"{stem}_confusion.png"),
            title=f"Test confusion, per repetition (seed {seed})",
        )

    return {
        "seed": seed,
        "model": model,
        "scaler": scaler,
        "config": config,
        "split": split,
        "history": history,
        "best_epoch": best_epoch,
        "best_val_f1": best_score,
        "test": test_out,
        "test_metrics": test_metrics,
        "recording_metrics": rec_metrics,
    }


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def train_on_everything(data: MotionData, args, seed: int, device: torch.device,
                        epochs: int) -> Tuple[AttentionLSTM, FeatureScaler]:
    """Refit on every recording with a fixed budget, for the released checkpoint.

    Cross-validation answers "how good is this model"; the artefact shipped for
    the demo should use all the data, so this second pass drops the held-out
    split and trains for the median number of epochs the folds needed.
    """
    set_seed(seed)
    scaler = FeatureScaler.fit(data.segments, feature_mode=args.features)
    dataset = MotionDataset(data.segments, scaler,
                            augmenter=np.random.default_rng(seed), feature_mode=args.features)
    loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=True,
                        collate_fn=collate, num_workers=0)

    config = ModelConfig(
        input_dim=int(data.segments[0].frames.shape[1]) * (2 if args.features == "raw_delta" else 1),
        hidden_dim=args.hidden,
        num_layers=args.layers,
        num_classes=len(data.labels),
        dropout=args.dropout,
    )
    model = AttentionLSTM(config).to(device)
    criterion = nn.CrossEntropyLoss(label_smoothing=args.label_smoothing)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)

    for epoch in range(1, epochs + 1):
        out = run_epoch(model, loader, device, criterion, optimizer)
        if not args.quiet and (epoch % 20 == 0 or epoch == 1):
            print(f"    final epoch {epoch:03d} | train loss {out['loss']:.3f} "
                  f"| train acc {out['accuracy']:.3f}")
    return model, scaler


def main(argv: List[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.num_threads:
        torch.set_num_threads(args.num_threads)
    device = resolve_device(args.device)
    os.makedirs(args.out_dir, exist_ok=True)
    print(f"device {device} | torch {torch.__version__} | features {args.features}")

    data = load_segments(
        args.data_root,
        labels=DEFAULT_LABELS,
        drop_columns=DEFAULT_DROP_COLUMNS,
        min_length=args.min_length,
        max_length=args.max_length or None,
        split_repetitions=not args.no_split_reps,
    )
    if args.per_recording_norm:
        data = normalise_per_recording(data)
    print(f"loaded {len(data.segments)} repetitions from {len(set(data.groups()))} recordings")
    print(f"class counts (repetitions): {data.class_counts()}")

    runs: List[Dict[str, object]] = []
    started = time.time()
    tag = os.path.basename(os.path.normpath(args.out_dir))

    for offset in range(args.seeds):
        seed = args.seed + offset
        set_seed(seed)
        splits = make_splits(data, args, seed)
        for fold, split in enumerate(splits):
            label = f"seed {seed}" + (f" fold {fold + 1}/{len(splits)}" if len(splits) > 1 else "")
            print(f"\n[{label}] train {len(split['train'])} / val {len(split['val'])} "
                  f"/ test {len(split['test'])} repetitions")
            result = fit_once(data, split, args, seed, device, tag)
            result["fold"] = fold
            runs.append(result)
            print(f"[{label}] TEST per repetition  acc {result['test_metrics']['accuracy']:.4f} "
                  f"macro-F1 {result['test_metrics']['macro_f1']:.4f}")
            print(f"[{label}] TEST per recording   acc {result['recording_metrics']['accuracy']:.4f} "
                  f"macro-F1 {result['recording_metrics']['macro_f1']:.4f}")

    def _stat(key: str) -> Tuple[float, float]:
        values = [r["test_metrics"][key] for r in runs]
        return float(np.mean(values)), float(np.std(values))

    def _stat_rec(key: str) -> Tuple[float, float]:
        values = [r["recording_metrics"][key] for r in runs]
        return float(np.mean(values)), float(np.std(values))

    acc_m, acc_s = _stat("accuracy")
    f1_m, f1_s = _stat("macro_f1")
    racc_m, racc_s = _stat_rec("accuracy")
    rf1_m, rf1_s = _stat_rec("macro_f1")

    print(f"\n=== {len(runs)} run(s) ===")
    print(f"per repetition : accuracy {acc_m:.4f} ± {acc_s:.4f} | macro-F1 {f1_m:.4f} ± {f1_s:.4f}")
    print(f"per recording  : accuracy {racc_m:.4f} ± {racc_s:.4f} | macro-F1 {rf1_m:.4f} ± {rf1_s:.4f}")

    summary = {
        "protocol": f"{args.cv}-fold group CV" if args.cv > 1 else ("leaky split" if args.leaky_split else "hold-out"),
        "n_runs": len(runs),
        "features": args.features,
        "per_recording_norm": bool(args.per_recording_norm),
        "per_repetition": {"accuracy_mean": acc_m, "accuracy_std": acc_s,
                           "macro_f1_mean": f1_m, "macro_f1_std": f1_s},
        "per_recording": {"accuracy_mean": racc_m, "accuracy_std": racc_s,
                          "macro_f1_mean": rf1_m, "macro_f1_std": rf1_s},
        "runs": [
            {
                "seed": r["seed"],
                "fold": r["fold"],
                "best_epoch": r["best_epoch"],
                "best_val_f1": r["best_val_f1"],
                "test_accuracy": r["test_metrics"]["accuracy"],
                "test_macro_f1": r["test_metrics"]["macro_f1"],
                "recording_accuracy": r["recording_metrics"]["accuracy"],
                "recording_macro_f1": r["recording_metrics"]["macro_f1"],
                "n_test_reps": r["test_metrics"]["n_samples"],
                "n_test_recordings": r["recording_metrics"]["n_samples"],
            }
            for r in runs
        ],
        "args": vars(args),
        "elapsed_sec": round(time.time() - started, 1),
    }
    write_json(os.path.join(args.out_dir, "metrics.json"), summary)
    write_json(os.path.join(args.out_dir, "history.json"),
               {f"s{r['seed']}_f{r['fold']}": r["history"] for r in runs})

    # Deployable checkpoint: the run with the median validation score, so the
    # saved weights are typical of the model rather than the luckiest fold.
    order = sorted(range(len(runs)), key=lambda i: runs[i]["best_val_f1"])
    primary = runs[order[len(order) // 2]]
    checkpoint_path = os.path.join(args.out_dir, "checkpoint.pt")
    save_checkpoint(
        checkpoint_path,
        primary["model"],
        primary["scaler"],
        data,
        DEFAULT_DROP_COLUMNS,
        metadata={
            "seed": primary["seed"],
            "fold": primary["fold"],
            "features": args.features,
            "per_recording_norm": bool(args.per_recording_norm),
            "best_epoch": primary["best_epoch"],
            "best_val_macro_f1": primary["best_val_f1"],
            "test_accuracy_per_repetition": primary["test_metrics"]["accuracy"],
            "test_macro_f1_per_repetition": primary["test_metrics"]["macro_f1"],
            "parameters": count_parameters(primary["model"]),
            "dataset_root": os.path.abspath(args.data_root),
            "split": {name: sorted(set(part.groups())) for name, part in primary["split"].items()},
        },
    )
    write_json(os.path.join(args.out_dir, "test_predictions.json"),
               {
                   "labels": data.labels,
                   "y_true": primary["test"]["y_true"].tolist(),
                   "y_pred": primary["test"]["y_pred"].tolist(),
                   "sources": primary["test"]["sources"],
               })
    print(f"checkpoint -> {checkpoint_path}")

    if args.train_final:
        budget = args.final_epochs or int(np.median([r["best_epoch"] for r in runs]))
        print(f"\nrefitting on all {len(set(data.groups()))} recordings for {budget} epochs")
        final_model, final_scaler = train_on_everything(data, args, args.seed, device, budget)
        final_path = os.path.join(args.out_dir, "checkpoint_final.pt")
        save_checkpoint(
            final_path, final_model, final_scaler, data, DEFAULT_DROP_COLUMNS,
            metadata={
                "trained_on": "all recordings",
                "epochs": budget,
                "features": args.features,
                "per_recording_norm": bool(args.per_recording_norm),
                "parameters": count_parameters(final_model),
                "cv": {k: summary[k] for k in ("protocol", "per_repetition", "per_recording")},
            },
        )
        print(f"final checkpoint -> {final_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
