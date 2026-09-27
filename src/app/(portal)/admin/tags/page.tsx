import { requireAdmin } from "@/lib/auth";
import { listTags } from "@/lib/queries";
import { deleteTag } from "@/lib/actions/admin";
import { DeleteForm } from "@/components/admin/forms";
import { TagEditor } from "@/components/admin/tag-editor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function TagsPage() {
  await requireAdmin();
  const tags = await listTags();

  return (
    <div className="max-w-3xl p-6">
      <h1 className="mb-5 text-base font-semibold">Tags</h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>New tag</CardTitle>
        </CardHeader>
        <CardContent>
          <TagEditor />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All tags</CardTitle>
          <CardDescription>
            Click the dot to change a colour. The slug is the tag&apos;s link
            (/tickets?tag=slug); changing it breaks old bookmarks to that tag.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-[var(--border)]">
            {tags.map((t) => (
              <li key={`${t.id}-${t.name}-${t.slug}-${t.color}`}>
                <TagEditor
                  tag={{ id: t.id, name: t.name, slug: t.slug, color: t.color }}
                  onDelete={<DeleteForm action={deleteTag} id={t.id} />}
                />
              </li>
            ))}
            {tags.length === 0 && (
              <li className="py-6 text-xs text-[var(--muted-foreground)]">No tags yet.</li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
