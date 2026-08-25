import { useCallback, useState, type MouseEvent } from "react";
import { openExternalUrl } from "../../lib/tauri";

function IntuneGlyph({ className }: { className?: string }) {
  return (
    <img
      src="/intune-icon.png"
      alt=""
      width={14}
      height={14}
      className={className}
      aria-hidden
      draggable={false}
    />
  );
}

function ClipboardGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden
    >
      <rect x="5" y="3.5" width="8" height="10" rx="1.2" />
      <path d="M5.5 5.5H4a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1h3.2a1 1 0 0 1 1 1v.2" />
      <path d="M7.5 7.5h4M7.5 10h4" strokeLinecap="round" />
    </svg>
  );
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* fall through to execCommand */
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(area);
  if (!ok) {
    throw new Error("Clipboard copy was blocked.");
  }
}

export function OpenInIntune({ href, label }: { href: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const destination = label ? `Open ${label} in Intune` : "Open in Intune";

  const onOpen = useCallback(
    async (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setError(null);
      try {
        await openExternalUrl(href);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not open the Intune portal.");
      }
    },
    [href],
  );

  const onCopy = useCallback(
    async (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setError(null);
      try {
        await copyText(href);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not copy the Intune URL.");
      }
    },
    [href],
  );

  return (
    <span
      className="device-actions"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="axis-btn axis-btn-icon"
        title={destination}
        aria-label={destination}
        onClick={(event) => void onOpen(event)}
      >
        <IntuneGlyph />
      </button>
      <button
        type="button"
        className="axis-btn axis-btn-icon"
        title={copied ? "Copied" : "Copy Intune URL"}
        aria-label={
          copied
            ? "Intune URL copied"
            : label
              ? `Copy Intune URL for ${label}`
              : "Copy Intune URL"
        }
        onClick={(event) => void onCopy(event)}
      >
        {copied ? <span className="axis-btn-icon-check">✓</span> : <ClipboardGlyph />}
      </button>
      {error ? (
        <span className="muted" role="alert" style={{ color: "var(--axis-danger)", fontSize: "0.6875rem", maxWidth: "14rem" }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
