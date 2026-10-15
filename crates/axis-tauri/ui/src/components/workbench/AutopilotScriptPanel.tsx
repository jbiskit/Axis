import { useEffect, useMemo, useState } from "react";
import {
  autopilotScriptFileName,
  buildAutopilotScript,
  defaultAutopilotScriptOptions,
  type AutopilotScriptOptions,
} from "../../lib/autopilotScript";
import { saveTextFile, searchDirectoryGroups } from "../../lib/tauri";
import type { DirectoryGroup } from "../../types/inventory";
import { BooleanToggle } from "./BooleanToggle";

/** Autopilot group membership needs a static group — dynamic rules can't be written to. */
function isStaticGroup(group: DirectoryGroup): boolean {
  return group.membership !== "dynamic" && group.membership !== "dynamicDevice" && group.membership !== "dynamicUser";
}

export function AutopilotScriptPanel() {
  const [options, setOptions] = useState<AutopilotScriptOptions>(() =>
    defaultAutopilotScriptOptions(),
  );
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [groupQuery, setGroupQuery] = useState("");
  const [groupHits, setGroupHits] = useState<DirectoryGroup[]>([]);
  const [groupSearching, setGroupSearching] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  useEffect(() => {
    const query = groupQuery.trim();
    if (query.length < 2) {
      setGroupHits([]);
      setGroupError(null);
      setGroupSearching(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setGroupSearching(true);
      setGroupError(null);
      void searchDirectoryGroups(query)
        .then((response) => {
          if (cancelled) return;
          setGroupHits(response.groups.filter(isStaticGroup));
          setGroupError(response.error);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setGroupHits([]);
          setGroupError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setGroupSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [groupQuery]);

  const script = useMemo(() => buildAutopilotScript(options), [options]);
  const fileName = autopilotScriptFileName(options);

  function patch(next: Partial<AutopilotScriptOptions>) {
    setOptions((current) => ({ ...current, ...next }));
    setSavedPath(null);
    setCopied(false);
  }

  async function save() {
    setError(null);
    try {
      const path = await saveTextFile({
        contents: script,
        suggestedName: fileName,
        title: "Save Autopilot enrolment script",
      });
      if (path) setSavedPath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the script.");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Clipboard access was denied. Use Save instead.");
    }
  }

  return (
    <div className="stack" style={{ gap: "1rem" }}>
      <div className="axis-panel axis-panel-padded">
        <p className="axis-kicker">Actions</p>
        <div className="autopilot-actions" style={{ marginTop: "0.6rem" }}>
          <div className="autopilot-action">
            <BooleanToggle
              checked={options.registerOnline}
              ariaLabel="Register online or export only"
              onChange={(registerOnline) =>
                patch({
                  registerOnline,
                  // Assignment waiting only applies to an online registration.
                  assign: registerOnline ? options.assign : false,
                  reboot: registerOnline ? options.reboot : false,
                })
              }
            />
            <span className="autopilot-action-labels">
              <button
                type="button"
                className={`autopilot-action-label${options.registerOnline ? "" : " is-active"}`}
                aria-pressed={!options.registerOnline}
                onClick={() => patch({ registerOnline: false, assign: false, reboot: false })}
              >
                Export only
              </button>
              <span className="autopilot-action-sep" aria-hidden="true">
                or
              </span>
              <button
                type="button"
                className={`autopilot-action-label${options.registerOnline ? " is-active" : ""}`}
                aria-pressed={options.registerOnline}
                onClick={() =>
                  patch({
                    registerOnline: true,
                    assign: options.assign,
                    reboot: options.reboot,
                  })
                }
              >
                Register online
              </button>
            </span>
          </div>
          <p className="muted autopilot-action-hint">
            {options.registerOnline
              ? "The device registers itself with Intune during the run."
              : "The device only writes a CSV you import later."}
          </p>
        </div>

        {options.registerOnline ? (
          <div className="autopilot-subset">
            <div className="device-field">
              <label htmlFor="autopilot-group-search">Add to group</label>
              {options.groupName ? (
                <div className="autopilot-group-selected">
                  <span>{options.groupName}</span>
                  <button
                    type="button"
                    className="axis-btn-ghost"
                    onClick={() => {
                      patch({ groupName: "" });
                      setGroupQuery("");
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <input
                    id="autopilot-group-search"
                    className="axis-input"
                    value={groupQuery}
                    placeholder="Search static groups…"
                    onChange={(event) => setGroupQuery(event.target.value)}
                  />
                  {groupSearching ? <p className="muted">Searching…</p> : null}
                  {groupError ? (
                    <p className="muted" style={{ color: "var(--axis-danger)" }}>
                      {groupError}
                    </p>
                  ) : null}
                  {!groupSearching &&
                  !groupError &&
                  groupQuery.trim().length >= 2 &&
                  groupHits.length === 0 ? (
                    <p className="muted">No static groups matched.</p>
                  ) : null}
                  {groupHits.length > 0 ? (
                    <ul className="assignment-hits">
                      {groupHits.map((group) => (
                        <li key={group.id} className="assignment-hit">
                          <button
                            type="button"
                            className="assignment-hit-name assignment-hit-pick"
                            onClick={() => {
                              patch({ groupName: group.displayName });
                              setGroupQuery("");
                              setGroupHits([]);
                            }}
                          >
                            <span>{group.displayName}</span>
                            <span className="axis-pill">Assigned</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <span className="muted" style={{ fontSize: "var(--axis-text-2xs)" }}>
                    Optional. Passed to the collector as <code>-AddToGroup</code>, which resolves
                    the group by display name. Dynamic groups are excluded — membership cannot be
                    written to them.
                  </span>
                </>
              )}
            </div>

            <label className="device-field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexDirection: "row" }}>
              <BooleanToggle
                checked={options.assign}
                ariaLabel="Wait for the deployment profile to be assigned"
                onChange={(assign) => patch({ assign, reboot: assign ? options.reboot : false })}
              />
              <span>Wait for the deployment profile to be assigned</span>
            </label>
            {options.assign ? (
              <label className="device-field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexDirection: "row" }}>
                <BooleanToggle
                  checked={options.reboot}
                  ariaLabel="Restart once the profile is assigned"
                  onChange={(reboot) => patch({ reboot })}
                />
                <span>Restart once the profile is assigned</span>
              </label>
            ) : null}

            <label className="autopilot-action">
              <BooleanToggle
                checked={options.exportHash}
                ariaLabel="Export hardware hash"
                onChange={(exportHash) => patch({ exportHash })}
              />
              <span className="autopilot-action-labels">
                <span className="autopilot-action-label is-static">Export hardware hash</span>
              </span>
            </label>

            {options.exportHash ? (
              <label className="device-field">
                Destination
                <input
                  className="axis-input"
                  value={options.exportFileName}
                  placeholder="export.csv"
                  onChange={(event) => patch({ exportFileName: event.target.value })}
                />
                <span className="muted" style={{ fontSize: "var(--axis-text-2xs)" }}>
                  Optional. Written to <code>Export\</code> beside the script, resolved from{" "}
                  <code>$PSScriptRoot</code> at run time.
                </span>
              </label>
            ) : null}
          </div>
        ) : (
          <div className="autopilot-subset">
            <label className="device-field">
              Destination
              <input
                className="axis-input"
                value={options.exportFileName}
                placeholder="export.csv"
                onChange={(event) => patch({ exportFileName: event.target.value })}
              />
              <span className="muted" style={{ fontSize: "var(--axis-text-2xs)" }}>
                Optional. Written to <code>Export\</code> beside the script, resolved from{" "}
                <code>$PSScriptRoot</code> at run time.
              </span>
            </label>
          </div>
        )}

        <label className="device-field" style={{ marginTop: "0.85rem" }}>
          Group tag
          <input
            className="axis-input"
            value={options.groupTag}
            placeholder="e.g. Marketing-Laptops"
            onChange={(event) => patch({ groupTag: event.target.value })}
          />
          <span className="muted" style={{ fontSize: "var(--axis-text-2xs)" }}>
            Optional. Matches the tag a deployment profile targets.
          </span>
        </label>

        <div className="stack" style={{ gap: "0.5rem", marginTop: "0.85rem" }}>
          <label className="device-field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexDirection: "row" }}>
            <BooleanToggle
              checked={options.installCollector}
              ariaLabel="Install the hardware hash collector if missing"
              onChange={(installCollector) => patch({ installCollector })}
            />
            <span>Install the hardware hash collector if it is missing</span>
          </label>
        </div>
      </div>

      <div className="axis-panel axis-panel-padded">
        <div className="assignment-list-head">
          <p className="axis-kicker">Script</p>
          <div className="assignment-actions">
            <button type="button" className="axis-btn" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              className="axis-btn axis-btn-primary"
              onClick={() => void save()}
            >
              Save .ps1
            </button>
          </div>
        </div>
        {error ? (
          <p className="axis-alert axis-alert-danger" style={{ margin: "0.5rem 0" }}>
            {error}
          </p>
        ) : null}
        {savedPath ? (
          <p className="muted" style={{ margin: "0.5rem 0", fontSize: "var(--axis-text-2xs)" }}>
            Saved to {savedPath}
          </p>
        ) : null}
        <pre className="autopilot-script-preview">{script}</pre>
      </div>
    </div>
  );
}
