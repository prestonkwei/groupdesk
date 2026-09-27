/** Added automatically to new tickets from faculty; see lib/vip.ts. */
export const VIP_TAG = { name: "VIP", slug: "vip", color: "amber" } as const;

export function isVipTag(tag: { slug: string }) {
  return tag.slug === VIP_TAG.slug;
}
