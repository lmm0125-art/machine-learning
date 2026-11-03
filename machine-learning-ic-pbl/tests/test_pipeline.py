"""Unit tests for parsing, splitting and normalisation."""

from __future__ import annotations

import os

import numpy as np
import pytest

from rehab_cls.data import (
    DEFAULT_DROP_COLUMNS,
    FeatureScaler,
    collate,
    load_segments,
    parse_recording,
    split_by_source,
)
from rehab_cls.model import AttentionLSTM, ModelConfig


def write_recording(path: str, reps, per_rep: int = 60, seed: int = 0) -> None:
    """Write a synthetic recording in the format of the real dataset."""
    rng = np.random.default_rng(seed)
    lines = []
    for _ in range(reps):
        lines.append("s,0,,#")
        for _ in range(per_rep):
            body = ",".join(
                "/".join(str(int(v)) for v in rng.integers(-50, 50, size=n))
                for n in (4, 4, 4, 3, 2, 3, 3, 3)
            )
            lines.append(f"r,{rng.integers(1e4, 2e4)},{rng.integers(1e6, 2e6)},{body},,#")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


@pytest.fixture()
def dataset_root(tmp_path):
    root = tmp_path / "raw"
    for idx, label in enumerate(["circle", "horizontal", "vertical"]):
        folder = root / label
        folder.mkdir(parents=True)
        for file_idx in range(3):
            write_recording(str(folder / f"{file_idx + 1}.txt"), reps=3, seed=idx * 10 + file_idx)
    return str(root)


def test_parse_recording_splits_repetitions(tmp_path):
    path = tmp_path / "one.txt"
    write_recording(str(path), reps=3, per_rep=50)
    segments = parse_recording(str(path))
    assert len(segments) == 3
    assert all(seg.shape == (50, 28) for seg in segments)


def test_parse_recording_whole_file(tmp_path):
    path = tmp_path / "one.txt"
    write_recording(str(path), reps=3, per_rep=50)
    segments = parse_recording(str(path), split_repetitions=False)
    assert len(segments) == 1
    assert segments[0].shape == (150, 28)


def test_load_segments_drops_constant_and_metadata_columns(dataset_root):
    data = load_segments(dataset_root, labels=["circle", "horizontal", "vertical"], min_length=10)
    assert data.segments[0].frames.shape[1] == 20
    assert data.segments[0].frames.shape[1] == 28 - len(DEFAULT_DROP_COLUMNS)
    assert len(set(data.groups())) == 9


def test_short_repetitions_are_dropped(dataset_root):
    with pytest.raises(RuntimeError):
        load_segments(dataset_root, labels=["circle", "horizontal", "vertical"], min_length=100)


def test_split_never_shares_a_recording(dataset_root):
    data = load_segments(dataset_root, labels=["circle", "horizontal", "vertical"], min_length=10)
    split = split_by_source(data, seed=0)
    groups = {name: set(part.groups()) for name, part in split.items()}
    assert groups["train"].isdisjoint(groups["test"])
    assert groups["train"].isdisjoint(groups["val"])
    assert groups["val"].isdisjoint(groups["test"])
    assert sum(len(part) for part in split.values()) == len(data)


def test_scaler_centres_the_training_split(dataset_root):
    data = load_segments(dataset_root, labels=["circle", "horizontal", "vertical"], min_length=10)
    scaler = FeatureScaler.fit(data.segments, clip=0)
    stacked = np.concatenate([s.frames for s in data.segments], axis=0)
    transformed = scaler.transform(stacked)
    assert np.allclose(transformed.mean(axis=0), 0.0, atol=1e-4)
    assert np.allclose(transformed.std(axis=0), 1.0, atol=1e-2)


def test_collate_builds_a_valid_mask(dataset_root):
    data = load_segments(dataset_root, labels=["circle", "horizontal", "vertical"], min_length=10)
    scaler = FeatureScaler.fit(data.segments)
    from rehab_cls.data import MotionDataset

    dataset = MotionDataset(data.segments[:3], scaler)
    batch = collate([dataset[i] for i in range(3)])
    assert batch["x"].shape[:2] == batch["mask"].shape
    assert batch["mask"].sum(dim=1).tolist() == batch["lengths"].tolist()
    # padded positions must be all-zero in the input tensor
    for i, length in enumerate(batch["lengths"].tolist()):
        assert np.allclose(batch["x"][i, length:].numpy(), 0.0)


def test_attention_ignores_padding():
    model = AttentionLSTM(ModelConfig(input_dim=20, hidden_dim=8, num_classes=3))
    model.eval()
    import torch

    x = torch.randn(2, 10, 20)
    mask = torch.zeros(2, 10, dtype=torch.bool)
    mask[0, :7] = True
    mask[1, :3] = True
    logits, weights = model(x, mask)
    assert logits.shape == (2, 3)
    assert torch.allclose(weights.sum(dim=1), torch.ones(2), atol=1e-5)
    assert torch.allclose(weights[0, 7:], torch.zeros(3), atol=1e-6)
    assert torch.allclose(weights[1, 3:], torch.zeros(7), atol=1e-6)
