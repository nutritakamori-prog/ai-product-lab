import { PageHeader } from "@/components/page-header";
import { getDefaultOrganization } from "@/services/organizations";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const organization = await getDefaultOrganization();
  const members = await db.organizationMember.findMany({
    where: { organizationId: organization.id },
    include: { user: true },
  });

  return (
    <>
      <PageHeader title="Settings" description="Organization details." />
      <div className="max-w-lg px-8 py-8">
        <dl className="divide-y divide-border rounded-lg border border-border">
          <div className="flex items-center justify-between px-4 py-3">
            <dt className="text-sm text-muted">Organization</dt>
            <dd className="text-sm font-medium">{organization.name}</dd>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <dt className="text-sm text-muted">Slug</dt>
            <dd className="text-sm font-medium">{organization.slug}</dd>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <dt className="text-sm text-muted">Members</dt>
            <dd className="text-sm font-medium">{members.length}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-muted">
          There is no sign-up/auth flow yet — this organization was created automatically on
          first run. Multi-user auth and billing arrive in Phase 14 (SaaS preparation).
        </p>
      </div>
    </>
  );
}
