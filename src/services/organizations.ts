import { db } from "@/lib/db";

/**
 * There's no auth/sign-up flow yet (that's part of SaaS prep, Phase 14).
 * Until then, the whole app operates against one bootstrap Organization —
 * created lazily, once, on first access. Every later multi-org/auth phase
 * replaces the caller of this function, not the Organization/User/
 * OrganizationMember schema itself.
 */
export async function getDefaultOrganization() {
  const existing = await db.organization.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  const owner = await db.user.create({
    data: {
      email: "owner@ai-product-lab.local",
      name: "Owner",
    },
  });

  return db.organization.create({
    data: {
      name: "My Organization",
      slug: "default",
      members: {
        create: { userId: owner.id, role: "OWNER" },
      },
    },
  });
}
