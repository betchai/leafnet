-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DatasetStatus" AS ENUM ('DRAFT', 'READY', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AnnotationStatus" AS ENUM ('UNLABELED', 'NEEDS_REVIEW', 'ANNOTATED', 'EXPERT_REVIEWED', 'APPROVED', 'REJECTED', 'SECOND_OPINION', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "AnnotationStage" AS ENUM ('PRELIMINARY', 'EXPERT_REVIEW', 'FINAL_VERIFIED');

-- CreateTable
CREATE TABLE "datasets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT,
    "status" "DatasetStatus" NOT NULL DEFAULT 'DRAFT',
    "totalImages" INTEGER,
    "imagesPerClass" JSONB,
    "splitCounts" JSONB,
    "sources" JSONB,
    "changesFromPrevious" TEXT,
    "knownIssues" TEXT,
    "validationStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "images" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "widthPx" INTEGER,
    "heightPx" INTEGER,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    "source" TEXT,
    "sourceType" TEXT,
    "capturedAt" TIMESTAMP(3),
    "capturedTime" TEXT,
    "location" TEXT,
    "cultivar" TEXT,
    "leafAge" TEXT,
    "growthStage" TEXT,
    "lightingCondition" TEXT,
    "cameraType" TEXT,
    "orientation" TEXT,
    "plantId" TEXT,
    "leafId" TEXT,
    "farmId" TEXT,
    "collectionSessionId" TEXT,
    "license" TEXT,
    "isDevFixture" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "rejectedReason" TEXT,
    "annotationStatus" "AnnotationStatus" NOT NULL DEFAULT 'UNLABELED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classifications" (
    "id" TEXT NOT NULL,
    "classKey" TEXT NOT NULL,
    "severity" INTEGER,
    "notes" TEXT,
    "imageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annotations" (
    "id" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "stage" "AnnotationStage" NOT NULL,
    "preliminaryLabel" TEXT,
    "finalLabel" TEXT,
    "severity" INTEGER,
    "confidence" DOUBLE PRECISION,
    "uncertain" BOOLEAN NOT NULL DEFAULT false,
    "annotator" TEXT,
    "annotatedAt" TIMESTAMP(3),
    "reviewer" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "datasetVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "annotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annotation_audits" (
    "id" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousLabel" TEXT,
    "newLabel" TEXT,
    "previousStatus" "AnnotationStatus",
    "newStatus" "AnnotationStatus",
    "actor" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "annotation_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_relations" (
    "id" TEXT NOT NULL,
    "imageAId" TEXT NOT NULL,
    "imageBId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION,
    "resolution" TEXT DEFAULT '',
    "resolvedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_versions" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "architecture" TEXT,
    "datasetId" TEXT,
    "artifactPath" TEXT,
    "framework" TEXT,
    "trainingDate" TIMESTAMP(3),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "lifecycleStatus" TEXT NOT NULL DEFAULT 'experimental',
    "accuracy" DOUBLE PRECISION,
    "precision" DOUBLE PRECISION,
    "recall" DOUBLE PRECISION,
    "f1Score" DOUBLE PRECISION,
    "confusionMatrix" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "predictions" (
    "id" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "modelVersionId" TEXT,
    "predictedClass" TEXT,
    "confidence" DOUBLE PRECISION,
    "probabilities" JSONB,
    "isPlaceholder" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "predictionId" TEXT NOT NULL,
    "isCorrect" BOOLEAN,
    "verdict" TEXT,
    "correctedClass" TEXT,
    "comment" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "reviewer" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "verifiedClass" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_audits" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "previousState" JSONB,
    "newState" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_DatasetMembers" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DatasetMembers_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "datasets_version_key" ON "datasets"("version");

-- CreateIndex
CREATE UNIQUE INDEX "images_storagePath_key" ON "images"("storagePath");

-- CreateIndex
CREATE INDEX "images_annotationStatus_idx" ON "images"("annotationStatus");

-- CreateIndex
CREATE INDEX "images_plantId_idx" ON "images"("plantId");

-- CreateIndex
CREATE INDEX "images_leafId_idx" ON "images"("leafId");

-- CreateIndex
CREATE INDEX "images_farmId_idx" ON "images"("farmId");

-- CreateIndex
CREATE INDEX "images_collectionSessionId_idx" ON "images"("collectionSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "classifications_imageId_key" ON "classifications"("imageId");

-- CreateIndex
CREATE INDEX "annotations_imageId_idx" ON "annotations"("imageId");

-- CreateIndex
CREATE INDEX "annotations_stage_idx" ON "annotations"("stage");

-- CreateIndex
CREATE INDEX "annotation_audits_imageId_idx" ON "annotation_audits"("imageId");

-- CreateIndex
CREATE UNIQUE INDEX "image_relations_imageAId_imageBId_relationType_key" ON "image_relations"("imageAId", "imageBId", "relationType");

-- CreateIndex
CREATE UNIQUE INDEX "model_versions_version_key" ON "model_versions"("version");

-- CreateIndex
CREATE INDEX "predictions_imageId_idx" ON "predictions"("imageId");

-- CreateIndex
CREATE INDEX "predictions_modelVersionId_idx" ON "predictions"("modelVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_predictionId_key" ON "feedback"("predictionId");

-- CreateIndex
CREATE INDEX "system_audits_objectType_objectId_idx" ON "system_audits"("objectType", "objectId");

-- CreateIndex
CREATE INDEX "_DatasetMembers_B_index" ON "_DatasetMembers"("B");

-- AddForeignKey
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotation_audits" ADD CONSTRAINT "annotation_audits_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_relations" ADD CONSTRAINT "image_relations_imageAId_fkey" FOREIGN KEY ("imageAId") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_relations" ADD CONSTRAINT "image_relations_imageBId_fkey" FOREIGN KEY ("imageBId") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "datasets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "model_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_predictionId_fkey" FOREIGN KEY ("predictionId") REFERENCES "predictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DatasetMembers" ADD CONSTRAINT "_DatasetMembers_A_fkey" FOREIGN KEY ("A") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DatasetMembers" ADD CONSTRAINT "_DatasetMembers_B_fkey" FOREIGN KEY ("B") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

