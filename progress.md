# Progress Log

## Current Status

- Standalone project scaffold created.
- Modeling contract and frozen-test policy recorded.
- Initial source and test skeletons created.
- Official source URL and known cleaned-snapshot limitations recorded.
- X-suffixed equipment policy recorded.
- Real-data validation passed and formal JSON/Markdown audit reports generated.
- X-suffix exclusion and row-level feature-history eligibility implemented.
- Missing age handled with training-fold median imputation plus `age_missing`.
- Four rolling temporal validation folds implemented and verified.
- Primary and secondary development-only target prevalence reports generated.
- Frozen-test feature counts confirmed without exposing labels.
- Primary prevalence discrepancy investigated in a development-only audit.
- Session 2 leakage-safe feature comparisons, naive baselines, regularized
  logistic regression, and validation-selected operating thresholds completed.
- Future-perturbation and equipment-boundary feature leakage tests added.
- Session 3 fold-safe preprocessing audits, development-safe threshold
  evaluation, calibration diagnostics, age pressure tests, controlled tree
  comparisons, and grouped unseen-equipment diagnostics completed.
- Session 4 focused tabular tuning, seed stability testing, coefficient review,
  weak-fold investigation, threshold tradeoffs, calibration comparison, and
  tabular-readiness gate completed.
- Focused development-only histogram-gradient-boosting evaluation and neutral
  three-model tabular comparison completed.
- Session 4.2 development-only TCN challenger, three-seed stability run, and
  exact matching-cohort tabular comparison completed.
- Session 4.3 development-only XGBoost challenger and exact matching-cohort
  Random Forest comparison completed.
- Final development-only model decision completed. Random Forest and its
  model-specific threshold remain locked; Session 5 approval and evaluation
  are complete.
- Session 5 preflight and the one-time final frozen-test evaluation completed.
- The final Random Forest was fitted once on all `13,202` eligible development
  rows, and the frozen February-April 2025 labels were accessed exactly once
  through the configured audit mechanism.
- Final frozen-test results: `974` rows, `326` elevators, prevalence
  `0.399384`, PR-AUC `0.648004`, ROC-AUC `0.716806`, Brier `0.209976`,
  precision `0.526316`, recall `0.694087`, `243` false positives, and `119`
  false negatives at the unchanged threshold `0.4433219097353501`.
- Session 5.5 data lineage reconstruction completed using the local July 2025
  official availability export and `df1_station_master.csv`.
- `df3_availability.csv` was exactly regenerated as the official availability
  export filtered to elevators from January 2021 onward, with no aggregation
  or cell-level cleaning. The regenerated DataFrame matches the fixed training
  snapshot exactly.
- Source-to-canonical skeleton and overwrite guardrail tests were added.
- Session 6 prospective external evaluation completed using the untouched
  June 16, 2026 official export at
  `data/external/MTA_NYCT_Subway_Elevator_and_Escalator_Availability__Beginning_2015.csv`.
- The latest official export was transformed through
  `src/mta_elevator_pipeline/source_to_canonical.py` and saved separately as
  `data/processed/session6_latest_canonical_availability.csv`; the fixed
  training snapshot was not overwritten.
- The locked Session 5 Random Forest artifact and unchanged threshold
  `0.4433219097353501` were evaluated on target-known prospective prediction
  months June 2025 through March 2026.
- Session 6 prospective results: `3,425` rows, `346` elevators, prevalence
  `0.437664`, PR-AUC `0.653008`, ROC-AUC `0.711994`, Brier `0.213711`,
  precision `0.564278`, recall `0.714476`, `827` false positives, and `428`
  false negatives.
- Colab CPU workflow instructions were added in `COLAB_COMPATIBILITY.md` and
  `notebooks/colab_runner.ipynb`.
- Session 7 final backend reporting completed without retuning, retraining,
  recalibration, stacking, feature changes, target changes, eligibility
  changes, threshold changes, frozen-test reruns, or overwriting
  `data/raw/df3_availability.csv`.
- Final reports were saved under `outputs/reports/`:
  `final_model_card.md`, `final_backend_summary.md`,
  `final_metrics_comparison.csv`, and `frontend_prediction_schema.md`.
- Latest unlabeled prediction outputs were saved to
  `outputs/predictions/latest_unlabeled_risk_scores.csv` and
  `outputs/predictions/latest_unlabeled_risk_scores_metadata.json`.
- Latest unlabeled predictions use April 2026 features to predict May 2026:
  `348` eligible elevator rows, with `203` high-risk rows at the locked
  threshold, `102` medium display-tier rows, and `43` low display-tier rows.
- May 2026 outcomes are unavailable, so the latest prediction batch is not
  evaluated and must not be used to change the locked research model.
- Colab notebook packaging has been updated for Session 7 and
  `notebooks/colab_runner.ipynb` has valid JSON. A live clean Colab CPU
  runtime execution remains pending unless performed manually.

## Next Session

1. Treat the backend research pipeline as frozen and evaluated.
2. Do not rerun or retune against the completed frozen test.
3. Do not use Session 6 prospective results or Session 7 latest unlabeled
   predictions to change the locked model, threshold, feature set, target,
   calibration, or eligibility rules.
4. Consider any future retraining only as a separately labeled deployment
   model trained after the recorded prospective evaluation and latest-score
   export.
5. Run the Colab notebook manually in a clean Colab CPU runtime when external
   environment verification is required.

## Experiment Results

- Real-data development-only rolling validation completed for logistic
  regression, random forest, and histogram gradient boosting.
- Results: `outputs/metrics/rolling_development_validation.json`.
- Target prevalence reports: `outputs/metrics/primary_target_prevalence.json`
  and `outputs/metrics/secondary_target_prevalence.json`.
- Formal audit: `outputs/audits/real_data_audit.md` and
  `outputs/audits/real_data_audit.json`.
- Prevalence investigation:
  `outputs/audits/primary_target_prevalence_investigation.md` and
  `outputs/audits/primary_target_prevalence_investigation.json`.
- Session 1 target and temporal-split work is complete. The earlier approximate
  `0.367` estimate has no saved calculation, but including X-suffixed
  zero-outcome records with the correct target yields `0.368198`, making X
  inclusion the strongest quantitative explanation.
- Session 2 controlled results:
  `outputs/metrics/session2_development_validation.json` and
  `experiments/feature_sets/session2_experiment_record.json`.
- Best logistic variant: full history with age, mean PR-AUC `0.674565`,
  PR-AUC standard deviation `0.031191`, mean ROC-AUC `0.737501`, and mean Brier
  score `0.208648`.
- Full-history-with-age fold PR-AUC: `0.673745`, `0.693405`, `0.624484`, and
  `0.706625`. The August-October 2024 fold remains the weakest.
- At the pooled development-selected threshold `0.447778`, full history with
  age achieved pooled precision `0.600847`, recall `0.702351`, `754` false
  positives, and `481` false negatives.
- Matching full-history cohort mean PR-AUC baselines: prevalence `0.427492`,
  previous-month failure persistence `0.539220`, and simple outage rule
  `0.510965`.
- Recommendation recorded in `decisions.md`: proceed to tree-based modeling
  with short/full history, both with and without age; do not proceed with
  current-only variants.
- Session 3 controlled results:
  `outputs/metrics/session3_development_validation.json` and
  `experiments/model_selection/session3_experiment_record.json`.
- All preprocessing audits confirm fold-local fitting on training rows only.
  Every model and baseline comparison uses the matching eligible cohort.
- The corrected threshold policy selects thresholds on the first three
  development folds and evaluates the fixed threshold on the latest fold.
- Full-history random forest with age ranked first at mean PR-AUC `0.678555`
  and latest-fold PR-AUC `0.716169`, but the mean gain over full-history
  logistic regression with age is only about `0.0040` and is not considered
  material.
- Full-history random forest without age achieved mean PR-AUC `0.676169`,
  latest-fold PR-AUC `0.714430`, and latest-fold recall `0.699779` with `136`
  false negatives at the earlier-fold-selected threshold.
- Full-history logistic regression without age achieved mean PR-AUC `0.673298`,
  latest-fold PR-AUC `0.705365`, and the same latest-fold recall and false
  negatives. Its lower complexity keeps it as a preferred candidate.
- Histogram gradient boosting improved calibration/Brier score but did not
  improve mean PR-AUC over logistic regression.
- All primary model folds beat their matching constant-prevalence Brier
  baseline. August-October 2024 remains the weakest fold, while
  November 2024-January 2025 rebounds; no monotonic late-period decline was
  observed.
- Age-only logistic regression achieved mean PR-AUC `0.472157`; adding age to
  full history improved mean PR-AUC by only `0.001267`.
- The age-field audit found `14,464` observed consecutive-month transitions,
  all incrementing by exactly `1`, despite the prior documented unit of days.
  No apparent resets were found. Age semantics are unresolved.
- Full-history validation contains no imputed-age rows. The current-history
  diagnostic contains only `28` imputed-age validation rows across all folds,
  too few for reliable subgroup conclusions.
- Grouped unseen-equipment diagnostic mean PR-AUC was `0.642284` for logistic
  regression, `0.635890` for random forest, and `0.624653` for histogram
  gradient boosting. This diagnostic is weaker than temporal validation and
  does not represent zero-history new elevators.
- Complete final-development-decision suite: `39` tests pass. No frozen-test
  access log exists.
- Session 4 controlled results:
  `outputs/metrics/session4_development_validation.json` and
  `experiments/model_selection/session4_experiment_record.json`.
- Focused logistic tuning selected L1 regularization with `C=0.1` and
  `liblinear`: mean PR-AUC `0.673873`, weakest-fold PR-AUC `0.624136`, and
  latest-fold PR-AUC `0.704437`.
- Focused forest tuning selected `600` estimators, depth `20`, minimum leaf
  size `15`, and square-root feature sampling: mean PR-AUC `0.679572`,
  weakest-fold PR-AUC `0.630940`, and latest-fold PR-AUC `0.715758`.
- Across five forest seeds, mean PR-AUC was `0.680911` with standard deviation
  `0.000989`. The forest advantage survives seeds but remains only about
  `0.0057`, below the documented materiality rule.
- Tuned logistic regression is exactly reproducible across repeated runs.
- The proposed tuned-logistic threshold `0.446530`, selected from the first
  three folds for approximately 70% recall, achieves latest-fold precision
  `0.623274`, recall `0.697572`, `191` false positives, and `137` false
  negatives. The approximately-80%-recall alternative achieves precision
  `0.583471`, recall `0.779249`, `252` false positives, and `100` false
  negatives.
- Platt calibration preserves logistic PR-AUC and improves mean Brier score
  from `0.209771` to `0.206501`, below the `0.005` materiality rule for adding
  calibration complexity. Isotonic calibration is rejected because mean
  PR-AUC falls from `0.673341` to `0.652837`. Propose no calibration.
- Logistic coefficients are mostly directionally stable. One feature,
  `scheduled_outages_lag_2`, changes direction across folds, and two
  availability rolling-feature pairs have absolute correlation above `0.95`;
  these redundancies are documented but not removed because focused tuning did
  not establish a development benefit from changing the feature contract.
- The weak August-October 2024 fold has lower prevalence (`0.402299`) than the
  other folds (`0.436370`) but no large feature shift or elevated missingness.
  Errors are spread across all three months, and the top ten elevators account
  for less than `9%` of errors for both selected models.
- The tabular-readiness gate passes. The TCN challenger was not evaluated
  because TensorFlow is absent from the current optional-dependency runtime;
  it is explicitly rejected for Session 4 rather than used without a
  reproducible environment.
- Focused boosted-tree results:
  `outputs/metrics/boosted_tree_development_validation.json`,
  `outputs/metrics/boosted_tree_comparison.md`, and
  `experiments/model_selection/boosted_tree_experiment_record.json`.
- Twelve intentional histogram-gradient-boosting configurations were compared.
  The selected configuration uses `500` iterations, learning rate `0.03`, `7`
  maximum leaf nodes, minimum leaf size `40`, L2 regularization `5.0`, and
  `255` bins.
- Selected histogram gradient boosting achieved folds-1-3 mean PR-AUC
  `0.664433`, four-fold mean PR-AUC `0.676516`, worst-fold PR-AUC `0.634391`,
  and fold-4 PR-AUC `0.712766`.
- Its folds-1-3-selected approximately-70%-recall threshold `0.394978` achieved
  fold-4 precision `0.646939`, recall `0.699779`, `173` false positives, and
  `136` false negatives.
- XGBoost was not evaluated because it is not installed in the current
  environment. No final model decision was made, and the final-selection
  record remains unapproved.
- Session 4.3 results:
  `outputs/metrics/session4_3_xgboost_development_validation.json`,
  `outputs/metrics/session4_3_xgboost_comparison.md`, and
  `experiments/model_selection/session4_3_xgboost_experiment_record.json`.
- XGBoost `2.1.4` is pinned in optional `requirements-xgboost.txt`; CPU
  execution with histogram tree fitting was confirmed. The core dependency
  file remains unchanged.
- Eight intentional XGBoost configurations were evaluated on folds 1-3 only.
  The selected configuration uses depth `2`, learning rate `0.05`, `700`
  estimators, minimum child weight `10`, full row and column sampling, no L1,
  and L2 regularization `5.0`.
- Selected XGBoost achieved folds-1-3 mean PR-AUC `0.665060`, four-fold mean
  PR-AUC `0.676464`, PR-AUC standard deviation `0.030117`, worst-fold PR-AUC
  `0.630528`, and fold-4 PR-AUC `0.710675`.
- At XGBoost's own folds-1-3-selected threshold `0.389102`, fold-4 precision
  was `0.625490`, recall was `0.704194`, with `191` false positives and `134`
  false negatives.
- The exact matching-cohort Random Forest re-evaluation achieved folds-1-3
  mean PR-AUC `0.667510`, four-fold mean `0.679572`, fold-4 PR-AUC `0.715758`,
  and one fewer false negative at the same false-positive count. XGBoost
  trails by `0.002450` on the primary selection metric and is not selected.
- Session 4.2 results:
  `outputs/metrics/session4_2_tcn_development_validation.json`,
  `outputs/metrics/session4_2_tcn_comparison.md`, and
  `experiments/deep_learning/session4_2_tcn_experiment_record.json`.
- Sequence cohorts contain `13,202` rows and `324` elevators at 6 months,
  `11,279` rows and `315` elevators at 12 months, and `7,628` rows and `298`
  elevators at 24 months. Relative to the target-eligible development cohort,
  the requirements exclude 16, 25, and 42 elevators respectively.
- Folds 1-3 select the 12-month TCN with 32 filters, dropout `0.2`, and
  dilations `[1, 2, 4]`. The seed-42 TCN achieves folds-1-3 mean PR-AUC
  `0.680844`, four-fold mean `0.687796`, worst-fold `0.638681`, and fold-4
  PR-AUC `0.708650`.
- On the exact 12-month-sequence cohort, Random Forest achieves folds-1-3 mean
  PR-AUC `0.669710` and fold-4 PR-AUC `0.720693`; histogram gradient boosting
  achieves `0.663043` and `0.712371`. The TCN's selection-fold advantage over
  Random Forest is only `0.011134`, below the materiality rule.
- At folds-1-3-selected approximately-70%-recall thresholds, seed-42 TCN
  fold-4 precision is `0.658354` and recall is `0.602740` with `137` false
  positives and `174` false negatives. Matching Random Forest recall is
  `0.707763` with `195` false positives and `128` false negatives; the TCN
  does not establish a clearly important comparable-recall tradeoff.
- Across seeds `21`, `42`, and `84`, TCN four-fold mean PR-AUC is `0.686208`,
  `0.687796`, and `0.681210`. Selected-configuration training across all seeds
  and folds took about `154.0` seconds on CPU, while all TCN training took
  about `330.2` seconds, so CPU execution is practical, but the dependency and
  non-material gain are not justified.
- Final development-only decision artifacts:
  `outputs/metrics/final_development_model_decision.json` and
  `outputs/metrics/final_development_model_decision.md`.
- Random Forest is selected as the production candidate because it leads
  folds-1-3 mean PR-AUC (`0.667510`), four-fold mean PR-AUC (`0.679572`), and
  fold-4 PR-AUC (`0.715758`) and has the fewest fold-4 false negatives (`133`).
- Lock the Random Forest approximately-70%-recall threshold at
  `0.4433219097353501`. Fold-4 precision is `0.626223`, recall is `0.706402`,
  false positives are `191`, and false negatives are `133`.
- Histogram gradient boosting's 18 fewer false positives are documented, but
  it has three more false negatives and does not lead development PR-AUC.
  Logistic regression trails both tree candidates after the completed
  comparison.
- Session 4.3 rejects optional XGBoost as non-material. The TCN remains
  rejected as non-material evidence.
- `config/final_model_selection.yaml` is populated but
  `approved_for_final_test` remains `false`. No frozen-test access occurred.
- Session 5 required outputs:
  `outputs/metrics/session5_preflight.md`,
  `outputs/metrics/session5_frozen_test_evaluation.md`,
  `outputs/metrics/session5_frozen_test_metrics.json`,
  `outputs/predictions/session5_frozen_test_predictions.csv`,
  `outputs/models/final_random_forest.joblib`, and
  `outputs/models/final_model_metadata.json`.
- Session 5 preflight passed before approval with `42` tests passing and no
  frozen-test access log present.
- The final frozen-test audit log contains one access entry. The saved
  evaluation is valid and must not be rerun.
- Frozen-test monthly PR-AUC was `0.689900` in February, `0.655915` in March,
  and `0.601887` in April 2025. April also had the lowest prevalence
  (`0.358896`) and the highest calibration ECE (`0.116008`).
- Compared with development, frozen-test PR-AUC and precision are lower, while
  recall remains close to the locked operating policy. These results do not
  change the selected model or threshold.
- Session 5.5 required outputs:
  `outputs/audits/session5_5_data_lineage.md` and
  `outputs/audits/session5_5_schema_comparison.json`.
- The local July 2025 official export has `72,797` rows, `22` columns, both
  elevators and escalators, and no duplicate equipment-month keys.
- `df1_station_master.csv` is a station-level lookup with `496` rows and
  `19` columns. No local `df2` file was found.
- `src/mta_elevator_pipeline/source_to_canonical.py` and
  `tests/test_source_to_canonical.py` now define and test the canonical schema,
  elevator/month filtering, and fixed-snapshot overwrite protection.
- Session 6 required outputs:
  `outputs/metrics/session6_prospective_evaluation.md`,
  `outputs/metrics/session6_prospective_metrics.json`,
  `outputs/predictions/session6_prospective_predictions.csv`, and
  `data/processed/session6_latest_canonical_availability.csv`.
- The June 16, 2026 latest official source has `80,316` rows, `22` columns,
  both elevators and escalators, no duplicate equipment-month keys, and spans
  January 2015 through April 2026. The processed canonical elevator-only file
  has `23,239` rows from January 2021 through April 2026.
- Prospective target-known prediction months are June 2025 through March 2026;
  April 2026 is present as a source month but is not evaluated because its
  May 2026 target month is unavailable.
- Prospective PR-AUC (`0.653008`) is close to and slightly above the frozen
  February-April 2025 PR-AUC (`0.648004`); ROC-AUC is slightly lower
  (`0.711994` versus `0.716806`), Brier is slightly worse (`0.213711` versus
  `0.209976`), and recall remains near the locked approximately-70% policy.
- Session 7 required outputs:
  `outputs/reports/final_model_card.md`,
  `outputs/reports/final_backend_summary.md`,
  `outputs/reports/final_metrics_comparison.csv`,
  `outputs/reports/frontend_prediction_schema.md`,
  `outputs/predictions/latest_unlabeled_risk_scores.csv`, and
  `outputs/predictions/latest_unlabeled_risk_scores_metadata.json`.
- The final backend reports distinguish development validation, the one-time
  frozen-test evaluation, prospective external evaluation, and latest
  unlabeled prediction generation.
- Latest unlabeled predictions use the locked Session 5 Random Forest artifact
  and unchanged threshold `0.4433219097353501` on April 2026 features to
  predict May 2026. The batch contains `348` eligible elevator rows and is not
  evaluated because May 2026 outcomes are unavailable.
- Risk tiers were added for display only: high at or above the locked
  threshold, medium from `0.30` to below the locked threshold, and low below
  `0.30`. The operational decision threshold remains unchanged.

## Unresolved Questions

- The semantic unit and provenance of `Time Since Major Improvement` are
  unresolved.
- The role of `df2` remains unresolved because no local `df2` file or
  transformation record was found.
- The cause of weaker August-October 2024 performance remains unresolved.
- Grouped-equipment performance is lower, and true zero-history performance
  cannot be estimated with the current feature-history requirements.
- The TCN does not meet the predeclared retention rule; TensorFlow 2.19.1
  produced noisy macOS CPU backend warnings that should be noted if the
  experiment is reproduced in Colab or documented as a model limitation.

## Exact Next Task

Session 7 final backend reporting and latest unlabeled prediction generation
are complete. Preserve Session 5 as the one-time final frozen-test evaluation,
Session 6 as the external prospective evaluation record, and Session 7 as the
final frozen-research-model reporting and latest-score export. Do not change
the locked model, feature set, parameters, calibration policy, eligibility,
target, or threshold based on prospective results or unlabeled latest scores.
Future retraining, if pursued, must be a separately labeled deployment-model
step and must not be presented as the same evaluated research model.

## Frontend Handoff

- The map frontend reads its risk scores from this repository, at
  `outputs/predictions/frontend_latest_risk_scores.csv` (with sidecar
  `frontend_latest_risk_scores_metadata.json`). This is the blessed frontend
  input; the map generator consumes it directly.
- That CSV and its metadata are local-only runtime artifacts, gitignored on
  purpose (see `.gitignore`), alongside the model `.joblib` pulled from the
  GitHub Release. The tracked, published prediction exports remain
  `outputs/predictions/latest_unlabeled_risk_scores.csv` and its metadata.
- The frontend scores forecast failure risk for June 2026 (the map legend and
  README describe them as the June 2026 forecast). They are not
  outcome-evaluated because June 2026 outcomes are not yet published by the
  MTA. Scores refresh monthly as new MTA data lands.
- This supersedes the pre-consolidation handoff note, which described score
  paths and a separate `web/` specs folder that no longer exist after the
  workspace was consolidated into this single repository.
