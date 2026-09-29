/** A ticket with this tag shows a crown next to the requester's name. */
export const VIP_TAG = { name: "VIP", slug: "vip", color: "amber" } as const;

export function isVipTag(tag: { slug: string }) {
  return tag.slug === VIP_TAG.slug;
}
