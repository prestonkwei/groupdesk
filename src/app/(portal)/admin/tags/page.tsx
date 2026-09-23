import { requireAdmin } from "@/lib/auth";
import { listTags } from "@/lib/queries";
import { createTag, deleteTag } from "@/lib/actions/admin";
import { DeleteForm, NameForm } from "@/components/admin/forms";
import { TagBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const COLORS = ["slate", "blue", "green", "amber", "rose", "violet"];

export default async function TagsPage() {
  await requireAdmin();
  const tags = await listTags();

  return (
    <div className="max-w-2xl p-6">
      <h1 className="mb-5 text-base font-semibold">Tags</h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>New tag</CardTitle>
        </CardHeader>
        <CardContent>
          <NameForm
            action={createTag}
            label="Create tag"
            placeholder="Chromebook"
            colors={COLORS}
          />
        </CardContent>
      </Card>

      <ul className="divide-y divide-[var(--border)] text-sm">
        {tags.map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-2">
            <TagBadge name={t.name} color={t.color} />
            <span className="flex-1 text-xs text-[var(--muted-foreground)]">{t.slug}</span>
            <DeleteForm action={deleteTag} id={t.id} />
          </li>
        ))}
        {tags.length === 0 && (
          <li className="py-6 text-xs text-[var(--muted-foreground)]">No tags yet.</li>
        )}
      </ul>
    </div>
  );
}
