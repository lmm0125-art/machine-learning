# Results

Small, text-only artefacts so that every number in `docs/REPORT.md` can be
checked without re-training.

| file | what it is |
|---|---|
| `cv_release_metrics.json` | 5-fold group CV x 3 seeds, the headline numbers |
| `holdout_metrics.json` | the single seeded split used for the figures |
| `holdout_test_metrics.json` | per-class precision / recall / F1 on that split |
| `baseline_metrics.json` | logistic regression and SVM on summary statistics |
| `demo_predictions_per_recording.csv` | predictions for the 20 unlabelled demo recordings |
| `demo_predictions_per_repetition.csv` | the same, one row per repetition |

Checkpoints (`*.pt`) are not committed; `make train` regenerates them in a few
minutes on a laptop CPU.
