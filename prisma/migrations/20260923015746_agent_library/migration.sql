/*
  Warnings:

  - You are about to drop the column `allowedTools` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `capabilities` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `inputSchema` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `outputSchema` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `priority` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `recommendedModel` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `responsibility` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `supportedTaskTypes` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `systemPrompt` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `version` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `whenNotToCall` on the `Agent` table. All the data in the column will be lost.
  - Added the required column `category` to the `Agent` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "AgentType" ADD VALUE 'ORCHESTRATION';

-- AlterTable
ALTER TABLE "Agent" DROP COLUMN "allowedTools",
DROP COLUMN "capabilities",
DROP COLUMN "description",
DROP COLUMN "inputSchema",
DROP COLUMN "name",
DROP COLUMN "outputSchema",
DROP COLUMN "priority",
DROP COLUMN "recommendedModel",
DROP COLUMN "responsibility",
DROP COLUMN "supportedTaskTypes",
DROP COLUMN "systemPrompt",
DROP COLUMN "type",
DROP COLUMN "version",
DROP COLUMN "whenNotToCall",
ADD COLUMN     "category" "AgentType" NOT NULL,
ADD COLUMN     "modelTier" "ModelTier" NOT NULL DEFAULT 'BALANCED';

-- DropEnum
DROP TYPE "AgentPriority";
