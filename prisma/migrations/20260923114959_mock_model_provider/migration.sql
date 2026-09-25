-- CreateEnum
CREATE TYPE "ModelProviderKind" AS ENUM ('ANTHROPIC', 'MOCK');

-- AlterTable
ALTER TABLE "AgentExecution" ADD COLUMN     "provider" "ModelProviderKind" NOT NULL DEFAULT 'ANTHROPIC';
