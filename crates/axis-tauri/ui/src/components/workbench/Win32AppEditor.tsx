import { useEffect, useRef, useMemo, useState, type ReactNode } from "react";
import { updateWin32App } from "../../lib/tauri";
import { requestObjectRefresh } from "../../lib/inspectorCache";
import { useInspectorDirty } from "../../lib/inspectorDrafts";
import { useReadOnly } from "../../lib/readOnly";
import {
  DETECTION_OPERATORS,
  FILE_DETECTION_TYPES,
  REGISTRY_DETECTION_TYPES,
  WIN32_ARCHITECTURES,
  WIN32_MIN_WINDOWS_RELEASES,
  detectionNeedsValue,
  draftFromWin32Object,
  draftsEqualWin32,
  emptyDetectionRule,
  summarizeDetectionRule,
  toUpdateWin32Input,
  type Win32AppDraft,
  type Win32DetectionRule,
} from "../../lib/win32App";
import { ScriptCodeEditor } from "../ui/ScriptCodeEditor";
import { TenantAppIcon } from "./TenantAppIcon";
import { BooleanToggle } from "./BooleanToggle";
import { useInspectorSaveAction } from "./inspectorSave";

export function Field({
  label,
  wide,
  invalid,
  children,
}: {
  label: string;
  wide?: boolean;
  invalid?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={invalid ? "device-field is-incomplete" : "device-field"} style={wide ? { gridColumn: "1 / -1" } : undefined}>
      {label}
      {children}
    </label>
  );
}

function withCurrent(options: Array<{ value: string; label: string }>, current: string) {
  if (!current || options.some((option) => option.value === current)) return options;
  return [{ value: current, label: current }, ...options];
}

export function Pane({
  title,
  hint,
  defaultOpen,
  invalid,
  children,
}: {
  title: string;
  hint: string;
  defaultOpen?: boolean;
  invalid?: boolean;
  children: ReactNode;
}) {
  const seeded = useRef(false);
  return (
    <details
      className="axis-panel win32-pane"
      ref={(node) => {
        if (node && defaultOpen && !seeded.current) {
          node.open = true;
          seeded.current = true;
        }
      }}
    >
      <summary>
        <span className="win32-pane-title">{title}</span>
        {invalid ? <span className="win32-pane-missing">Missing</span> : null}
        <span className="win32-pane-hint">{hint}</span>
      </summary>
      <div className="win32-pane-body">{children}</div>
    </details>
  );
}

export function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="device-field win32-toggle-row">
      <BooleanToggle checked={checked} disabled={disabled} ariaLabel={label} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

export function SelectOptions({
  options,
  current,
}: {
  options: Array<{ value: string; label: string }>;
  current: string;
}) {
  return withCurrent(options, current).map((option) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  ));
}

export function Win32AppEditor({
  appId,
  object,
  children,
}: {
  appId: string;
  object: Record<string, unknown> | null;
  children?: ReactNode;
}) {
  const readOnly = useReadOnly();
  const baseline = useMemo(() => draftFromWin32Object(object), [object]);
  const [draft, setDraft] = useState<Win32AppDraft>(baseline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(baseline);
    setError(null);
    setMessage(null);
  }, [baseline]);

  const dirty = !draftsEqualWin32(draft, baseline);
  useInspectorDirty(`win32-app:${appId}`, dirty);

  const architectures = withCurrent(
    WIN32_ARCHITECTURES.map((value) => ({ value, label: value })),
    draft.allowedArchitectures,
  );
  const releases = withCurrent(WIN32_MIN_WINDOWS_RELEASES, draft.minimumSupportedWindowsRelease);

  function patch(next: Partial<Win32AppDraft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  function updateRule(index: number, next: Win32DetectionRule) {
    setDraft((current) => ({
      ...current,
      detectionRules: current.detectionRules.map((rule, ruleIndex) =>
        ruleIndex === index ? next : rule,
      ),
    }));
  }

  async function save() {
    if (!dirty) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await updateWin32App(
        toUpdateWin32Input(appId, draft, draft.iconValue !== baseline.iconValue),
      );
      if (!response.ok) {
        setError(response.error ?? "Could not update the Win32 app.");
        return;
      }
      setMessage("Saved Win32 app to Graph.");
      requestObjectRefresh(appId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the Win32 app.");
    } finally {
      setBusy(false);
    }
  }

  useInspectorSaveAction({
    onSave: () => void save(),
    disabled: busy || !dirty || readOnly,
    busy,
    label: dirty ? "Save app" : undefined,
  });

  const disabled = readOnly || busy;
  const requirementBits = [
    draft.minimumFreeDiskSpaceInMB ? `${draft.minimumFreeDiskSpaceInMB} MB disk` : "",
    draft.minimumMemoryInMB ? `${draft.minimumMemoryInMB} MB memory` : "",
    draft.minimumNumberOfProcessors ? `${draft.minimumNumberOfProcessors} processors` : "",
    draft.minimumCpuSpeedInMHz ? `${draft.minimumCpuSpeedInMHz} MHz` : "",
  ].filter(Boolean);

  return (
    <div className="win32-panes">
      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      {message ? <div className="axis-alert axis-alert-info">{message}</div> : null}

      <Pane title="Identity" hint={draft.displayName || "Untitled"} defaultOpen>
        <div className="win32-grid">
          <div className="device-field" style={{ gridColumn: "1 / -1" }}>
            <span>Icon</span>
            <TenantAppIcon
              mimeType={draft.iconType}
              value={draft.iconValue}
              disabled={disabled}
              onChange={(icon) => patch(icon)}
              onError={setError}
            />
          </div>
          <Field label="Display name">
            <input
              className="axis-input"
              value={draft.displayName}
              disabled={disabled}
              onChange={(event) => patch({ displayName: event.target.value })}
            />
          </Field>
          <Field label="Publisher">
            <input
              className="axis-input"
              value={draft.publisher}
              disabled={disabled}
              onChange={(event) => patch({ publisher: event.target.value })}
            />
          </Field>
          <Field label="Display version">
            <input
              className="axis-input"
              value={draft.displayVersion}
              disabled={disabled}
              onChange={(event) => patch({ displayVersion: event.target.value })}
            />
          </Field>
          <Field label="Owner">
            <input
              className="axis-input"
              value={draft.owner}
              disabled={disabled}
              onChange={(event) => patch({ owner: event.target.value })}
            />
          </Field>
          <Field label="Architecture">
            <select
              className="axis-input"
              value={draft.allowedArchitectures}
              disabled={disabled}
              onChange={(event) => patch({ allowedArchitectures: event.target.value })}
            >
              {architectures.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Minimum Windows release">
            <select
              className="axis-input"
              value={draft.minimumSupportedWindowsRelease}
              disabled={disabled}
              onChange={(event) => patch({ minimumSupportedWindowsRelease: event.target.value })}
            >
              {releases.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Description" wide>
            <textarea
              className="axis-input"
              rows={3}
              value={draft.description}
              disabled={disabled}
              onChange={(event) => patch({ description: event.target.value })}
            />
          </Field>
          <Field label="Notes" wide>
            <textarea
              className="axis-input"
              rows={2}
              value={draft.notes}
              disabled={disabled}
              onChange={(event) => patch({ notes: event.target.value })}
            />
          </Field>
        </div>
      </Pane>

      <Pane title="Install / uninstall" hint={draft.installCommandLine || "No install command"}>
        <div className="win32-grid">
          <Field label="Install command line" wide>
            <input
              className="axis-input"
              style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.8rem" }}
              value={draft.installCommandLine}
              disabled={disabled}
              onChange={(event) => patch({ installCommandLine: event.target.value })}
            />
          </Field>
          <Field label="Uninstall command line" wide>
            <input
              className="axis-input"
              style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.8rem" }}
              value={draft.uninstallCommandLine}
              disabled={disabled}
              onChange={(event) => patch({ uninstallCommandLine: event.target.value })}
            />
          </Field>
          <Field label="Install as">
            <select
              className="axis-input"
              value={draft.runAsAccount}
              disabled={disabled}
              onChange={(event) => patch({ runAsAccount: event.target.value })}
            >
              <SelectOptions
                current={draft.runAsAccount}
                options={[
                  { value: "system", label: "System" },
                  { value: "user", label: "User" },
                ]}
              />
            </select>
          </Field>
          <Field label="Device restart behavior">
            <select
              className="axis-input"
              value={draft.deviceRestartBehavior}
              disabled={disabled}
              onChange={(event) => patch({ deviceRestartBehavior: event.target.value })}
            >
              <SelectOptions
                current={draft.deviceRestartBehavior}
                options={[
                  { value: "allow", label: "Allow" },
                  { value: "basedOnReturnCode", label: "Based on return code" },
                  { value: "suppress", label: "Suppress" },
                  { value: "force", label: "Force" },
                ]}
              />
            </select>
          </Field>
          <Field label="Max run time (minutes)">
            <input
              className="axis-input"
              type="number"
              min={1}
              max={1440}
              value={draft.maxRunTimeInMinutes}
              disabled={disabled}
              onChange={(event) =>
                patch({ maxRunTimeInMinutes: Number(event.target.value) || 60 })
              }
            />
          </Field>
          <ToggleRow
            label="Allow available uninstall"
            checked={draft.allowAvailableUninstall}
            disabled={disabled}
            onChange={(allowAvailableUninstall) => patch({ allowAvailableUninstall })}
          />
        </div>
      </Pane>

      <Pane
        title="Requirements"
        hint={requirementBits.length ? requirementBits.join(" · ") : "None set"}
      >
        <div className="win32-grid">
          <Field label="Min free disk (MB)">
            <input
              className="axis-input"
              type="number"
              min={0}
              value={draft.minimumFreeDiskSpaceInMB}
              disabled={disabled}
              onChange={(event) => patch({ minimumFreeDiskSpaceInMB: event.target.value })}
            />
          </Field>
          <Field label="Min memory (MB)">
            <input
              className="axis-input"
              type="number"
              min={0}
              value={draft.minimumMemoryInMB}
              disabled={disabled}
              onChange={(event) => patch({ minimumMemoryInMB: event.target.value })}
            />
          </Field>
          <Field label="Min processors">
            <input
              className="axis-input"
              type="number"
              min={0}
              value={draft.minimumNumberOfProcessors}
              disabled={disabled}
              onChange={(event) => patch({ minimumNumberOfProcessors: event.target.value })}
            />
          </Field>
          <Field label="Min CPU speed (MHz)">
            <input
              className="axis-input"
              type="number"
              min={0}
              value={draft.minimumCpuSpeedInMHz}
              disabled={disabled}
              onChange={(event) => patch({ minimumCpuSpeedInMHz: event.target.value })}
            />
          </Field>
        </div>
      </Pane>

      <Pane
        title="Detection rules"
        hint={
          draft.detectionRules.length === 1
            ? summarizeDetectionRule(draft.detectionRules[0])
            : `${draft.detectionRules.length} rules`
        }
      >
        <div className="win32-rule-actions">
          {(
            [
              ["file", "File"],
              ["registry", "Registry"],
              ["msi", "MSI"],
              ["powershell", "PowerShell"],
            ] as const
          ).map(([type, label]) => (
            <button
              key={type}
              type="button"
              className="axis-btn"
              disabled={disabled}
              onClick={() =>
                patch({ detectionRules: [...draft.detectionRules, emptyDetectionRule(type)] })
              }
            >
              Add {label}
            </button>
          ))}
        </div>
        {draft.detectionRules.length === 0 ? (
          <p className="muted" style={{ margin: "0.75rem 0 0" }}>
            No detection rules. Add a file, registry, MSI, or PowerShell rule.
          </p>
        ) : (
          <ul className="win32-rule-list">
            {draft.detectionRules.map((rule, index) => (
              <li key={`${rule.type}-${index}`} className="win32-rule">
                <div className="win32-rule-head">
                  <span>{summarizeDetectionRule(rule)}</span>
                  <span className="win32-rule-actions">
                    <button
                      type="button"
                      className="axis-btn"
                      disabled={disabled || index === 0}
                      onClick={() => {
                        const next = [...draft.detectionRules];
                        const [item] = next.splice(index, 1);
                        next.splice(index - 1, 0, item);
                        patch({ detectionRules: next });
                      }}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="axis-btn"
                      disabled={disabled || index === draft.detectionRules.length - 1}
                      onClick={() => {
                        const next = [...draft.detectionRules];
                        const [item] = next.splice(index, 1);
                        next.splice(index + 1, 0, item);
                        patch({ detectionRules: next });
                      }}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      className="axis-btn"
                      disabled={disabled}
                      onClick={() =>
                        patch({
                          detectionRules: draft.detectionRules.filter(
                            (_, ruleIndex) => ruleIndex !== index,
                          ),
                        })
                      }
                    >
                      Remove
                    </button>
                  </span>
                </div>
                <DetectionRuleFields
                  rule={rule}
                  disabled={disabled}
                  onChange={(next) => updateRule(index, next)}
                />
              </li>
            ))}
          </ul>
        )}
      </Pane>
      {children}
    </div>
  );
}

export function DetectionRuleFields({
  rule,
  disabled,
  onChange,
  highlightMissing = false,
}: {
  rule: Win32DetectionRule;
  disabled: boolean;
  onChange: (next: Win32DetectionRule) => void;
  highlightMissing?: boolean;
}) {
  if (rule.type === "unknown") {
    return (
      <p className="muted" style={{ margin: "0.65rem 0 0" }}>
        This rule stays as Graph stored it. Remove it to drop it from the app.
      </p>
    );
  }

  if (rule.type === "file" || rule.type === "registry") {
    const types = rule.type === "file" ? FILE_DETECTION_TYPES : REGISTRY_DETECTION_TYPES;
    const showValue = detectionNeedsValue(rule.detectionType);
    return (
      <div className="win32-grid" style={{ marginTop: "0.65rem" }}>
        {rule.type === "file" ? (
          <>
            <Field label="Path" wide invalid={highlightMissing && rule.path.trim() === ""}>
              <input
                className="axis-input"
                value={rule.path}
                disabled={disabled}
                onChange={(event) => onChange({ ...rule, path: event.target.value })}
              />
            </Field>
            <Field label="File or folder" invalid={highlightMissing && rule.fileOrFolderName.trim() === ""}>
              <input
                className="axis-input"
                value={rule.fileOrFolderName}
                disabled={disabled}
                onChange={(event) => onChange({ ...rule, fileOrFolderName: event.target.value })}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Key path" wide invalid={highlightMissing && rule.keyPath.trim() === ""}>
              <input
                className="axis-input"
                value={rule.keyPath}
                disabled={disabled}
                onChange={(event) => onChange({ ...rule, keyPath: event.target.value })}
              />
            </Field>
            <Field label="Value name">
              <input
                className="axis-input"
                value={rule.valueName}
                disabled={disabled}
                onChange={(event) => onChange({ ...rule, valueName: event.target.value })}
              />
            </Field>
          </>
        )}
        <Field label="Detection method">
          <select
            className="axis-input"
            value={rule.detectionType}
            disabled={disabled}
            onChange={(event) => onChange({ ...rule, detectionType: event.target.value })}
          >
            <SelectOptions current={rule.detectionType} options={[...types]} />
          </select>
        </Field>
        {showValue ? (
          <>
            <Field label="Operator">
              <select
                className="axis-input"
                value={rule.operator}
                disabled={disabled}
                onChange={(event) => onChange({ ...rule, operator: event.target.value })}
              >
                <SelectOptions current={rule.operator} options={[...DETECTION_OPERATORS]} />
              </select>
            </Field>
            <Field label="Value" invalid={highlightMissing && rule.detectionValue.trim() === ""}>
              <input
                className="axis-input"
                value={rule.detectionValue}
                disabled={disabled}
                onChange={(event) => onChange({ ...rule, detectionValue: event.target.value })}
              />
            </Field>
          </>
        ) : null}
        <ToggleRow
          label="Associated with a 32-bit app on 64-bit clients"
          checked={rule.check32BitOn64System}
          disabled={disabled}
          onChange={(check32BitOn64System) => onChange({ ...rule, check32BitOn64System })}
        />
      </div>
    );
  }

  if (rule.type === "msi") {
    return (
      <div className="win32-grid" style={{ marginTop: "0.65rem" }}>
        <Field label="Product code" wide invalid={highlightMissing && rule.productCode.trim() === ""}>
          <input
            className="axis-input"
            style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.8rem" }}
            value={rule.productCode}
            disabled={disabled}
            onChange={(event) => onChange({ ...rule, productCode: event.target.value })}
          />
        </Field>
        <Field
          label="Product version"
          invalid={
            highlightMissing &&
            rule.productVersionOperator.trim() !== "" &&
            rule.productVersionOperator.toLowerCase() !== "notconfigured" &&
            rule.productVersion.trim() === ""
          }
        >
          <input
            className="axis-input"
            value={rule.productVersion}
            disabled={disabled}
            onChange={(event) => onChange({ ...rule, productVersion: event.target.value })}
          />
        </Field>
        <Field label="Version operator">
          <select
            className="axis-input"
            value={rule.productVersionOperator}
            disabled={disabled}
            onChange={(event) => onChange({ ...rule, productVersionOperator: event.target.value })}
          >
            <SelectOptions
              current={rule.productVersionOperator}
              options={[...DETECTION_OPERATORS]}
            />
          </select>
        </Field>
      </div>
    );
  }

  return (
    <div className="stack" style={{ marginTop: "0.65rem", gap: "0.75rem" }}>
      <ScriptCodeEditor
        value={rule.scriptContent}
        onChange={(scriptContent) => onChange({ ...rule, scriptContent })}
        language="powershell"
        ariaLabel="Detection script"
        lintRole="detection"
        readOnly={disabled}
      />
      <div className="inspector-form-grid">
        <label className="inspector-form-row">
          <span>Enforce script signature check</span>
          <BooleanToggle
            checked={rule.enforceSignatureCheck}
            disabled={disabled}
            ariaLabel="Enforce script signature check"
            onChange={(enforceSignatureCheck) => onChange({ ...rule, enforceSignatureCheck })}
          />
        </label>
        <label className="inspector-form-row">
          <span>Run script in 64-bit PowerShell</span>
          <BooleanToggle
            checked={!rule.runAs32Bit}
            disabled={disabled}
            ariaLabel="Run script in 64-bit PowerShell"
            onChange={(runAs64Bit) => onChange({ ...rule, runAs32Bit: !runAs64Bit })}
          />
        </label>
      </div>
    </div>
  );
}
