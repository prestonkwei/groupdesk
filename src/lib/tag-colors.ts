/**
 * Tag colour palette. Class names are spelled out in full so Tailwind can see
 * them; `dot` is the solid swatch used in the sidebar and colour picker.
 */
export const TAG_COLORS = [
  { value: "slate", label: "Gray", dot: "bg-slate-400", badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" },
  { value: "rose", label: "Red", dot: "bg-rose-500", badge: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-200" },
  { value: "orange", label: "Orange", dot: "bg-orange-500", badge: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200" },
  { value: "amber", label: "Yellow", dot: "bg-amber-400", badge: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  { value: "green", label: "Green", dot: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200" },
  { value: "teal", label: "Teal", dot: "bg-teal-500", badge: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200" },
  { value: "blue", label: "Blue", dot: "bg-blue-500", badge: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200" },
  { value: "indigo", label: "Indigo", dot: "bg-indigo-500", badge: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200" },
  { value: "violet", label: "Purple", dot: "bg-violet-500", badge: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-200" },
  { value: "pink", label: "Pink", dot: "bg-pink-500", badge: "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-200" },
] as const;

export type TagColor = (typeof TAG_COLORS)[number]["value"];

export function tagColor(value: string) {
  return TAG_COLORS.find((c) => c.value === value) ?? TAG_COLORS[0];
}

export function isTagColor(value: string): value is TagColor {
  return TAG_COLORS.some((c) => c.value === value);
}
