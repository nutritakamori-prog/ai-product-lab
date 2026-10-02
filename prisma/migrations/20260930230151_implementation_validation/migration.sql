-- CreateEnum
CREATE TYPE "ImplementationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'INCONCLUSIVE');

-- CreateTable
CREATE TABLE "Implementation" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "status" "ImplementationStatus" NOT NULL DEFAULT 'PENDING',
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Implementation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Validation" (
    "id" TEXT NOT NULL,
    "implementationId" TEXT NOT NULL,
    "status" "ValidationStatus" NOT NULL DEFAULT 'PENDING',
    "retestMissionRunId" TEXT,
    "retestTestRunId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Validation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Implementation_recommendationId_key" ON "Implementation"("recommendationId");

-- CreateIndex
CREATE INDEX "Validation_implementationId_idx" ON "Validation"("implementationId");

-- AddForeignKey
ALTER TABLE "Implementation" ADD CONSTRAINT "Implementation_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Validation" ADD CONSTRAINT "Validation_implementationId_fkey" FOREIGN KEY ("implementationId") REFERENCES "Implementation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Validation" ADD CONSTRAINT "Validation_retestMissionRunId_fkey" FOREIGN KEY ("retestMissionRunId") REFERENCES "EvaluationMissionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Validation" ADD CONSTRAINT "Validation_retestTestRunId_fkey" FOREIGN KEY ("retestTestRunId") REFERENCES "TestRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
