# Methodology

*This chapter documents the research design, data, algorithm, system
development, training procedure, and the a priori acceptance criteria against
which the developed model was evaluated (Manuscript Objective 4). It follows
APA (7th ed., 2020) conventions for headings, citation, and the reference list.
All thresholds, hyperparameters, and performance figures correspond to the
values actually recorded in the LEAFNET repository (`ml/src/config/`,
`ml/reports/`, and `git log`).*

## Research Design

The study employed an **applied research design** (Creswell & Creswell, 2023)
whose goal was to develop a working web-based information system—LEAFNET—that
automates the classification of mulberry leaf health, and to evaluate both its
technical performance (accuracy, precision, recall, and F1-score) and its
user-related usability (System Usability Scale; Brooke, 1996). The design is
appropriate because the study addresses the operational problem of manual
visual disease identification at the Sericulture Research and Development
Institute (SRDI) rather than only generating theoretical knowledge.

The development process followed the *Cross-Industry Standard Process for Data
Mining* (CRISP-DM), whose six phases—business understanding, data
understanding, data preparation, modelling, evaluation, and deployment—map one
to one onto the study's activities (Wirth & Hipp, 2000). Consistent with the
data-science emphasis of the discipline, the modelling phase itself was run
under the disciplined, version-controlled workflow described in the sections
below.

## Research Objectives Served by this Methodology

The methodology operationalizes the four research objectives:

1. To identify and label the foliar diseases of mulberry based on their
   symptomological and morphological characteristics.
2. To design and develop a supervised machine learning model capable of
   classifying mulberry leaves as either healthy or diseased.
3. To develop an intelligent web-based information system that integrates the
   classification model and supports centralized data management and
   evidence-based decision making (design, deployment, and System Usability
   Scale evaluation).
4. To test and evaluate the performance of the proposed machine learning model
   using appropriate evaluation metrics in terms of **(1.1) accuracy, (2.2)
   precision, (3.3) recall, and (4.4) F1-score.**

## Study Setting and Data Sources

The dataset was collected from the mulberry plantations of the **Sericulture
Research and Development Institute (SRDI)** of the Don Mariano Marcos Memorial
State University (DMMMSU). Permission to conduct the study and to capture
material was secured from the SRDI head office through a formally prepared
letter of request and interview. The target dataset comprises **2,000
high-quality mulberry leaf images** distributed evenly across four classes of
**500 images each**: *healthy, leaf rust, leaf spot, and leaf blight*. Class
labels followed the symptomological and morphological descriptions agreed with
the sericulture expert (Objective 1).

Each image is accompanied by essential metadata—farm name, date and time of
capture, GPS coordinates, and mulberry variety—which is stored in a centralized
relational repository to support audit, reproducibility, and long-term
monitoring.

## Research Instruments

Two instruments were used. First, a **data standardization and annotation
schema** governed image acceptance (minimum resolution, supported formats) and
the label workflow, described below. Second, the **System Usability Scale
(SUS)** questionnaire (Brooke, 1996) was administered to field technicians and
prospective users following system deployment to evaluate usability; SUS
yields a 0–100 score whose bands in this study were interpreted as Excellent
(85–100), Good (70–84), Acceptable (50–69), and Poor (below 50).

## Data Collection, Validation, and Annotation (Objective 1)

Images were captured in the field and uploaded to the system's ingestion
service. Each image was passed through an automated validation step that
enforced technical acceptability (readability, format, and minimum resolution);
questionable or rejected files were flagged rather than silently dropped. Every
accepted image then entered a two-stage human labelling workflow with a full
audit trail:

- **Preliminary annotation** — a first annotator proposes a class
  (healthy/leaf_rust/leaf_spot/leaf_blight).
- **Expert confirmation** — the sericulture expert confirms or corrects the
  label; a row is usable for training and evaluation only after
  `APPROVED` status is reached.

Ground truth thus always originates from human experts and is never derived
from model output, consistent with the supervised-learning premise of the study
(Mohanty et al., 2016). Exact-duplicate detection and content-hash verification
were applied so that no test image duplicates a training or validation image at
evaluation time (leakage prevention).

## Data Preprocessing and Augmentation

Raw images were standardized before feeding the network:

- **Resizing.** All images were resized to **224 × 224 pixels** (bilinear
  interpolation), matching the input size expected by the base architecture
  (Sandler et al., 2018).
- **Normalization.** Pixel values were normalized using the ImageNet mean and
  standard deviation (µ = [0.485, 0.456, 0.406], σ = [0.229, 0.224, 0.225]),
  which are the statistics required by the pre-trained torchvision weights
  (Deng et al., 2009).
- **Augmentation (training only).** To improve generalization under real
  capture variance without distorting the lesion colours that define the
  classes, mild, botanically-motivated augmentation was applied on the fly
  (Shorten & Khoshgoftaar, 2019): horizontal flip at probability 0.5 (leaf
  disease symptoms are left-right symmetric), rotation within ±10° (handheld
  photographs arrive at arbitrary orientation), and mild colour jitter
  (brightness 0.15, contrast 0.15, saturation 0.05). Augmentation is never
  applied to validation or test images.

## Dataset Partitioning

To evaluate rigorously and prevent data leakage, the 2,000-image dataset was
partitioned using a **stratified 80/10/10 ratio** for training, validation, and
testing, respectively; stratification preserves the equal class proportions in
every subset. A **group-aware splitter** assigns images in groups (session,
farm, plant, and leaf keys) rather than per-image, so that images of the same
leaf cannot straddle the training and test partitions—an important protection
against optimistic performance estimates in plant-disease data (Barbedo,
2019). When group granularity was insufficient to guarantee a non-empty
validated test set at 10%, the splitter fell back to an image-level,
leakage-guarded split and the resulting model was explicitly labelled **PILOT**
so its metrics are not misrepresented as research findings.

## The Classification Algorithm (Objective 2)

The study used **MobileNetV2 transfer learning** (Sandler et al., 2018).
MobileNetV2 is a lightweight convolutional architecture built on inverted
residuals with linear bottlenecks and depth-wise separable convolutions, making
it well suited to web-based and lower-computational-capacity deployments. The
approach exploits **transfer learning**: features learned on the large ImageNet
corpus are reused, which is especially effective when the target dataset is
moderate in size (Deng et al., 2009; Yosinski et al., 2014).

Concretely, a MobileNetV2 backbone pre-trained on ImageNet (torchvision
`IMAGENET1K_V2` weights) was loaded, its original classification head was
removed, and a new classification head was attached whose output is a **4-class
softmax** over the classes (*healthy, leaf rust, leaf spot, leaf blight*). The
model therefore produces a full probability distribution for each image. Two
training regimes were compared:

- **Baseline (frozen backbone).** Pre-trained convolutional blocks were frozen
  and only the new head was trained (≈ 5,124 trainable parameters).
- **Fine-tuning.** The last five blocks of the backbone were unfrozen (partial
  fine-tune, ≈ 1,686,468 trainable parameters) so that higher-level features
  could adapt to mulberry-leaf symptomology.

This frozen-then-fine-tune schedule follows established transfer-learning
practice (Sandler et al., 2018; Yosinski et al., 2014) and is consistent with
reported success of CNN-based leaf-disease classifiers in the literature
(Ferentinos, 2018; Mohanty et al., 2016).

## Training Procedure and Hyperparameters

All configurations were centralized in `ml/src/config/training.json` and the
exact values recorded per experiment, never scattered through code. Standard
values were:

| Hyperparameter | Value |
|---|---|
| Input resolution | 224 × 224 |
| Batch size | 8 |
| Optimizer | Adam (Kingma & Ba, 2015) |
| Head learning rate | 1 × 10⁻⁴ |
| Backbone learning rate | 1 × 10⁻⁵ |
| Weight decay | 1 × 10⁻⁴ |
| Dropout (head) | 0.5 (Srivastava et al., 2014) |
| Loss | Categorical cross-entropy |
| Learning-rate schedule | ReduceLROnPlateau (factor 0.5, patience 2) |
| Early stopping | Enabled (patience 5 epochs; Prechelt, 1998) |
| Random seed | 42 (reproducibility) |

Training tracked `train_loss`, `train_accuracy`, `val_loss`, and `val_accuracy`
at every epoch. The checkpoint with the best **validation** performance was
saved as `model_best.pt`; the model was **never** exposed to the held-out test
set during training, validation, or hyperparameter selection, and the test set
was only used in the single formal evaluation pass described below.

## System Development: Technology Stack and Architecture (Objective 3)

The system was implemented as a **three-tier web architecture** so that the
frontend, the application backend, and the machine-learning execution remain
strictly separated:

```
React Frontend (apps/web)  -- REST /api/* -->  Node.js API (apps/api)
                                                 |  Prisma ORM
                                                 v
                                            PostgreSQL
                                                 |  HTTP only (ML_SERVICE_URL)
                                                 v
                         Python ML Service (FastAPI) --> PyTorch / MobileNetV2
```

The frontend never communicates with Python directly, and the API never spawns
an in-process Python interpreter; the Node.js API calls the machine-learning
microservice over HTTP (ML service URL). This separation preserves
maintainability and independent deployment of the ML layer.

**Frontend.** A single-page application built with **React 18**, **TypeScript**,
**Vite 5** (build/dev server), **Tailwind CSS 3** for responsive styling, and
**React Router 6** for page routing. It provides the Analyzer (image upload,
prediction with per-class probabilities and confidence), Insights (confusion
matrix, per-class metrics, difficult cases), Models registry (lifecycle
management and acceptance verdicts), Dataset/Dashboard, and Tools (bulk ingest,
label, review, feedback review, monitoring, and pipeline runner).

**Application backend (API).** A **Node.js 20 / TypeScript REST API** built on
**Express 4**, hardened with **Helmet**, using **Multer** for image uploads and
**Prisma 6** as the object-relational mapper over **PostgreSQL**. It exposes
the lifecycle and governance facilities: model registration, promotion
(experimental → evaluated → candidate → approved → active), audited activation,
feedback collection, and dataset/version management.

**Machine-learning service.** An independent **Python service** built with
**FastAPI** and **Uvicorn** (port 8000) that hosts the trained MobileNetV2
model through **PyTorch / torchvision**. It exposes `/health`, `/model`,
`/predict`, `/predict/batch`, and `/explain` (input-gradient saliency heatmaps;
Simonyan et al., 2014). Supporting scientific libraries include NumPy,
SciPy, pandas, scikit-learn, Pillow, OpenCV, and matplotlib; JupyterLab was
used for exploratory analysis; pytest and Vitest for the ML and API test
suites, respectively.

**Data and deployment tooling.** The repository is an npm workspaces monorepo;
database schema and migrations are managed by Prisma. **Docker Compose** and a
**Render** deployment manifest (`render.yaml`) package the services for
deployment. Version control (Git) and centralized configuration files
(`classes.json`, `training.json`, `acceptance.json`) guarantee reproducibility
of every experiment.

## Evaluation Metrics (Objective 4)

Performance was quantified from the confusion matrix computed on the held-out
test set, following standard multiclass measures (Sokolova & Lapalme, 2009;
Powers, 2011). Let TP, TN, FP, and FN denote true/false positives/negatives per
class and *C* the number of classes:

- **Accuracy** — proportion of correct predictions:

  Accuracy = (TP + TN) / (TP + TN + FP + FN)

- **Precision** — of the items predicted as a class, the proportion correct:

  Precision = TP / (TP + FP)

- **Recall (Sensitivity)** — of the actual instances of a class, the
  proportion correctly identified:

  Recall = TP / (TP + FN)

- **F1-score** — harmonic mean of precision and recall (class level), and
  **macro-average F1** = (1/C)·Σ F1_c across classes.

Per-class precision, recall, and F1 were reported for every class, together
with macro- and weighted averages and a 4 × 4 confusion matrix. Confidence
behaviour was also audited (mean confidence of correct vs. incorrect
predictions and count of high-confidence errors ≥ 0.8) to describe calibration
honestly without overstating it (Guo et al., 2017).

## A Priori Acceptance Criteria (Pre-Registered)

Because the study's Objective 4 requires demonstrating performance in terms of
accuracy, precision, recall, and F1, **pre-registered acceptance thresholds**
were fixed *before* the training runs and were never adjusted after results
were observed. They are recorded in `ml/src/config/acceptance.json`
(version 2) and enforced by `evaluate_acceptance()`. The bars are:

| Objective * | Manuscript metric | Criterion | Threshold |
|---|---|---|---|
| 4.1 | Accuracy | `accuracy_min` | ≥ 0.60 |
| 4.2 | Precision (macro) | `macro_precision_min` | ≥ 0.60 |
| 4.2 | Precision (worst class) | `per_class_precision_min` | ≥ 0.40 |
| 4.3 | Recall (macro) | `macro_recall_min` | ≥ 0.60 |
| 4.3 | Recall (worst class) | `per_class_recall_min` | ≥ 0.40 |
| 4.4 | F1-score (macro) | `macro_f1_min` | ≥ 0.60 |
| 4.4 | F1-score (worst class) | `per_class_f1_min` | ≥ 0.40 |
| — | Evidence floor | `test_size_min` | ≥ 30 test images |

The macro bars require a comfortable margin above chance (0.25 for a four-class
problem) and guard against accuracy inflated by a dominant class; the
worst-class bars guarantee that no class is silently neglected in any of the
three quality metrics; and the evidence floor ensures a verdict is rendered
only when the held-out test set is large enough (the full-dataset target is
n = 200, i.e., 10% of 2,000). A candidate is graded **PASS** when every
threshold is met, **FAIL** when any threshold is missed, and **INCONCLUSIVE**
when the test set is below the evidence floor. This verdict is **advisory by
design**: the objective criteria support, rather than replace, the expert's
decision to promote (approve/activate) a model.

## Performance of the Developed Model Against the Acceptance Criteria

> **Point-in-time record.** The figures below describe models trained on
> earlier dataset versions (V1.0/V1.1, ≤ 404 test images in the pre-clean-slate
> state) and most carry the PILOT label because grouped (leaf-correlated)
> splits were not yet possible. They document that the acceptance procedure
> works and illustrate the judgement standard; they are **not** the thesis's
> final results. After a clean-slate reset, new dataset ingestion, and
> retraining, this section is superseded by the evaluation of the final
> dataset-version-tagged models under the same pre-registered criteria and is
> regenerated from `ml/reports/evaluation/*/metrics.json` (acceptance verdicts
> are computed by `evaluate_acceptance`, never hand-filled).

The reported figures are test-set metrics computed by the identical,
integrity-checked evaluation procedure for every candidate (single evaluation
pass; test set and model weights never modified). Verdicts were recomputed
against the v2 thresholds for this study:

| Model version | Test n | Accuracy | Macro P | Macro R | Macro F1 | Worst F1 | Verdict |
|---|---|---|---|---|---|---|---|
| V1.0_r2_EXP-V1.0-FT (fine-tuned) | 200 | **0.845** | 0.853 | 0.849 | **0.850** | 0.776 | **PASS** |
| V1.0_r3_EXP-V1.0-FT | 400 | 0.688 | 0.685 | 0.688 | 0.681 | 0.430 | FAIL (worst-class recall 0.37) |
| V1.1_EXP-V1.1-FT (80/10/10) | 404 | 0.671 | 0.688 | 0.672 | 0.677 | 0.428 | **PASS** |
| V1.1_EXP-V1.1-B (baseline, frozen) | 404 | 0.611 | 0.630 | 0.612 | 0.617 | 0.430 | FAIL (worst-class P=0.39, R=0.40) |
| V1.0_r3_EXP-V1.0-B | 400 | 0.667 | 0.664 | 0.667 | 0.664 | 0.513 | **PASS** |

Among the pre-clean-slate candidates, **V1.0_r2_EXP-V1.0-FT** attained 84.5%
test accuracy and a macro F1 of 0.850 with a worst-class F1 of 0.776—well above
the 0.60/0.60/0.40/0.40 bars—and was at that time promoted through the
lifecycle to active. Fine-tuning (last-five-block partial fine-tune)
consistently out-performed the frozen-backbone baseline (e.g., 0.671 vs. 0.611
accuracy on V1.1), consistent with the transfer-learning literature (Yosinski
et al., 2014; Ferentinos, 2018). Evaluation on the natural (in-situ) background
domain was additionally planned to detect covariate shift relative to the
curated white-removed test set; models for which no such test data were
available report "no domain test data" rather than an estimated value.

### Statistical and Evidentiary Caveats

Consistent with the study's honesty principles (no fabricated metrics), the
following caveats accompany every reported figure: (a) metrics are computed
formally but, at the test sizes shown, do not carry statistical significance at
the same level as the full n = 200 research target; (b) models trained before
group keys were fully populated are labelled **PILOT** because leaf-correlated
(leakage-free) splits were not yet possible; (c) the classifier is single-label
(a 4-way softmax); and (d) predicted-class confidence is not a calibrated
probability. For these reasons the acceptance verdict is advisory and the
ultimate deployment decision remains with the expert.

## Ethical Considerations

Data collection was conducted with the permission of the DMMMSU-SRDI head
office; the dataset and metadata are used solely for the research described.
Human involvement in ground-truth labelling and in system usability assessment
(SUS) was managed in accordance with standard research-ethics expectations for
student research, including informed consent and anonymized reporting.

## References

Barbedo, J. G. A. (2019). Plant disease identification from individual lesions
and spots using deep learning. *Biosystems Engineering, 180*, 96–107.
https://doi.org/10.1016/j.biosystemseng.2019.02.009

Brooke, J. (1996). SUS: A "quick and dirty" usability scale. In P. W. Jordan,
B. Thomas, B. A. Weerdmeester, & I. L. McClelland (Eds.), *Usability
evaluation in industry* (pp. 189–194). Taylor & Francis.

Creswell, J. W., & Creswell, J. D. (2023). *Research design: Qualitative,
quantitative, and mixed methods approaches* (6th ed.). Sage.

Deng, J., Dong, W., Socher, R., Li, L.-J., Li, K., & Fei-Fei, L. (2009).
ImageNet: A large-scale hierarchical image database. *Proceedings of the IEEE
Conference on Computer Vision and Pattern Recognition (CVPR)*, 248–255.
https://doi.org/10.1109/CVPR.2009.5206848

Ferentinos, K. P. (2018). Deep learning models for plant disease detection and
diagnosis. *Computers and Electronics in Agriculture, 145*, 311–318.
https://doi.org/10.1016/j.compag.2018.01.009

Guo, C., Pleiss, G., Sun, Y., & Weinberger, K. Q. (2017). On calibration of
modern neural networks. *Proceedings of the 34th International Conference on
Machine Learning (ICML), 70*, 1321–1330.

Kingma, D. P., & Ba, J. (2015). Adam: A method for stochastic optimization.
*3rd International Conference on Learning Representations (ICLR)*.
https://arxiv.org/abs/1412.6980

Mohanty, S. P., Hughes, D. P., & Salathé, M. (2016). Using deep learning for
image-based plant disease detection. *Frontiers in Plant Science, 7*, 1419.
https://doi.org/10.3389/fpls.2016.01419

Paszke, A., Gross, S., Massa, F., Lerer, A., Bradbury, J., Chanan, G., Killeen,
T., Lin, Z., Gimelshein, N., Antiga, L., Desmaison, A., Köpf, A., Yang, E.,
DeVito, Z., Raison, M., Tejani, A., Chilamkurthy, S., Steiner, B., Fang, L., …
Chintala, S. (2019). PyTorch: An imperative style, high-performance deep
learning library. *Advances in Neural Information Processing Systems, 32*,
8024–8035. https://papers.nips.cc/paper/9015

Powers, D. M. W. (2011). Evaluation: From precision, recall and F-measure to
ROC, informedness, markedness and correlation. *Journal of Machine Learning
Technologies, 2*(1), 37–63.

Prechelt, L. (1998). Early stopping—But when? In G. B. Orr & K.-R. Müller
(Eds.), *Neural networks: Tricks of the trade* (pp. 55–69). Springer.
https://doi.org/10.1007/3-540-49430-8_3

Sandler, M., Howard, A., Zhu, M., Zhmoginov, A., & Chen, L.-C. (2018).
MobileNetV2: Inverted residuals and linear bottlenecks. *Proceedings of the
IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)*,
4510–4520. https://doi.org/10.1109/CVPR.2018.00474

Shorten, C., & Khoshgoftaar, T. M. (2019). A survey on image data augmentation
for deep learning. *Journal of Big Data, 6*, 60.
https://doi.org/10.1186/s40537-019-0197-0

Simonyan, K., Vedaldi, A., & Zisserman, A. (2014). Deep inside convolutional
networks: Visualising image classification models and saliency maps.
*Proceedings of the ICLR Workshop*. https://arxiv.org/abs/1312.6034

Sokolova, M., & Lapalme, G. (2009). A systematic analysis of performance
measures for classification tasks. *Information Processing & Management,
45*(4), 427–437. https://doi.org/10.1016/j.ipm.2009.03.002

Srivastava, N., Hinton, G., Krizhevsky, A., Sutskever, I., & Salakhutdinov, R.
(2014). Dropout: A simple way to prevent neural networks from overfitting.
*Journal of Machine Learning Research, 15*(56), 1929–1958.

Wirth, R., & Hipp, J. (2000). CRISP-DM: Towards a standard process model for
data mining. *Proceedings of the 4th International Conference on the Practical
Applications of Knowledge Discovery and Data Mining*, 29–39.

Yosinski, J., Clune, J., Bengio, Y., & Lipson, H. (2014). How transferable are
features in deep neural networks? *Advances in Neural Information Processing
Systems (NIPS), 27*, 3320–3328. https://arxiv.org/abs/1411.1792