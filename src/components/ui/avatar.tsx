"use client";

import { useState } from "react";
import { cn, initials } from "@/lib/utils";

/** Stable, readable background for initials, picked from the person's email. */
const TINTS = [
  "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
  "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-200",
  "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
];

function tint(key: string) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

const SIZES = {
  xs: "size-5 text-[9px]",
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
} as const;

export function Avatar({
  name,
  email,
  photo,
  size = "sm",
  className,
}: {
  name?: string | null;
  email: string;
  photo?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const label = name || email;

  if (photo && !broken) {
    return (
      // Tiny avatars straight from Google: next/image would only add a hop.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photo}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={cn("shrink-0 rounded-full object-cover object-top", SIZES[size], className)}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold",
        SIZES[size],
        tint(email.toLowerCase()),
        className,
      )}
    >
      {initials(label)}
    </span>
  );
}

/** Avatar + name, the way a person appears anywhere in the portal. */
export function PersonChip({
  name,
  email,
  photo,
  size = "sm",
  className,
  showEmail = false,
}: {
  name?: string | null;
  email: string;
  photo?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
  showEmail?: boolean;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <Avatar name={name} email={email} photo={photo} size={size} />
      <span className="min-w-0 truncate">
        <span className="font-medium">{name || email}</span>
        {showEmail && name && (
          <span className="ml-1.5 text-[var(--muted-foreground)]">{email}</span>
        )}
      </span>
    </span>
  );
}
