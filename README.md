# Hanyang ERICA — coursework and projects

Two independent projects live in this repository. Each one has its own
dependencies, entry point, tests and documentation; nothing is shared between
them, so you can work on one without touching the other.

| project | course | stack | what it is |
|---|---|---|---|
| [`roomi/`](roomi/) | IC-PBL 2026-2, ㈜도로 × Hanyang ERICA | Node 22 · Express · Babylon.js | 루미 (RooMi) — a content module for DOROBUS where a child's coloured-in robot lives in a 3D room |
| [`machine-learning-ic-pbl/`](machine-learning-ic-pbl/) | Machine Learning (IC-PBL), 2025-Fall | Python · PyTorch | Explainable LSTM + attention classifier for rehabilitation exercise trajectories |

```
Hanyang-erica-/
├── roomi/                        # 프로토타입 웹 앱 (Korean)
│   ├── server.js                 # Express + SQLite, node --experimental-sqlite
│   ├── public/                   # Babylon.js 3D room, client code
│   ├── docs/                     # 기획·검수·리포트 문서
│   └── assets/
└── machine-learning-ic-pbl/      # ML final project (English)
    ├── src/rehab_cls/            # package: data, model, train, evaluate, predict
    ├── docs/                     # report, code review, figures
    ├── tests/                    # 8 unit tests
    ├── notebooks/                # Colab quickstart
    └── legacy/ml_code.ipynb      # the original submission, kept for reference
```

## roomi

```bash
cd roomi
npm install
npm start          # or double-click start.command on macOS
```

Online demo: <https://my-dorobot.app.workbuddy.host/> — no login needed, use
「데모 계정으로 바로 보기」. Full documentation is in
[`roomi/README.md`](roomi/README.md).

## machine-learning-ic-pbl

```bash
cd machine-learning-ic-pbl
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest -q
```

The recordings are course material and are not committed; see
[`machine-learning-ic-pbl/data/README.md`](machine-learning-ic-pbl/data/README.md)
for the expected layout. Headline result: per-recording accuracy
**0.931 ± 0.091**, macro-F1 **0.902 ± 0.133**, from stratified 5-fold group
cross-validation over recordings. Details in
[`machine-learning-ic-pbl/README.md`](machine-learning-ic-pbl/README.md).

## CI

| workflow | scope |
|---|---|
| [`.github/workflows/ml-ic-pbl.yml`](.github/workflows/ml-ic-pbl.yml) | unit tests + end-to-end smoke run, triggers only on `machine-learning-ic-pbl/**` |
| [`.github/workflows/roomi.yml`](.github/workflows/roomi.yml) | syntax check of the server and client bundles, triggers only on `roomi/**` |
