"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

/**
 * Email HTML is untrusted, so it renders in a sandboxed iframe with scripts
 * disabled. `allow-same-origin` (without `allow-scripts`) is safe on its own:
 * nothing in the email can run, and it lets us measure the document so the
 * frame fits its content instead of scrolling inside a fixed box.
 */
export function HtmlBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);
  const [hasQuote, setHasQuote] = useState(false);
  const [showQuote, setShowQuote] = useState(false);

  const doc = `<!doctype html><html><head><base target="_blank">
<meta name="color-scheme" content="light">
<style>
  :root { color-scheme: light; }
  html, body { margin:0; padding:0; overflow:hidden; }
  body { font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; color:#1f2328; background:transparent; word-break:break-word; }
  p { margin:0 0 .75em; }
  body > *:last-child, p:last-child { margin-bottom:0; }
  a { color:#2554a4; }
  .mention { color:#2554a4; font-weight:500; }
  img, table { max-width:100% !important; height:auto; }
  blockquote { margin:0 0 0 .25rem; padding-left:.75rem; border-left:2px solid #d0d7de; color:#57606a; }
  pre { white-space:pre-wrap; }
  body:not(.show-quote) .gmail_quote,
  body:not(.show-quote) .gmail_quote_container,
  body:not(.show-quote) blockquote[type="cite"],
  body:not(.show-quote) #appendonsend ~ *,
  body:not(.show-quote) .yahoo_quoted { display:none !important; }
</style></head><body>${html}</body></html>`;

  const measure = useCallback(() => {
    const body = ref.current?.contentDocument?.body;
    if (body) setHeight(Math.ceil(body.scrollHeight) + 2);
  }, []);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    let observer: ResizeObserver | undefined;

    function onLoad() {
      const d = iframe!.contentDocument;
      if (!d?.body) return;
      setHasQuote(
        !!d.querySelector(".gmail_quote, .gmail_quote_container, blockquote[type='cite'], #appendonsend, .yahoo_quoted"),
      );
      measure();
      observer = new ResizeObserver(measure);
      observer.observe(d.body);
      // Images load after the document; each one can change the height.
      d.querySelectorAll("img").forEach((img) => img.addEventListener("load", measure));
    }

    iframe.addEventListener("load", onLoad);
    if (iframe.contentDocument?.readyState === "complete") onLoad();
    return () => {
      iframe.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [html, measure]);

  useEffect(() => {
    const body = ref.current?.contentDocument?.body;
    body?.classList.toggle("show-quote", showQuote);
    measure();
  }, [showQuote, measure]);

  return (
    <div>
      <iframe
        ref={ref}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={doc}
        title="Message body"
        className="block w-full border-0"
        style={{ height }}
      />
      {hasQuote && <QuoteToggle open={showQuote} onClick={() => setShowQuote((s) => !s)} />}
    </div>
  );
}

/** Splits plain text at the first quoted-reply marker ("On … wrote:" or "> "). */
export function splitQuote(text: string): [string, string | null] {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex(
    (l, i) =>
      /^On .{5,200}wrote:\s*$/.test(l.trim()) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(l.trim()) ||
      (l.startsWith(">") && lines.slice(i).every((x) => !x.trim() || x.startsWith(">"))),
  );
  if (at <= 0) return [text, null];
  return [lines.slice(0, at).join("\n").trimEnd(), lines.slice(at).join("\n")];
}

export function TextBody({ text }: { text: string }) {
  const [main, quote] = splitQuote(text);
  const [showQuote, setShowQuote] = useState(false);
  return (
    <div className="text-[15px] leading-relaxed">
      <div className="whitespace-pre-wrap break-words">{main}</div>
      {quote && (
        <>
          <QuoteToggle open={showQuote} onClick={() => setShowQuote((s) => !s)} />
          {showQuote && (
            <div className="mt-2 whitespace-pre-wrap break-words border-l-2 border-[var(--border)] pl-3 text-[var(--muted-foreground)]">
              {quote}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function QuoteToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={open ? "Hide quoted text" : "Show quoted text"}
      aria-expanded={open}
      className="mt-1 inline-flex h-4 items-center rounded-sm bg-[var(--muted)] px-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
    >
      <MoreHorizontal className="size-4" />
    </button>
  );
}
