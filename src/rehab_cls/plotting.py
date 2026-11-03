"""Figures for the report, the README and the demo day talk."""

from __future__ import annotations

import os
from typing import Dict, List, Sequence

import matplotlib

matplotlib.use("Agg")           # headless: works on a server and inside CI
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

# Keep text as text in SVG output: the file stays small and the labels remain
# selectable/searchable instead of being flattened into glyph outlines.
plt.rcParams["svg.fonttype"] = "none"

PALETTE = ["#2f6f9f", "#e07a5f", "#81b29a", "#9d6bab", "#d6a24a", "#5d6d7e"]


def _save(fig, path: str) -> None:
    """Write the figure as PNG (quick look) and SVG (crisp in the report)."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    fig.savefig(path, dpi=160, bbox_inches="tight", facecolor="white")
    if path.lower().endswith(".png"):
        fig.savefig(path[:-4] + ".svg", bbox_inches="tight", facecolor="white")
    plt.close(fig)


def plot_training_curves(history: Dict[str, List[float]], path: str, title: str = "Training") -> None:
    epochs = np.arange(1, len(history["train_loss"]) + 1)
    fig, axes = plt.subplots(1, 2, figsize=(11, 3.6))

    axes[0].plot(epochs, history["train_loss"], color=PALETTE[0], label="train")
    axes[0].plot(epochs, history["val_loss"], color=PALETTE[1], label="validation")
    axes[0].set_xlabel("epoch")
    axes[0].set_ylabel("cross-entropy loss")
    axes[0].set_title("Loss")
    axes[0].legend(frameon=False)
    axes[0].grid(alpha=0.25)

    axes[1].plot(epochs, history["train_acc"], color=PALETTE[0], label="train")
    axes[1].plot(epochs, history["val_acc"], color=PALETTE[1], label="validation")
    axes[1].plot(epochs, history["val_f1"], color=PALETTE[2], linestyle="--", label="validation macro-F1")
    axes[1].set_xlabel("epoch")
    axes[1].set_ylabel("score")
    axes[1].set_ylim(0, 1.02)
    axes[1].set_title("Accuracy / macro-F1")
    axes[1].legend(frameon=False, loc="lower right")
    axes[1].grid(alpha=0.25)

    fig.suptitle(title)
    _save(fig, path)


def plot_confusion(
    matrix: np.ndarray,
    labels: Sequence[str],
    path: str,
    title: str = "Confusion matrix (test)",
    normalize: bool = True,
) -> None:
    data = matrix.astype(float)
    if normalize:
        row = data.sum(axis=1, keepdims=True)
        data = np.divide(data, row, out=np.zeros_like(data), where=row > 0)

    fig, ax = plt.subplots(figsize=(4.8, 4.2))
    im = ax.imshow(data, cmap="Blues", vmin=0, vmax=1)
    ax.set_xticks(range(len(labels)), labels, rotation=45, ha="right")
    ax.set_yticks(range(len(labels)), labels)
    ax.set_xlabel("predicted")
    ax.set_ylabel("true")
    ax.set_title(title)

    for i in range(data.shape[0]):
        for j in range(data.shape[1]):
            if matrix[i, j] == 0:
                continue
            colour = "white" if data[i, j] > 0.55 else "#20303f"
            text = f"{data[i, j]:.2f}\n({matrix[i, j]})" if normalize else str(matrix[i, j])
            ax.text(j, i, text, ha="center", va="center", fontsize=8, color=colour)

    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04, label="fraction of class")
    _save(fig, path)


def plot_attention(
    weights: np.ndarray,
    path: str,
    title: str = "Attention over time",
    length: int | None = None,
    cmap: str = "YlOrRd",
) -> None:
    values = weights if length is None else weights[:length]
    fig, ax = plt.subplots(figsize=(7.2, 1.9))
    im = ax.imshow(values[None, :], aspect="auto", cmap=cmap)
    ax.set_yticks([])
    ax.set_xlabel("time step (frame)")
    ax.set_title(title, fontsize=9)
    fig.colorbar(im, ax=ax, fraction=0.03, pad=0.01)
    _save(fig, path)


def plot_attention_grid(
    samples: Sequence[Dict[str, object]],
    path: str,
    title: str = "Attention weights of held-out repetitions",
) -> None:
    """One compact heat-map per sample, stacked vertically."""
    n = len(samples)
    fig, axes = plt.subplots(n, 1, figsize=(7.4, 0.95 * n + 0.6), squeeze=False, sharex=False)
    for ax, sample in zip(axes[:, 0], samples):
        weights = np.asarray(sample["weights"])
        length = int(sample.get("length", len(weights)))
        ax.imshow(weights[None, :length], aspect="auto", cmap="YlOrRd")
        ax.set_yticks([])
        ax.set_ylabel(str(sample.get("label", "")), fontsize=7, rotation=0, ha="right", va="center")
        ax.tick_params(axis="x", labelsize=7, labelbottom=False)
    axes[-1, 0].tick_params(axis="x", labelbottom=True)
    axes[-1, 0].set_xlabel("time step (frame)")
    fig.suptitle(title, fontsize=10)
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    _save(fig, path)


def plot_class_attention_profile(
    profiles: Dict[str, np.ndarray],
    path: str,
    title: str = "Where each class is attended to (relative time)",
) -> None:
    """Average attention as a function of *relative* position in the repetition.

    Because repetitions differ in length, weights are binned by their position
    in the repetition (0 = start, 1 = end) before averaging.  The curve is
    divided by its own mean, so ``1.0`` means "as much attention as a uniform
    distribution" and a peak marks the phase the model actually relies on.
    """
    fig, ax = plt.subplots(figsize=(6.6, 3.6))
    peak_info = []
    for idx, (label, profile) in enumerate(profiles.items()):
        baseline = profile.mean() if profile.mean() > 0 else 1.0
        relative = profile / baseline
        ax.plot(relative, label=label, color=PALETTE[idx % len(PALETTE)], linewidth=1.7)
        peak = int(np.argmax(relative))
        peak_info.append(f"{label}@{peak / max(len(relative) - 1, 1):.0%}")

    ax.axhline(1.0, color="#8899a6", linestyle=":", linewidth=1.1)
    ax.set_xlabel("relative position within the repetition  (0 = start, 1 = end)")
    ax.set_ylabel("attention / uniform")
    ax.set_title(title, fontsize=10)
    ax.set_xticks([0, len(next(iter(profiles.values()))) - 1], ["start", "end"])
    ax.grid(alpha=0.25)
    ax.legend(frameon=False, fontsize=8, loc="upper left")
    fig.text(0.99, -0.20, "peak: " + ", ".join(peak_info), ha="right", fontsize=7, color="#5d6d7e")
    _save(fig, path)


def plot_length_distribution(records: Dict[str, List[int]], path: str) -> None:
    fig, ax = plt.subplots(figsize=(6.2, 3.2))
    labels = list(records)
    data = [records[k] for k in labels]
    ax.boxplot(data, widths=0.55, patch_artist=True,
               boxprops=dict(facecolor="#dce8f2", edgecolor=PALETTE[0]),
               medianprops=dict(color=PALETTE[1]))
    ax.set_xticks(range(1, len(labels) + 1), labels)
    ax.set_ylabel("frames per repetition")
    ax.set_title("Repetition length per class", fontsize=10)
    ax.tick_params(axis="x", rotation=20)
    ax.grid(alpha=0.2, axis="y")
    _save(fig, path)
