# Results

Small, text-only artefacts so that every number in `docs/REPORT.md` can be
checked without re-training.

| file | what it is |
|---|---|
| `cv_release_metrics.json` | Data1, 5-fold group CV x 3 seeds, the original headline numbers |
| `holdout_metrics.json` | Data1, the single seeded split used for the figures |
| `holdout_test_metrics.json` | Data1, per-class precision / recall / F1 on that split |
| `baseline_metrics.json` | Data1, logistic regression and SVM on summary statistics |
| `data2_transfer_metrics.json` | Data1-trained checkpoint scored on all of Data2 |
| `data2_cv_metrics.json` | Data2 only, 5-fold group CV x 3 seeds (LSTM) |
| `data2_baseline_metrics.json` | Data2 only, logistic regression and SVM |
| `data2_with_data1_metrics.json` | LSTM trained on Data1 + Data2 folds, tested on Data2 |
| `data2_baseline_with_data1_metrics.json` | logreg / SVM trained on Data1 + Data2 folds, tested on Data2 |
| `data2_attention_metrics.json` | the held-out Data2 fold behind `docs/figures/data2/` |
| `demo_predictions_per_recording.csv` | predictions for the 20 unlabelled demo recordings |
| `demo_predictions_per_repetition.csv` | the same, one row per repetition |

The Data2-only LSTM run uses the same architecture but a larger validation
fraction (`--val-frac 0.25`), because 15 % of 28 recordings leaves only three
validation recordings and cannot cover five classes.

Checkpoints (`*.pt`) are not committed; `make train` regenerates them in a few
minutes on a laptop CPU.
