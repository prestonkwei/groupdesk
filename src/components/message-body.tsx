"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Email HTML is untrusted. It renders inside an iframe with a `sandbox`
 * attribute that grants nothing — no scripts, no forms, no same-origin — so
 * even a hostile payload can only draw pixels. Links open in a new tab via a
 * base target, since navigation inside the frame is blocked anyway.
 */
export function HtmlBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  const doc = `<!doctype html><html><head><base target="_blank">
<meta name="color-scheme" content="light">
<style>
  :root { color-scheme: light; }
  body { margin:0; padding:0; font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; color:#1a1a1a; background:#fff; word-break:break-word; }
  img, table { max-width:100% !important; height:auto; }
  blockquote { margin:0 0 0 .5rem; padding-left:.75rem; border-left:2px solid #ddd; color:#555; }
  pre { white-space:pre-wrap; }
</style></head><body>${html}</body></html>`;

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    // Without same-origin we cannot measure the document, so grow to a
    // generous cap and let the frame scroll past it.
    const timer = setTimeout(() => setHeight(600), 50);
    return () => clearTimeout(timer);
  }, [html]);

  return (
    <iframe
      ref={ref}
      sandbox=""
      srcDoc={doc}
      title="Message body"
      className="w-full rounded-md border border-[var(--border)] bg-white"
      style={{ height }}
    />
  );
}

export function TextBody({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {text}
    </div>
  );
}
