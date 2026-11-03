"""Classification metrics used by training, evaluation and the report."""

from __future__ import annotations

from typing import Dict, List, Sequence

import numpy as np


def confusion_matrix(y_true: np.ndarray, y_pred: np.ndarray, num_classes: int) -> np.ndarray:
    matrix = np.zeros((num_classes, num_classes), dtype=np.int64)
    for t, p in zip(np.asarray(y_true).ravel(), np.asarray(y_pred).ravel()):
        matrix[int(t), int(p)] += 1
    return matrix


def classification_metrics(
    y_true: Sequence[int],
    y_pred: Sequence[int],
    labels: Sequence[str],
) -> Dict[str, object]:
    """Accuracy, macro-F1 and per-class precision / recall / F1.

    Macro-F1 is the headline number: the five classes are not equally frequent,
    so plain accuracy hides a model that simply prefers ``horizontal`` and
    ``vertical`` (the two longest recordings).
    """
    from sklearn.metrics import f1_score, precision_recall_fscore_support

    y_true = np.asarray(y_true)
    y_pred = np.asarray(y_pred)
    num_classes = len(labels)

    precision, recall, f1, support = precision_recall_fscore_support(
        y_true, y_pred, labels=list(range(num_classes)), zero_division=0
    )
    return {
        "accuracy": float((y_true == y_pred).mean()) if len(y_true) else 0.0,
        "macro_f1": float(f1_score(y_true, y_pred, labels=list(range(num_classes)),
                                   average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y_true, y_pred, labels=list(range(num_classes)),
                                      average="weighted", zero_division=0)),
        "per_class": {
            name: {
                "precision": float(precision[i]),
                "recall": float(recall[i]),
                "f1": float(f1[i]),
                "support": int(support[i]),
            }
            for i, name in enumerate(labels)
        },
        "n_samples": int(len(y_true)),
    }


def format_metrics(metrics: Dict[str, object], labels: Sequence[str]) -> str:
    """Human-readable summary for the terminal / README."""
    lines: List[str] = []
    lines.append(
        f"accuracy {metrics['accuracy']:.4f} | macro-F1 {metrics['macro_f1']:.4f} "
        f"| n={metrics['n_samples']}"
    )
    per_class = metrics.get("per_class", {})
    for name in labels:
        if name not in per_class:
            continue
        row = per_class[name]
        lines.append(
            f"  {name:<15s} P {row['precision']:.3f}  R {row['recall']:.3f}  "
            f"F1 {row['f1']:.3f}  n={row['support']}"
        )
    return "\n".join(lines)
