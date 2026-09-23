/*
  Warnings:

  - You are about to drop the `AgentExecution` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Decision` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Finding` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Lap` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Task` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TokenUsage` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_AgentExecutionToFinding` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "AgentType" AS ENUM ('EXPERIENCE', 'QA', 'DESIGN', 'STRATEGY');

-- CreateEnum
CREATE TYPE "AgentPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ModelTier" AS ENUM ('LOW_COST', 'BALANCED', 'HIGH_REASONING');

-- DropForeignKey
ALTER TABLE "AgentExecution" DROP CONSTRAINT "AgentExecution_lapId_fkey";

-- DropForeignKey
ALTER TABLE "Decision" DROP CONSTRAINT "Decision_decidedById_fkey";

-- DropForeignKey
ALTER TABLE "Decision" DROP CONSTRAINT "Decision_findingId_fkey";

-- DropForeignKey
ALTER TABLE "Decision" DROP CONSTRAINT "Decision_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Finding" DROP CONSTRAINT "Finding_lapId_fkey";

-- DropForeignKey
ALTER TABLE "Finding" DROP CONSTRAINT "Finding_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Lap" DROP CONSTRAINT "Lap_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_assigneeId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_sourceDecisionId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_sourceFindingId_fkey";

-- DropForeignKey
ALTER TABLE "TokenUsage" DROP CONSTRAINT "TokenUsage_executionId_fkey";

-- DropForeignKey
ALTER TABLE "_AgentExecutionToFinding" DROP CONSTRAINT "_AgentExecutionToFinding_A_fkey";

-- DropForeignKey
ALTER TABLE "_AgentExecutionToFinding" DROP CONSTRAINT "_AgentExecutionToFinding_B_fkey";

-- DropTable
DROP TABLE "AgentExecution";

-- DropTable
DROP TABLE "Decision";

-- DropTable
DROP TABLE "Finding";

-- DropTable
DROP TABLE "Lap";

-- DropTable
DROP TABLE "Task";

-- DropTable
DROP TABLE "TokenUsage";

-- DropTable
DROP TABLE "_AgentExecutionToFinding";

-- DropEnum
DROP TYPE "AgentExecutionStatus";

-- DropEnum
DROP TYPE "ConfidenceLevel";

-- DropEnum
DROP TYPE "FindingStatus";

-- DropEnum
DROP TYPE "FindingType";

-- DropEnum
DROP TYPE "FrequencyLevel";

-- DropEnum
DROP TYPE "ImpactLevel";

-- DropEnum
DROP TYPE "LapStatus";

-- DropEnum
DROP TYPE "SolutionType";

-- DropEnum
DROP TYPE "TaskStatus";

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AgentType" NOT NULL,
    "description" TEXT NOT NULL,
    "responsibility" TEXT NOT NULL,
    "whenNotToCall" TEXT NOT NULL,
    "capabilities" TEXT[],
    "systemPrompt" TEXT NOT NULL,
    "inputSchema" JSONB NOT NULL,
    "outputSchema" JSONB NOT NULL,
    "tokenBudget" INTEGER NOT NULL,
    "priority" "AgentPriority" NOT NULL DEFAULT 'MEDIUM',
    "recommendedModel" "ModelTier" NOT NULL DEFAULT 'BALANCED',
    "version" TEXT NOT NULL DEFAULT '0.1.0',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "allowedTools" TEXT[],
    "supportedTaskTypes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAgent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMemory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignMemory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_slug_key" ON "Agent"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAgent_projectId_agentId_key" ON "ProjectAgent"("projectId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMemory_projectId_key" ON "ProjectMemory"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DesignMemory_projectId_key" ON "DesignMemory"("projectId");

-- AddForeignKey
ALTER TABLE "ProjectAgent" ADD CONSTRAINT "ProjectAgent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAgent" ADD CONSTRAINT "ProjectAgent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMemory" ADD CONSTRAINT "ProjectMemory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignMemory" ADD CONSTRAINT "DesignMemory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
