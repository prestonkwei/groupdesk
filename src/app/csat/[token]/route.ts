import { recordCsat, surveyByToken, type CsatRating } from "@/lib/csat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * The requester-facing survey page. Requesters aren't agents, so this sits
 * outside Cloudflare Access (Bypass on /csat/*) and the token is the only
 * credential. It's one self-contained HTML page with inline styles, so it
 * needs nothing else from the app.
 *
 * Opening a link doesn't record anything by itself: mail scanners fetch every
 * link in an email, which would vote 👍 and 👎 at once. A tiny script posts
 * the rating once the page is open in a real browser; without scripts, the
 * form's buttons record it.
 */

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function asRating(v: unknown): CsatRating | null {
  return v === "good" || v === "bad" ? v : null;
}

function page(body: string, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>helpdesk feedback</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#f6f7f9;font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#1f2328}
  main{max-width:480px;margin:48px auto;padding:0 16px}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px 24px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  h1{font-size:22px;margin:0 0 6px}
  p{margin:0 0 16px;color:#4b5563}
  .muted{font-size:13px;color:#6b7280}
  .choices{display:flex;gap:10px;margin:0 0 18px}
  .choices input{position:absolute;opacity:0;pointer-events:none}
  .choices label{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;height:52px;border:1px solid #d1d5db;border-radius:10px;font-size:15px;cursor:pointer;background:#fff}
  .choices label span{font-size:24px;line-height:1}
  .choices input:checked+label{border-color:#2563eb;background:#eff6ff;box-shadow:0 0 0 1px #2563eb}
  .choices input:focus-visible+label{outline:2px solid #2563eb;outline-offset:2px}
  textarea{width:100%;min-height:110px;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font:inherit;resize:vertical}
  textarea:focus{outline:2px solid #2563eb;outline-offset:0;border-color:transparent}
  button{margin-top:12px;height:40px;padding:0 18px;border:0;border-radius:10px;background:#111827;color:#fff;font:inherit;font-size:15px;cursor:pointer}
  .ok{margin:0 0 16px;padding:10px 12px;border-radius:10px;background:#ecfdf5;color:#065f46;font-size:14px}
</style></head><body><main><div class="card">${body}</div>
<p class="muted" style="text-align:center;margin-top:16px">Support Team</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}

const NOT_FOUND = `<h1>Link not found</h1><p>This feedback link has expired or isn't valid. If you still need help, just reply to the email from helpdesk.</p>`;

function form(opts: {
  token: string;
  rating: CsatRating | null;
  number: number;
  subject: string;
  comment: string | null;
  sent?: boolean;
  autoRecord?: boolean;
}) {
  const action = `/csat/${encodeURIComponent(opts.token)}`;
  const radio = (r: CsatRating, emoji: string, label: string) =>
    `<input type="radio" name="r" id="r-${r}" value="${r}"${opts.rating === r ? " checked" : ""}>` +
    `<label for="r-${r}"><span>${emoji}</span>${label}</label>`;
  return `
<h1>Thanks for your feedback!</h1>
<p>About ticket #${opts.number}: ${esc(opts.subject)}</p>
${opts.sent ? `<div class="ok">Got it, thank you. Your comment went to the helpdesk.</div>` : ""}
<form method="post" action="${action}">
  <div class="choices">${radio("good", "👍", "Good")}${radio("bad", "👎", "Not good")}</div>
  <label for="comment" class="muted" style="display:block;margin-bottom:6px">Leave a comment if you'd like (optional)</label>
  <textarea id="comment" name="comment" maxlength="5000" placeholder="What went well, or what could we do better?">${esc(opts.comment ?? "")}</textarea>
  <button type="submit">${opts.sent ? "Update comment" : "Send comment"}</button>
</form>
<script>
(function(){
  var url=${JSON.stringify(action)};
  function save(r){var b=new URLSearchParams();b.set("r",r);b.set("quiet","1");fetch(url,{method:"POST",body:b});}
  ${opts.autoRecord && opts.rating ? `save(${JSON.stringify(opts.rating)});` : ""}
  document.querySelectorAll('input[name="r"]').forEach(function(el){el.addEventListener("change",function(){save(el.value);});});
})();
</script>`;
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const survey = await surveyByToken(token);
  if (!survey) return page(NOT_FOUND, 404);
  const clicked = asRating(new URL(req.url).searchParams.get("r"));
  return page(
    form({
      token,
      rating: clicked ?? asRating(survey.rating),
      number: survey.number,
      subject: survey.subject,
      comment: survey.comment,
      autoRecord: !!clicked,
    }),
  );
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const data = await req.formData().catch(() => null);
  const survey = await surveyByToken(token);
  if (!survey) return page(NOT_FOUND, 404);

  const rating = asRating(data?.get("r")) ?? asRating(survey.rating);
  const comment = String(data?.get("comment") ?? "");
  if (data?.get("quiet")) {
    if (rating) await recordCsat(token, rating);
    return new Response(null, { status: 204 });
  }
  if (!rating) {
    return page(
      form({ token, rating: null, number: survey.number, subject: survey.subject, comment }) +
        `<p class="muted" style="margin-top:12px">Pick 👍 or 👎 first.</p>`,
    );
  }
  await recordCsat(token, rating, comment);
  return page(
    form({ token, rating, number: survey.number, subject: survey.subject, comment, sent: !!comment.trim() }),
  );
}
