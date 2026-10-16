"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useHoverPopover, type Anchor } from "./hover-popover";
import type { DateContext, IframeChip } from "./date-chips";
import { splitQuote } from "@/lib/message-text";

// The date parser and popover are only fetched when a body actually has a
// DateContext, i.e. when the date detector is on.
const loadChips = () => import("./date-chips");
type Chips = Awaited<ReturnType<typeof loadChips>>;

/** The chips module, once loaded; stays null while `enabled` is false. */
function useChips(enabled: boolean) {
  const [chips, setChips] = useState<Chips | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadChips().then((m) => {
      if (!cancelled) setChips(m);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return chips;
}

/**
 * Email HTML is untrusted, so it renders in a sandboxed iframe with scripts
 * disabled. `allow-same-origin` (without `allow-scripts`) is safe on its own:
 * nothing in the email can run, and it lets us measure the document so the
 * frame fits its content instead of scrolling inside a fixed box.
 */
export function HtmlBody({ html, dates }: { html: string; dates?: DateContext }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);
  const [hasQuote, setHasQuote] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  // Dates in the email get chips inside the frame; the popover renders out
  // here, anchored to the hovered line of the chip; the rect is derived from
  // the chips at render time (the frame never scrolls, so a chip's rect is
  // its offset within the frame).
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const hover = useHoverPopover();
  const { enter, leave, pin, close, dismiss, pinnedRef } = hover;
  // Tells this body's overlays from another body's when deciding what counts as an outside click.
  const overlayId = useId();
  // Dates found in the frame; their hit targets are overlays in this document.
  const [iframeChips, setIframeChips] = useState<IframeChip[]>([]);
  // Bumped whenever the frame re-flows, so the overlays re-measure.
  const [layout, setLayout] = useState(0);
  // A primitive, so a refreshed (but equal) Date doesn't re-annotate the frame.
  const sentTime = dates ? new Date(dates.sentAt).getTime() : NaN;
  const sentAtKey = Number.isNaN(sentTime) ? undefined : new Date(sentTime).toISOString();
  const chips = useChips(sentAtKey !== undefined);

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
  .date-chip { border-bottom:1px dashed #2554a4; color:#2554a4; border-radius:2px; }
  .date-chip.open { background:#e8effa; }
</style></head><body>${html}</body></html>`;

  const measure = useCallback(() => {
    const body = ref.current?.contentDocument?.body;
    if (body) setHeight(Math.ceil(body.scrollHeight) + 2);
    setLayout((n) => n + 1);
  }, []);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    let observer: ResizeObserver | undefined;
    let unannotate: (() => void) | undefined;
    let cancelled = false;

    function onLoad() {
      const d = iframe!.contentDocument;
      if (!d?.body) return;
      if (sentAtKey && chips) {
        const annotated = chips.annotateDocument(d, sentAtKey);
        unannotate = annotated.cleanup;
        setIframeChips(annotated.chips);
      }
      setHasQuote(
        !!d.querySelector(".gmail_quote, .gmail_quote_container, blockquote[type='cite'], #appendonsend, .yahoo_quoted"),
      );
      measure();
      observer = new ResizeObserver(measure);
      observer.observe(d.body);
      // A web font arriving late re-flows the text.
      d.fonts?.ready.then(() => {
        if (!cancelled) measure();
      });
      // Images load after the document; each one can change the height.
      d.querySelectorAll("img").forEach((img) => img.addEventListener("load", measure));
    }

    iframe.addEventListener("load", onLoad);
    if (iframe.contentDocument?.readyState === "complete") onLoad();
    return () => {
      cancelled = true;
      iframe.removeEventListener("load", onLoad);
      observer?.disconnect();
      unannotate?.();
      setIframeChips([]);
    };
  }, [html, measure, sentAtKey, chips]);

  // A narrower window re-wraps the email's lines, moving the chips.
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const overlayHandlers = useMemo(
    () => ({
      enter: (a: Anchor) => {
        // A pinned popover stays on its chip; only a click moves it.
        if (pinnedRef.current) return;
        setAnchor(a);
        enter();
      },
      leave,
      pin: (a: Anchor) => {
        setAnchor(a);
        pin();
      },
    }),
    [enter, leave, pin, pinnedRef],
  );

  // The frame re-flowed, so the chip may have moved or re-wrapped and the
  // mouse may no longer be over it (an overlay unmounting fires no mouseleave).
  useEffect(() => {
    dismiss();
  }, [layout, dismiss]);

  // The anchored chip is gone (new html, annotation re-run).
  useEffect(() => {
    if (anchor && !iframeChips.some((c) => c.id === anchor.id)) close();
  }, [anchor, iframeChips, close]);

  // Underline-highlight the chip whose popover is open.
  useEffect(() => {
    const d = ref.current?.contentDocument;
    if (d?.body && chips) chips.markOpenChip(d, hover.open && anchor ? anchor.id : null);
  }, [chips, hover.open, anchor]);

  useEffect(() => {
    const body = ref.current?.contentDocument?.body;
    body?.classList.toggle("show-quote", showQuote);
    measure();
  }, [showQuote, measure]);

  return (
    <div>
      <div className="relative">
        <iframe
          ref={ref}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={doc}
          title="Message body"
          className="block w-full border-0"
          style={{ height }}
        />
        {dates && chips && iframeChips.length > 0 && (
          <chips.IframeChipOverlays
            chips={iframeChips}
            layout={layout}
            overlayId={overlayId}
            handlers={overlayHandlers}
          />
        )}
        {dates && chips && (
          <chips.AnchoredDatePopover
            anchor={anchor}
            chips={iframeChips}
            layout={layout}
            overlayId={overlayId}
            context={dates}
            hover={hover}
          />
        )}
      </div>
      {hasQuote && <QuoteToggle open={showQuote} onClick={() => setShowQuote((s) => !s)} />}
    </div>
  );
}

export function TextBody({ text, dates }: { text: string; dates?: DateContext }) {
  const [main, quote] = splitQuote(text);
  const [showQuote, setShowQuote] = useState(false);
  const chips = useChips(!!dates);
  return (
    <div className="text-[15px] leading-relaxed">
      <div className="whitespace-pre-wrap break-words">
        {dates && chips ? <chips.TextWithDates text={main} context={dates} /> : main}
      </div>
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
