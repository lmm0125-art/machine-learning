# Contributions

Deliverable C of the IC-PBL brief asks for an open repository **and** an
explicit statement of who did what. This file is that statement.

| Member | Student ID | Ownership | Concrete artefacts |
|---|---|---|---|
| WANG YUMING | — | Project scheduling and coordination | Meeting agenda, mentor-report timeline, submission checklist |
| 우시시 | — | Data pipeline and visualisation | Recording parser, repetition segmentation, per-channel normalisation, trajectory and length plots (`src/rehab_cls/data.py`, `src/rehab_cls/plotting.py`) |
| 이멍멍 | 2023010946 | Model and training pipeline | LSTM + attention module, masked attention pooling, training loop, hyper-parameter search, checkpoint format (`src/rehab_cls/model.py`, `src/rehab_cls/train.py`, `src/rehab_cls/utils.py`) |
| 유열 | — | Report and mentor documentation | Final report, mentoring reports, demo-day slides |

Files not listed above were written jointly during pair sessions; the commit
history is the authoritative record of day-to-day authorship.

## How to read the commit history

* commits tagged `data:` touch the parser, the splitting logic or the figures;
* commits tagged `model:` touch the network, the loss or the optimiser;
* commits tagged `docs:` touch the report and the mentor documentation.

## External resources

* Dataset: Hanyang University / Hexar Humancare, distributed through the course
  LMS (not redistributed here).
* Course brief: *IC-PBL Project of Machine Learning 2025-Fall*, Prof. Yongjae Yoo.
