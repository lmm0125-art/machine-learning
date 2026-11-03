"""Model definition: LSTM encoder + additive attention pooling.

The architecture is deliberately small.  With roughly one hundred training
sequences a wider network simply memorises the training recordings, and a
network that is easy to read is also easier to defend in the report.

Attention is the interpretability mechanism required by the assignment: the
weights returned by :meth:`AttentionLSTM.forward` say *which time steps* of the
repetition drove the decision, which can be plotted next to the trajectory.

Two details matter for correctness:

* padded time steps are masked out *before* the softmax, otherwise the network
  spends part of its attention budget on zeros;
* the LSTM consumes a packed sequence, so padded steps never enter the
  recurrence at all.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Dict, Optional, Tuple

import torch
from torch import Tensor, nn
from torch.nn.utils.rnn import pack_padded_sequence, pad_packed_sequence


@dataclass
class ModelConfig:
    """Everything needed to rebuild the network from a checkpoint."""

    input_dim: int = 20
    hidden_dim: int = 64
    num_layers: int = 1
    num_classes: int = 5
    dropout: float = 0.3
    bidirectional: bool = False

    def to_dict(self) -> Dict[str, object]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: Dict[str, object]) -> "ModelConfig":
        known = {f for f in cls.__dataclass_fields__}  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in payload.items() if k in known})


class AttentionLSTM(nn.Module):
    """LSTM encoder with additive (Bahdanau-style) attention pooling."""

    def __init__(self, config: ModelConfig):
        super().__init__()
        self.config = config

        out_dim = config.hidden_dim * (2 if config.bidirectional else 1)
        self.lstm = nn.LSTM(
            input_size=config.input_dim,
            hidden_size=config.hidden_dim,
            num_layers=config.num_layers,
            batch_first=True,
            dropout=config.dropout if config.num_layers > 1 else 0.0,
            bidirectional=config.bidirectional,
        )
        self.attention = nn.Sequential(
            nn.Linear(out_dim, out_dim),
            nn.Tanh(),
            nn.Linear(out_dim, 1, bias=False),
        )
        self.dropout = nn.Dropout(config.dropout)
        self.classifier = nn.Linear(out_dim, config.num_classes)

    # ------------------------------------------------------------------ #
    def forward(self, x: Tensor, mask: Optional[Tensor] = None) -> Tuple[Tensor, Tensor]:
        """Return ``(logits, attention_weights)``.

        Parameters
        ----------
        x:
            ``(B, T, D)`` batch of (already normalised) sequences.
        mask:
            ``(B, T)`` boolean tensor, ``True`` for real time steps.  When
            omitted every step is treated as valid, which is correct for
            single-sequence inference.
        """
        if mask is None:
            mask = torch.ones(x.shape[:2], dtype=torch.bool, device=x.device)

        lengths = mask.sum(dim=1).clamp(min=1)
        packed = pack_padded_sequence(
            x, lengths.cpu(), batch_first=True, enforce_sorted=False
        )
        encoded, _ = self.lstm(packed)
        encoded, _ = pad_packed_sequence(encoded, batch_first=True, total_length=x.shape[1])

        scores = self.attention(encoded).squeeze(-1)             # (B, T)
        # Never attend to padding.  -inf before the softmax makes the padded
        # positions exactly zero probability instead of merely small.
        scores = scores.masked_fill(~mask, torch.finfo(scores.dtype).min)
        weights = torch.softmax(scores, dim=1)                   # (B, T)

        context = torch.sum(weights.unsqueeze(-1) * encoded, dim=1)
        logits = self.classifier(self.dropout(context))
        return logits, weights

    # ------------------------------------------------------------------ #
    @torch.no_grad()
    def predict_proba(self, x: Tensor, mask: Optional[Tensor] = None) -> Tensor:
        logits, _ = self.forward(x, mask)
        return torch.softmax(logits, dim=1)


def build_model(config: ModelConfig) -> AttentionLSTM:
    return AttentionLSTM(config)
