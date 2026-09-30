-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('PENDING', 'APPROVED', 'IGNORED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AgentType" ADD VALUE 'ACCESSIBILITY';
ALTER TYPE "AgentType" ADD VALUE 'PRODUCT';
ALTER TYPE "AgentType" ADD VALUE 'PERFORMANCE';
ALTER TYPE "AgentType" ADD VALUE 'SECURITY';

-- AlterTable
ALTER TABLE "EvaluationMissionRun" ADD COLUMN     "headReport" JSONB;

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "missionRunId" TEXT NOT NULL,
    "findingIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "whyItMatters" TEXT NOT NULL,
    "recommendedAction" TEXT NOT NULL,
    "impact" TEXT,
    "confidence" TEXT,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_missionRunId_findingIndex_key" ON "Recommendation"("missionRunId", "findingIndex");

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_missionRunId_fkey" FOREIGN KEY ("missionRunId") REFERENCES "EvaluationMissionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
