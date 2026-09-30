-- CreateEnum
CREATE TYPE "EvaluationMissionRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'BLOCKED', 'FAILED');

-- CreateTable
CREATE TABLE "EvaluationMissionRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "EvaluationMissionRunStatus" NOT NULL DEFAULT 'RUNNING',
    "input" JSONB NOT NULL,
    "report" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationMissionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvaluationMissionRun_projectId_idx" ON "EvaluationMissionRun"("projectId");

-- AddForeignKey
ALTER TABLE "EvaluationMissionRun" ADD CONSTRAINT "EvaluationMissionRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
