"use client";

import { useState, useTransition } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check } from "lucide-react";
import { saveTag } from "@/lib/actions/admin";
import { TAG_COLORS, tagColor } from "@/lib/tag-colors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TagBadge } from "@/components/ui/badge";
import { cn, slugify } from "@/lib/utils";

type Tag = { id?: string; name: string; slug: string; color: string };

/** Round swatch that opens the palette. */
function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={`Colour: ${tagColor(value).label}`}
          aria-label={`Colour: ${tagColor(value).label}`}
          className="grid size-9 shrink-0 place-items-center rounded-md border border-[var(--input)] hover:bg-[var(--accent)]"
        >
          <span className={cn("size-4 rounded-full", tagColor(value).dot)} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 grid grid-cols-5 gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 shadow-lg"
        >
          {TAG_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              title={c.label}
              aria-label={c.label}
              onClick={() => {
                onChange(c.value);
                setOpen(false);
              }}
              className="grid size-7 place-items-center rounded-md hover:bg-[var(--accent)]"
            >
              <span className={cn("grid size-5 place-items-center rounded-full text-white", c.dot)}>
                {c.value === value && <Check className="size-3" />}
              </span>
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * One editable tag: colour, name and slug. With no `tag.id` it creates a new
 * tag, and the slug follows the name until you edit it yourself.
 */
export function TagEditor({ tag, onDelete }: { tag?: Tag; onDelete?: React.ReactNode }) {
  const initial: Tag = tag ?? { name: "", slug: "", color: "blue" };
  const isNew = !tag?.id;
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [color, setColor] = useState(initial.color);
  const [status, setStatus] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, start] = useTransition();

  const effectiveSlug = slugTouched ? slug : slugify(name);
  const dirty =
    name !== initial.name || effectiveSlug !== initial.slug || color !== initial.color;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await saveTag({ id: tag?.id, name, slug: effectiveSlug, color });
      setStatus(r.error ? { text: r.error, bad: true } : { text: r.ok ?? "Saved" });
      if (r.ok && isNew) {
        setName("");
        setSlug("");
        setSlugTouched(false);
      }
    });
  }

  return (
    // Delete is its own <form>, so it sits beside this one rather than inside it.
    <div className="flex items-center gap-2 py-2">
    <form onSubmit={submit} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <ColorPicker value={color} onChange={setColor} />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Tag name, e.g. Chromebook"
        aria-label="Tag name"
        required
        className="w-48"
      />
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)]">
          ?tag=
        </span>
        <Input
          value={effectiveSlug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
          onBlur={() => setSlug(slugify(effectiveSlug))}
          placeholder="slug"
          aria-label="Tag slug"
          className="w-44 pl-12 font-mono text-xs"
        />
      </div>
      {name && <TagBadge name={name} color={color} />}
      <div className="ml-auto flex items-center gap-2">
        {status && (
          <span className={cn("text-xs", status.bad ? "text-[var(--destructive)]" : "text-[var(--muted-foreground)]")}>
            {status.text}
          </span>
        )}
        <Button type="submit" size="sm" variant={isNew ? "default" : "outline"} disabled={pending || !name.trim() || (!isNew && !dirty)}>
          {pending ? "Saving…" : isNew ? "Create tag" : "Save"}
        </Button>
      </div>
    </form>
    {onDelete}
    </div>
  );
}
