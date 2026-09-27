"use client";

import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type PickerItem = {
  value: string;
  label: string;
  /** Extra words to match on, e.g. an email address. */
  keywords?: string[];
  icon?: React.ReactNode;
  hint?: string;
};

/**
 * Searchable dropdown: type to filter, arrows to move, Enter to pick.
 * Controlled `open` lets keyboard shortcuts open it from anywhere.
 */
export function Picker({
  open,
  onOpenChange,
  trigger,
  items,
  selected,
  onSelect,
  placeholder,
  multi = false,
  emptyText = "No matches",
  align = "start",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  items: PickerItem[];
  selected: string[];
  onSelect: (value: string) => void;
  placeholder: string;
  multi?: boolean;
  emptyText?: string;
  align?: "start" | "end";
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-64 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <Command loop className="flex flex-col">
            <Command.Input
              autoFocus
              placeholder={placeholder}
              className="h-10 w-full border-b border-[var(--border)] bg-transparent px-3 text-sm outline-none placeholder:text-[var(--muted-foreground)]"
            />
            <Command.List className="max-h-72 overflow-y-auto p-1">
              <Command.Empty className="px-3 py-6 text-center text-sm text-[var(--muted-foreground)]">
                {emptyText}
              </Command.Empty>
              {items.map((item) => {
                const on = selected.includes(item.value);
                return (
                  <Command.Item
                    key={item.value}
                    value={`${item.label} ${item.value}`}
                    keywords={item.keywords}
                    onSelect={() => {
                      onSelect(item.value);
                      if (!multi) onOpenChange(false);
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm data-[selected=true]:bg-[var(--accent)]"
                  >
                    {multi && (
                      <span
                        className={cn(
                          "grid size-4 shrink-0 place-items-center rounded border",
                          on
                            ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                            : "border-[var(--input)]",
                        )}
                      >
                        {on && <Check className="size-3" />}
                      </span>
                    )}
                    {item.icon}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint && (
                      <span className="shrink-0 text-xs text-[var(--muted-foreground)]">{item.hint}</span>
                    )}
                    {!multi && on && <Check className="size-4 shrink-0 text-[var(--muted-foreground)]" />}
                  </Command.Item>
                );
              })}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
