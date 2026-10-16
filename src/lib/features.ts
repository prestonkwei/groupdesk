/**
 * Optional features, switched on per install with NEXT_PUBLIC_* variables so
 * the same value is seen by server and client code. NEXT_PUBLIC_ values are
 * baked in at build time: redeploy after changing one.
 */
const on = (v: string | undefined) => /^(1|true|on|yes)$/i.test(v?.trim() ?? "");

/**
 * Date detector: dates in emails become chips with calendar availability,
 * free-slot suggestions, add-to-calendar and requester confirmations, plus
 * the Calendar dropdown in the sidebar. Needs the Google OAuth client used
 * for Gmail; each agent connects their own calendar from the account menu.
 */
export const DATE_DETECTOR = on(process.env.NEXT_PUBLIC_DATE_DETECTOR);
