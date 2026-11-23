#!/usr/bin/env bash
# Reproduce the Data2 numbers in docs/REPORT.md §5.1.
#
#   bash scripts/run_data2.sh data/raw2 data/raw
#
# Writes into runs/ :
#   data2_cv/                 Data2 only, 5 folds x 3 seeds
#   data2_baseline/           logreg / SVM on Data2 only
#   data2_with_data1/         Data1 appended to the training folds, test on Data2
#   data2_baseline_with_data1 same protocol for the classical baselines
set -euo pipefail

DATA2=${1:-data/raw2}
DATA1=${2:-data/raw}
PY=${PYTHON:-python}

echo "== sanity checks =="
$PY scripts/check_data.py --root "$DATA2"
$PY scripts/check_data.py --root "$DATA1"

echo "== Data2 only: LSTM, 5 folds x 3 seeds =="
$PY -m rehab_cls.train --data-root "$DATA2" --out-dir runs/data2_cv \
    --cv 5 --seeds 3 --val-frac 0.25 \
    --features raw_delta --per-recording-norm \
    --hidden 96 --dropout 0.4 --epochs 80 --patience 15 --quiet

echo "== Data2 only: classical baselines =="
$PY -m rehab_cls.baseline --data-root "$DATA2" --cv 5 --seeds 3 \
    --out-json results/data2_baseline_metrics.json

echo "== Data1 + Data2 training folds, test on Data2: LSTM =="
$PY -m rehab_cls.train --data-root "$DATA2" --extra-data-root "$DATA1" \
    --out-dir runs/data2_with_data1 --cv 5 --seeds 3 --val-frac 0.25 \
    --features raw_delta --per-recording-norm \
    --hidden 96 --dropout 0.4 --epochs 80 --patience 15 --quiet

echo "== Data1 + Data2 training folds, test on Data2: baselines =="
$PY -m rehab_cls.baseline --data-root "$DATA2" --extra-data-root "$DATA1" \
    --cv 5 --seeds 3 --out-json results/data2_baseline_with_data1_metrics.json

echo "done."
