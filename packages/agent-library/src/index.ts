import newUser from "./agents/new-user.js";
import qaAgent from "./agents/qa-agent.js";
import uxAgent from "./agents/ux-agent.js";
import accessibilityAgent from "./agents/accessibility-agent.js";
import productAgent from "./agents/product-agent.js";
import performanceAgent from "./agents/performance-agent.js";
import securityAgent from "./agents/security-agent.js";
import type { AgentDefinition } from "./protocol.js";

export const AGENT_DEFINITIONS: AgentDefinition[] = [
  newUser,
  qaAgent,
  uxAgent,
  accessibilityAgent,
  productAgent,
  performanceAgent,
  securityAgent,
];

export {
  newUser,
  qaAgent,
  uxAgent,
  accessibilityAgent,
  productAgent,
  performanceAgent,
  securityAgent,
};

export {
  AGENT_CATEGORIES,
  MODEL_TIERS,
  agentDefinitionSchema,
  type AgentCategory,
  type AgentModelTier,
  type AgentDefinition,
} from "./protocol.js";

export {
  AGENT_OUTPUT_STATUSES,
  IMPACT_LEVELS,
  CONFIDENCE_LEVELS,
  FINDING_CLASSIFICATIONS,
  agentOutputBaseSchema,
  agentOutputSchema,
  type AgentOutput,
  type FindingClassification,
} from "./agent-output.js";
