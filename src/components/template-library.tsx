"use client";

import { useRef, useState, useTransition } from "react";
import { FileText, Plus, Search, Trash2 } from "lucide-react";
import { deleteTemplate, saveTemplate } from "@/lib/actions/templates";
import { RichEditor, type Editor, type RichValue } from "@/components/rich-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TEMPLATE_VARIABLES } from "@/lib/template-vars";
import { cn, relativeTime } from "@/lib/utils";

type Template = {
  id: string;
  name: string;
  bodyHtml: string;
  updatedAt: Date;
  updatedByName: string | null;
};

function preview(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** The shared library: pick one on the left, edit it on the right. */
export function TemplateLibrary({ templates }: { templates: Template[] }) {
  const [selected, setSelected] = useState<string | "new" | null>(templates[0]?.id ?? "new");
  const [filter, setFilter] = useState("");
  const shown = templates.filter(
    (t) =>
      !filter ||
      t.name.toLowerCase().includes(filter.toLowerCase()) ||
      preview(t.bodyHtml).toLowerCase().includes(filter.toLowerCase()),
  );
  const current = templates.find((t) => t.id === selected) ?? null;

  return (
    <div className="grid min-h-0 flex-1 md:grid-cols-[280px_1fr]">
      <aside className="flex min-h-0 flex-col border-b border-[var(--border)] md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 p-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter templates"
              className="h-8 pl-8 text-sm"
            />
          </div>
          <Button size="sm" variant="outline" onClick={() => setSelected("new")} title="New template">
            <Plus />
          </Button>
        </div>
        <ul className="max-h-60 overflow-y-auto px-2 pb-2 md:max-h-none md:flex-1">
          {shown.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setSelected(t.id)}
                className={cn(
                  "block w-full rounded-md px-2.5 py-2 text-left hover:bg-[var(--accent)]",
                  selected === t.id && "bg-[var(--accent)]",
                )}
              >
                <span className="block truncate text-sm font-medium">{t.name}</span>
                <span className="block truncate text-xs text-[var(--muted-foreground)]">
                  {preview(t.bodyHtml)}
                </span>
              </button>
            </li>
          ))}
          {templates.length === 0 && (
            <li className="px-2.5 py-4 text-xs text-[var(--muted-foreground)]">
              No templates yet. Create the first one.
            </li>
          )}
        </ul>
      </aside>

      <section className="min-h-0 overflow-y-auto">
        {selected === "new" || current ? (
          <TemplateEditor
            // Remount per template so the editor starts from its content.
            key={current?.id ?? "new"}
            template={current}
            onSaved={(id) => setSelected(id)}
            onDeleted={() => setSelected(templates.find((t) => t.id !== current?.id)?.id ?? "new")}
          />
        ) : (
          <div className="grid h-full place-items-center p-10 text-sm text-[var(--muted-foreground)]">
            <span className="flex items-center gap-2">
              <FileText className="size-4" /> Pick a template
            </span>
          </div>
        )}
      </section>
    </div>
  );
}

function TemplateEditor({
  template,
  onSaved,
  onDeleted,
}: {
  template: Template | null;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [body, setBody] = useState<RichValue>({
    html: template?.bodyHtml ?? "",
    text: "",
    empty: !template,
  });
  const [status, setStatus] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const editorRef = useRef<Editor | null>(null);

  function save() {
    start(async () => {
      const r = await saveTemplate({ id: template?.id, name, bodyHtml: body.html });
      setStatus(r.error ? { text: r.error, bad: true } : { text: r.ok ?? "Saved" });
      if (r.id && !template) onSaved(r.id);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="mx-auto w-full max-w-3xl space-y-3 p-4 sm:p-6"
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Template name, e.g. Password reset steps"
        aria-label="Template name"
        className="h-10 text-base font-medium"
        autoFocus={!template}
      />

      <div>
        <p className="mb-1.5 text-xs text-[var(--muted-foreground)]">
          Click to insert a variable. Add a fallback with a bar, e.g.{" "}
          <code className="rounded bg-[var(--muted)] px-1">{"{{first_name|there}}"}</code>.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_VARIABLES.map((v) => (
            <button
              key={v.key}
              type="button"
              title={v.label}
              onClick={() => editorRef.current?.chain().focus().insertContent(`{{${v.key}}}`).run()}
              className="rounded-md border border-[var(--border)] bg-[var(--muted)] px-2 py-0.5 font-mono text-xs hover:bg-[var(--accent)]"
            >
              {`{{${v.key}}}`}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--input)] bg-[var(--card)] shadow-sm focus-within:ring-2 focus-within:ring-[var(--ring)]">
        <RichEditor
          placeholder="Hi {{first_name|there}}, …"
          initialHtml={template?.bodyHtml}
          editorRef={editorRef}
          onChange={setBody}
          onSubmit={save}
          onEscape={() => {}}
          autoFocusKey={0}
          resetKey={0}
          className="[&_.rich-editor]:min-h-60"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || !name.trim() || body.empty}>
          {pending ? "Saving…" : template ? "Save" : "Create template"}
        </Button>
        {template && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Delete “${template.name}” for everyone?`)) return;
              start(async () => {
                await deleteTemplate(template.id);
                onDeleted();
              });
            }}
          >
            <Trash2 /> Delete
          </Button>
        )}
        {status && (
          <span className={cn("text-xs", status.bad ? "text-[var(--destructive)]" : "text-[var(--muted-foreground)]")}>
            {status.text}
          </span>
        )}
        {template && (
          <span className="ml-auto text-xs text-[var(--muted-foreground)]">
            Edited {relativeTime(template.updatedAt)}
            {template.updatedByName ? ` by ${template.updatedByName}` : ""}
          </span>
        )}
      </div>
    </form>
  );
}
