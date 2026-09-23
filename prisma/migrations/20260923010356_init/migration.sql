-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "ProjectMode" AS ENUM ('INTERNAL', 'PRODUCT', 'HYBRID');

-- CreateEnum
CREATE TYPE "LapStatus" AS ENUM ('DRAFT', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "FindingType" AS ENUM ('BUG', 'UX', 'UI', 'DATA', 'NAVIGATION', 'PERFORMANCE', 'RESPONSIVENESS', 'ACCESSIBILITY', 'CONTENT', 'AUTOMATION', 'OPPORTUNITY', 'FUTURE_RISK');

-- CreateEnum
CREATE TYPE "ImpactLevel" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "FrequencyLevel" AS ENUM ('ISOLATED', 'RECURRENT', 'GENERALIZED');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "SolutionType" AS ENUM ('QUICK_FIX', 'UX_IMPROVEMENT', 'UI_IMPROVEMENT', 'PRODUCT_IMPROVEMENT', 'AUTOMATION', 'NEW_FEATURE', 'FUTURE_IMPROVEMENT');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('OPEN', 'CONFIRMED', 'DISMISSED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "mode" "ProjectMode" NOT NULL DEFAULT 'HYBRID',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lap" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "mode" "ProjectMode" NOT NULL DEFAULT 'HYBRID',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "LapStatus" NOT NULL DEFAULT 'DRAFT',
    "scenarios" JSONB,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Lap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentExecution" (
    "id" TEXT NOT NULL,
    "lapId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "status" "AgentExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "model" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "lapId" TEXT NOT NULL,
    "type" "FindingType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "impact" "ImpactLevel" NOT NULL,
    "frequency" "FrequencyLevel" NOT NULL,
    "confidence" "ConfidenceLevel" NOT NULL,
    "recommendation" "SolutionType",
    "status" "FindingStatus" NOT NULL DEFAULT 'OPEN',
    "agentIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "findingId" TEXT,
    "problem" TEXT NOT NULL,
    "facts" TEXT NOT NULL,
    "interpretation" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "recommendation" TEXT NOT NULL,
    "tradeoffs" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "confidence" "ConfidenceLevel" NOT NULL,
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceFindingId" TEXT,
    "sourceDecisionId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "ImpactLevel" NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "assigneeId" TEXT,
    "acceptanceCriteria" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenUsage" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "estimatedCost" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_AgentExecutionToFinding" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AgentExecutionToFinding_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "_AgentExecutionToFinding_B_index" ON "_AgentExecutionToFinding"("B");

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lap" ADD CONSTRAINT "Lap_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_lapId_fkey" FOREIGN KEY ("lapId") REFERENCES "Lap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_lapId_fkey" FOREIGN KEY ("lapId") REFERENCES "Lap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sourceFindingId_fkey" FOREIGN KEY ("sourceFindingId") REFERENCES "Finding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sourceDecisionId_fkey" FOREIGN KEY ("sourceDecisionId") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenUsage" ADD CONSTRAINT "TokenUsage_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "AgentExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentExecutionToFinding" ADD CONSTRAINT "_AgentExecutionToFinding_A_fkey" FOREIGN KEY ("A") REFERENCES "AgentExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentExecutionToFinding" ADD CONSTRAINT "_AgentExecutionToFinding_B_fkey" FOREIGN KEY ("B") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
