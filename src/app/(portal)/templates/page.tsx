import { requireAgent } from "@/lib/auth";
import { listTemplates } from "@/lib/queries";
import { TemplateLibrary } from "@/components/template-library";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  await requireAgent();
  const templates = await listTemplates();

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border)] px-3 sm:px-5">
        <h1 className="text-sm font-semibold">Templates</h1>
        <span className="hidden text-xs text-[var(--muted-foreground)] sm:inline">
          Shared with the whole team · type <kbd className="rounded border border-[var(--border)] px-1">/</kbd> in any reply to insert one
        </span>
      </header>
      <TemplateLibrary templates={templates} />
    </div>
  );
}
