.PHONY: help install test lint data train eval predict baseline all clean

DATA   ?= data/raw
DEMO   ?= data/demo
OUT    ?= runs/release
CKPT   ?= $(OUT)/checkpoint_final.pt

help:
	@echo "install   pip install -e '.[dev]'"
	@echo "test      run the unit tests"
	@echo "data      sanity-check the dataset layout"
	@echo "train     5-fold group CV (3 seeds) + refit on everything"
	@echo "eval      score a checkpoint and write docs/figures"
	@echo "predict   predict the unlabelled demo folder"
	@echo "baseline  classical comparison"
	@echo "all       train + eval + baseline + predict"

install:
	pip install -e ".[dev]"

test:
	pytest -q

lint:
	ruff check src tests

data:
	python scripts/check_data.py --root $(DATA)

train:
	python -m rehab_cls.train --data-root $(DATA) --out-dir $(OUT) \
		--cv 5 --seeds 3 --features raw_delta --per-recording-norm \
		--hidden 96 --dropout 0.4 --epochs 80 --patience 0 --train-final

eval:
	python -m rehab_cls.evaluate --checkpoint $(OUT)/checkpoint.pt \
		--data-root $(DATA) --split test --figures-dir docs/figures

predict:
	python -m rehab_cls.predict --checkpoint $(CKPT) --input $(DEMO) --out-dir runs/predict

baseline:
	python -m rehab_cls.baseline --data-root $(DATA) --cv 5 --seeds 3 \
		--out-json runs/baseline_metrics.json

all: data train eval baseline predict
