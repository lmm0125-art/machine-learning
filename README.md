# Hanyang ERICA — coursework

Coursework and project repositories from Hanyang University ERICA.

| folder | course | what it is |
|---|---|---|
| [`machine-learning-ic-pbl/`](machine-learning-ic-pbl/) | Machine Learning (IC-PBL), 2025-Fall | Explainable LSTM + attention classifier for rehabilitation exercise trajectories — final project, with report, code review and tests |
| `ml_code.ipynb` | Machine Learning (IC-PBL), 2025-Fall | The original submission notebook. Superseded by `machine-learning-ic-pbl/`; kept for reference, see the [code review](machine-learning-ic-pbl/docs/CODE_REVIEW.md) for what was wrong with it |

## machine-learning-ic-pbl at a glance

* 34 recordings → 118 movement repetitions, 5 classes
* stratified 5-fold **group** cross-validation over recordings (3 seeds)
* per-recording accuracy **0.931 ± 0.091**, macro-F1 **0.902 ± 0.133**
* mask-aware attention pooling, so the heat-map explains the decision instead of
  spreading over padding

```bash
git clone https://github.com/lmm0125-art/Hanyang-erica-.git
cd Hanyang-erica-/machine-learning-ic-pbl
pip install -e ".[dev]" && pytest -q
```

Details, figures and the honest comparison against a classical baseline are in
[`machine-learning-ic-pbl/README.md`](machine-learning-ic-pbl/README.md).
