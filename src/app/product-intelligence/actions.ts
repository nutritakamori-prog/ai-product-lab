"use server";

import { revalidatePath } from "next/cache";
import { setRecommendationStatus } from "@/services/recommendations";

/**
 * The only two decisions a human can make on a Recommendation — see
 * prisma/schema.prisma's RecommendationStatus. Neither one touches the
 * product: APPROVED means "I want to turn this into a development action"
 * (the Change Proposal a developer/Claude Code acts on later, not
 * automatically from here), IGNORED means the finding stays in the record
 * but isn't being acted on. Both just update the row's own status and
 * refresh the two pages that show it.
 */
export async function approveRecommendationAction(id: string): Promise<void> {
  const recommendation = await setRecommendationStatus(id, "APPROVED");
  revalidatePath("/product-intelligence");
  revalidatePath(`/product-intelligence/recommendations/${id}`);
  revalidatePath(`/test-lab/missions/${recommendation.missionRunId}`);
}

export async function ignoreRecommendationAction(id: string): Promise<void> {
  const recommendation = await setRecommendationStatus(id, "IGNORED");
  revalidatePath("/product-intelligence");
  revalidatePath(`/product-intelligence/recommendations/${id}`);
  revalidatePath(`/test-lab/missions/${recommendation.missionRunId}`);
}
