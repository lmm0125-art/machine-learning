#!/usr/bin/env bash
# Reproduce every number in docs/REPORT.md.
#
#   bash scripts/run_all.sh data/raw
#
# Writes into runs/ :
#   ablation/*      one row per feature variant
#   release/*       5 folds x 3 seeds + a checkpoint refit on every recording
#   holdout/*       single split used for the figures
#   baseline/*      classical comparison
#   predict/*       demo folder predictions
set -euo pipefail

DATA=${1:-data/raw}
DEMO=${2:-data/demo}
PY=${PYTHON:-python}

echo "== sanity check =="
$PY scripts/check_data.py --root "$DATA"

echo "== ablation (64 hidden, 1 seed) =="
for variant in "raw|" "raw_delta|" "raw|--per-recording-norm" "raw_delta|--per-recording-norm"; do
  feat=${variant%%|*}
  extra=${variant#*|}
  name="ablation/${feat}${extra:+_prn}"
  $PY -m rehab_cls.train --data-root "$DATA" --out-dir "runs/$name" \
      --cv 5 --seeds 1 --epochs 60 --patience 0 --quiet --features "$feat" $extra
done

echo "== release (5 folds x 3 seeds) =="
$PY -m rehab_cls.train --data-root "$DATA" --out-dir runs/release \
    --cv 5 --seeds 3 --features raw_delta --per-recording-norm \
    --hidden 96 --dropout 0.4 --epochs 80 --patience 0 --train-final --quiet

echo "== hold-out split for the figures =="
$PY -m rehab_cls.train --data-root "$DATA" --out-dir runs/holdout \
    --cv 0 --seeds 1 --features raw_delta --per-recording-norm \
    --hidden 96 --dropout 0.4 --epochs 80 --patience 0 --quiet \
    --figures-dir docs/figures
$PY -m rehab_cls.evaluate --checkpoint runs/holdout/checkpoint.pt \
    --data-root "$DATA" --split test --figures-dir docs/figures

echo "== classical baseline =="
$PY -m rehab_cls.baseline --data-root "$DATA" --cv 5 --seeds 3 \
    --out-json runs/baseline_metrics.json

if [ -d "$DEMO" ]; then
  echo "== demo predictions =="
  $PY -m rehab_cls.predict --checkpoint runs/release/checkpoint_final.pt \
      --input "$DEMO" --out-dir runs/predict
fi

echo "done."
