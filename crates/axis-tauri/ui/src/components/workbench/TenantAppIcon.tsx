import { useState } from "react";
import { fetchPublicAppIcon, pickAppIcon, readLocalAppIcon } from "../../lib/tauri";

export function TenantAppIcon({
  mimeType,
  value,
  disabled,
  onChange,
  onError,
}: {
  mimeType: string;
  value: string;
  disabled?: boolean;
  onChange?: (icon: { iconType: string; iconValue: string }) => void;
  onError?: (message: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const preview = value.trim() ? `data:${mimeType || "image/png"};base64,${value.trim()}` : "";
  const editable = Boolean(onChange);

  async function chooseFile() {
    if (!onChange) return;
    setBusy(true);
    try {
      const picked = await pickAppIcon();
      if (!picked) return;
      const icon = await readLocalAppIcon(picked);
      onChange({ iconType: icon.type || "image/png", iconValue: icon.value });
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function fetchUrl() {
    if (!onChange) return;
    const next = url.trim();
    if (!next) {
      onError?.("Enter an icon image URL first.");
      return;
    }
    setBusy(true);
    try {
      const icon = await fetchPublicAppIcon(next);
      onChange({ iconType: icon.type || "image/png", iconValue: icon.value });
      setUrl(icon.url ?? next);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-icon-row">
      <div className="app-icon-preview">
        {preview ? <img src={preview} alt="" /> : <span className="muted">No icon</span>}
      </div>
      {editable ? (
        <div className="app-icon-fields">
          <div className="app-icon-url">
            <button type="button" className="axis-btn" disabled={disabled || busy} onClick={() => void chooseFile()}>
              Local file
            </button>
            <input
              className="axis-input"
              value={url}
              disabled={disabled || busy}
              placeholder="https://example.com/icon.png"
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void fetchUrl();
                }
              }}
            />
            <button type="button" className="axis-btn" disabled={disabled || busy || !url.trim()} onClick={() => void fetchUrl()}>
              Fetch
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
