"""Shared helpers: reproducibility, checkpoint I/O, device selection."""

from __future__ import annotations

import json
import os
import random
from typing import Any, Dict, Tuple

import numpy as np
import torch

from .data import FeatureScaler, MotionData
from .model import AttentionLSTM, ModelConfig

CHECKPOINT_VERSION = 1


def set_seed(seed: int) -> None:
    """Seed every RNG that can influence a run."""
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True


def resolve_device(name: str = "auto") -> torch.device:
    if name != "auto":
        return torch.device(name)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def count_parameters(model: torch.nn.Module) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


def save_checkpoint(
    path: str,
    model: AttentionLSTM,
    scaler: FeatureScaler,
    data: MotionData,
    drop_columns: Tuple[int, ...],
    metadata: Dict[str, Any],
) -> None:
    """Bundle weights *and* everything required to reproduce the input pipeline.

    The original code saved a bare ``state_dict`` and rebuilt the network by
    hand at inference time, with a different classifier head.  Loading it with
    ``strict=False`` then silently kept a randomly initialised head.  Saving the
    configuration next to the weights removes that whole class of bug.
    """
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    payload = {
        "checkpoint_version": CHECKPOINT_VERSION,
        "model_config": model.config.to_dict(),
        "labels": list(data.labels),
        "scaler": scaler.to_dict(),
        "drop_columns": list(drop_columns),
        "metadata": metadata,
        "state_dict": {k: v.detach().cpu() for k, v in model.state_dict().items()},
    }
    torch.save(payload, path)


def load_checkpoint(path: str, device: torch.device | str = "cpu") -> Tuple[AttentionLSTM, Dict[str, Any]]:
    """Rebuild a trained model from a checkpoint written by :func:`save_checkpoint`."""
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Checkpoint not found: {path}")
    payload = torch.load(path, map_location=device, weights_only=False)

    if "model_config" not in payload:
        raise ValueError(
            "This checkpoint only contains a state_dict and cannot be rebuilt safely. "
            "Re-train with the current code (python -m rehab_cls.train)."
        )

    config = ModelConfig.from_dict(payload["model_config"])
    model = AttentionLSTM(config)
    # strict=True on purpose: any shape or naming mismatch must fail loudly.
    model.load_state_dict(payload["state_dict"], strict=True)
    model.to(device)
    model.eval()
    return model, payload


def read_json(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: str, payload: Any) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
