import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { tagColor } from "@/lib/tag-colors";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[var(--muted)] text-[var(--muted-foreground)]",
        outline: "border-[var(--border)] text-[var(--foreground)]",
        status:
          "border-transparent text-[var(--background)] [background-color:var(--status)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function TagBadge({ name, color }: { name: string; color: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tagColor(color).badge,
      )}
    >
      {name}
    </span>
  );
}

/** Marks a VIP requester (faculty, tagged automatically) next to their name. */
export function VipMark({ className }: { className?: string }) {
  return (
    <span title="VIP (faculty)" className={cn("inline-flex shrink-0 text-amber-500", className)}>
      <Crown className="size-3.5" aria-hidden />
      <span className="sr-only">VIP</span>
    </span>
  );
}

/** Ring for a VIP requester's avatar, to pair with VipMark. */
export const VIP_RING = "ring-2 ring-amber-400 ring-offset-1 ring-offset-[var(--background)]";

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="status" className={`status-${status} capitalize`}>
      {status}
    </Badge>
  );
}

/** Solid colour dot for a tag, e.g. in the sidebar. */
export function TagDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", tagColor(color).dot, className)}
    />
  );
}
