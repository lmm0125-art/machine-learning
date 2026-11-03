# Code review: what was wrong with the first submission

The original pipeline was two Colab cells (`train_with_labels_visual.py` and
`inference_attention.py`), preserved unchanged in
[`legacy/ml_code.ipynb`](../legacy/ml_code.ipynb). It ran end-to-end on Colab, but a
large part of what it reported was not what it measured. This document lists
every defect that was found, the evidence for it, and how the current code
handles it.

Severity: **S1** = results are invalid, **S2** = silently degrades the model,
**S3** = reproducibility / hygiene.

| # | Severity | Defect | Fix |
|---|---|---|---|
| 1 | S1 | Inference rebuilds a *different* network than training | one shared `AttentionLSTM`, `strict=True` |
| 2 | S1 | Trains to `.../MyDrive/1/...`, loads from `.../MyDrive/3/...` | checkpoint carries everything; no hard-coded paths |
| 3 | S1 | `load_state_dict(..., strict=False)` hides every mismatch | strict load + explicit input-dim check |
| 4 | S1 | No feature scaling on channels spanning 60 … 19 000 | `FeatureScaler` fitted on the train split |
| 5 | S1 | Model selected on the validation set *and* that score reported | hold-out test + repeated group CV |
| 6 | S1 | Attention softmax over zero padding | mask before softmax + packed LSTM |
| 7 | S2 | `random_split` unseeded and unstratified | stratified split over recordings |
| 8 | S2 | Whole file treated as one sample, `s` markers ignored | split into repetitions |
| 9 | S2 | Frame counter and timestamp used as features | dropped (columns 0, 1) |
| 10 | S2 | Six constant-zero columns kept | dropped |
| 11 | S2 | After "best model" is saved, the *last* epoch is visualised | best weights are restored |
| 12 | S2 | Label order derived from the folder listing, hard-coded at inference | `labels` stored in the checkpoint |
| 13 | S2 | Attention figures overwrite each other (`basename` collision) | file name includes class and repetition |
| 14 | S3 | Absolute Colab paths, `drive.flush_and_unmount()` on import | CLI arguments, relative paths |
| 15 | S3 | Unused variables, duplicated line, no seed, no tests, no packaging | cleaned up, `pytest`, `pyproject.toml` |

---

## S1 — the reported numbers cannot come from that model

### 1. The inference network is not the trained network

Training defined

```python
self.fc = nn.Sequential(nn.Linear(hidden, hidden), nn.ReLU(), nn.Linear(hidden, num_classes))
```

so the parameters are named `fc.0.weight`, `fc.0.bias`, `fc.2.weight`, `fc.2.bias`.
Inference re-declared the model by hand:

```python
self.fc = nn.Linear(hidden, num_classes)   # fc.weight, fc.bias
```

None of the trained classifier parameters has a matching name, so
`model.load_state_dict(state_dict, strict=False)` silently kept **randomly
initialised** weights for the entire classification head. The LSTM encoder was
loaded, the head was not — the predicted class was effectively noise.

*Fix*: a single `AttentionLSTM` class is used by train, evaluate and predict.
Loading is `strict=True`, so a naming or shape drift raises instead of
producing plausible-looking garbage. Mis-matches are additionally checked
against `model_config.input_dim`.

### 2. The checkpoint path does not exist at inference time

```python
SAVE_DIR   = "/content/drive/MyDrive/1/attention_visualization"   # training
MODEL_PATH = "/content/drive/MyDrive/3/attention_visualization/best_model.pth"  # inference
```

`1` versus `3`. Either the load fails, or — worse — it picks up a checkpoint
from an earlier experiment, which is why the second bug could go unnoticed.

*Fix*: `--checkpoint` is an argument and the payload stores its own metadata.

### 3. `strict=False` also swallowed the input-dimension mismatch

`FEATURE_DIM` at inference was recomputed from the *first demo file*:

```python
tmp = load_motion_file(os.path.join(TEST_DIR, sample_files[0]))
FEATURE_DIM = tmp.shape[1]     # width of the widest row of that one file
```

Training computed the dimension over the whole training set. Whenever those
disagree, `lstm.weight_ih_l0` has the wrong shape, is skipped by
`strict=False`, and the encoder is random too.

### 4. No normalisation

Per-column ranges measured over both datasets (`scripts/check_data.py`):

| column | range | column | range |
|---|---|---|---|
| 0 (frame id) | 10 295 – 160 635 | 14 | −56 – 584 |
| 1 (timestamp) | 214 104 – 3 316 011 | 15 | −641 – 599 |
| 2 – 5 angle | −32 – 150 | 19 | −5 620 – 2 462 |
| 6 – 9 rate | −619 – 651 | 21 | −18 850 – −8 732 |

Feeding these straight into an LSTM puts pre-activations in the 10⁴–10⁶ range,
so the input gate saturates and gradients either vanish or explode; the
informative 60-degree joint-angle channels contribute nothing next to the
timestamp column. Standardisation is not cosmetic here.

*Fix*: `FeatureScaler` computes mean/std **on the training split only** and
clips to ±5σ.

### 5. Model selection and reporting use the same data

```python
if val_acc > best:  ...  print(f"Best Val Acc = {best:.4f}")
```

`best` is the maximum over epochs on the same split used to pick the model, so
it is an optimistic estimate with no held-out evidence. There is no test set in
the original code at all.

*Fix*: three-way split (train / val / test) **over recordings**, plus repeated
stratified 5-fold group CV for the report; `val` is only used for early stopping
or epoch selection.

### 6. Attention attends to padding

`pad_sequence` pads every batch to the longest repetition in it, then

```python
weights = torch.softmax(scores, dim=1)
```

gives non-zero probability to the zero rows. In a batch mixing a 195-frame and a
535-frame recording, more than half of the attention budget of the short sample
is spent on padding. The resulting heat-map is not an explanation of the motion.

*Fix*: `scores.masked_fill(~mask, -inf)` before the softmax, and the LSTM itself
consumes a `pack_padded_sequence`.

---

## S2 — the model is weaker than it needs to be

### 7. Unseeded, unstratified `random_split`

```python
train_set, val_set = random_split(ds, [n_train, n_val])
```

With 34 recordings split 80/20, the validation set holds 6 recordings. The class
counts are 8/7/7/6/6, so a uniformly random 6-file draw **misses at least one
class 84.8 % of the time** (exact combinatorial computation). Roughly one run in
seven also gets a different split, so the printed number is not reproducible.

*Fix*: stratified split over recordings, seeded; CV folds use
`StratifiedGroupKFold`.

### 8. One file was treated as one sample

Each recording contains 3–5 repetitions delimited by `s,0,,#` lines — 148
repetitions in total, not 34 samples. The original code

* inserted an all-zero frame at every `s` marker (the marker line parses to a
  single `0.0` which is then zero-padded to 28 dims),
* concatenated all repetitions of a recording into one long sequence,
* and therefore trained on 34 samples instead of 118 usable ones.

Consequences: 3.5× less training data than available, and an attention map that
averages over repetitions instead of pointing at one movement cycle.

*Fix*: `parse_recording` splits on `s`, repetitions shorter than 40 frames
(truncated head/tail) are dropped, and the model sees one cycle at a time.
`--no-split-reps` reproduces the old behaviour for the ablation table.

### 9–10. Eight of twenty-eight columns are not motion

Columns 0 and 1 are the frame counter and the timestamp — monotone per
recording, useless as motion evidence and, as shown above, dominant in
magnitude. Columns 10–13, 17 and 18 are exactly `0.0` in every frame of both
datasets. The network wasted parameters on eight dead or misleading inputs.

*Fix*: `DEFAULT_DROP_COLUMNS`, leaving 20 channels (optionally + 20 first
differences).

### 11. The visualised model is not the saved model

`train_and_eval` saves `best_model.pth` on improvement but returns `model`,
which at the end of the loop holds the **last** epoch's weights. Attention plots
therefore come from the most over-fitted epoch, not the selected one.

### 12. Label indices depended on `os.listdir`

```python
present = sorted({l for _, l in self.samples})
self.label_to_idx = {l: i for i, l in enumerate([l for l in ALLOWED_LABELS if l in present])}
```

Fine on the full dataset, but if a class is missing the indices shift, while
inference hard-codes `{"circle": 0, "diagonal_left": 1, ...}`. A silently wrong
label mapping is the worst possible failure mode for a medical classifier.

*Fix*: `labels` is part of the checkpoint and is used everywhere.

### 13. Attention images overwrite each other

```python
name = os.path.basename(path).replace(".txt", "_attn.png")
```

Every class folder contains `1.txt`, `2.txt`, …, so `circle/1.txt` and
`vertical/1.txt` both write `1_attn.png`. Only the last one survives.

---

## What changed in the numbers

Same data, same protocol everywhere: stratified 5-fold **group** CV over
recordings, mean ± std across folds. "Per repetition" scores one movement cycle;
"per recording" averages the probabilities of the 3–5 cycles of a recording and
scores the recording — the latter is the question the brief actually asks.

Ablation with 64 hidden units, dropout 0.3, 60 epochs, one seed:

| features | per-repetition acc | per-recording acc |
|---|---|---|
| raw, global scaling | 0.767 ± 0.069 | 0.852 ± 0.091 |
| + first differences | 0.812 ± 0.103 | 0.848 ± 0.106 |
| + per-recording normalisation | 0.795 ± 0.058 | 0.881 ± 0.109 |
| + both | 0.750 ± 0.069 | 0.914 ± 0.114 |

Final configuration (both, 96 hidden, dropout 0.4, 80 epochs), 5 folds × 3 seeds:

| protocol | per-repetition | per-recording |
|---|---|---|
| 15 CV runs | 0.790 ± 0.081 acc / 0.767 ± 0.103 macro-F1 | **0.931 ± 0.091 acc / 0.902 ± 0.133 macro-F1** |
| single hold-out (seed 42, 20 test repetitions) | 0.900 / 0.902 | 1.000 / 1.000 |

The original pipeline cannot be scored at all: its inference head was random,
so its predictions were noise regardless of the encoder.

### Against a classical baseline

Summary statistics per channel (mean, std, min, max, slope, path length) fed to
scikit-learn models, same folds:

| model | per-repetition acc | per-repetition macro-F1 | per-recording acc |
|---|---|---|---|
| logistic regression | 0.853 ± 0.109 | 0.821 ± 0.142 | 0.892 ± 0.116 |
| SVM (RBF) | 0.880 ± 0.107 | 0.853 ± 0.142 | 0.892 ± 0.116 |
| LSTM + attention | 0.790 ± 0.081 | 0.767 ± 0.103 | **0.931 ± 0.091** |

This is worth stating plainly instead of hiding: **with 34 recordings, a linear
model on summary statistics classifies single repetitions better than the
recurrent network.** The LSTM only wins after the repetitions of a recording are
pooled, and its unique contribution is the per-timestep attention map, which the
baseline cannot produce at all. `docs/REPORT.md` discusses this honestly rather
than claiming a win the data does not support.

## Reproducing the original failure

`--no-split-reps --leaky-split` reproduces the old regime (whole files as
samples, random repetition-level split). It scores higher than the honest
protocol, which is exactly why the leak is worth pointing out.

