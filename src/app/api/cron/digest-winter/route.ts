// Same handler as /api/cron/digest, on the 00:00 Saturday UTC schedule that
// matches 4pm Friday in Pacific Standard Time (the other slot covers PDT).
// A separate path keeps vercel.json free of duplicate cron paths.
export { GET, POST } from "../digest/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
