import { useEffect, useMemo, useState } from "react";
import {
  draftFromAutopilotObject,
  draftsEqualAutopilot,
  toUpdateAutopilotInput,
  type AutopilotProfileDraft,
} from "../../lib/autopilotProfile";
import { updateAutopilotProfile } from "../../lib/tauri";
import { requestObjectRefresh } from "../../lib/inspectorCache";
import { useInspectorDirty } from "../../lib/inspectorDrafts";
import { useReadOnly } from "../../lib/readOnly";
import { AutopilotProfileForm } from "./AutopilotProfileForm";
import { useInspectorSaveAction } from "./inspectorSave";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function AutopilotProfileEditor({
  profileId,
  object,
}: {
  profileId: string;
  object: Record<string, unknown> | null;
}) {
  const readOnly = useReadOnly();
  const baseline = useMemo(() => draftFromAutopilotObject(object), [object]);
  const [draft, setDraft] = useState<AutopilotProfileDraft>(baseline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(baseline);
    setError(null);
    setMessage(null);
  }, [baseline, profileId]);

  const dirty = !draftsEqualAutopilot(draft, baseline);
  useInspectorDirty(`autopilot-profile:${profileId}`, dirty);

  const odataType =
    (typeof object?.["@odata.type"] === "string" ? object["@odata.type"] : "") || "";

  async function save() {
    if (!object || !dirty || !odataType) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      // Keep locked join / deployment mode / device type from the live object.
      const lockedUsage =
        asRecord(object.outOfBoxExperienceSetting)?.deviceUsageType ??
        asRecord(object.outOfBoxExperienceSettings)?.deviceUsageType ??
        draft.deviceUsageType;
      const lockedDraft: AutopilotProfileDraft = {
        ...draft,
        joinKind: baseline.joinKind,
        deviceType: baseline.deviceType,
        deviceUsageType:
          typeof lockedUsage === "string" ? lockedUsage : baseline.deviceUsageType,
      };
      const response = await updateAutopilotProfile(
        toUpdateAutopilotInput(profileId, odataType, lockedDraft),
      );
      if (!response.ok) {
        setError(response.error ?? "Could not update the deployment profile.");
        return;
      }
      setMessage("Saved deployment profile to Graph.");
      requestObjectRefresh(profileId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the deployment profile.");
    } finally {
      setBusy(false);
    }
  }

  useInspectorSaveAction({
    onSave: () => void save(),
    disabled: busy || !dirty || readOnly || !odataType,
    busy,
    label: dirty ? "Save profile" : undefined,
  });

  return (
    <div className="stack" style={{ marginTop: "1rem", gap: "0.75rem" }}>
      <div>
        <h3 style={{ margin: "0 0 0.35rem", fontSize: "0.95rem" }}>Deployment profile</h3>
        <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
          Join type, deployment mode, and device type are fixed for existing profiles. Other
          settings can be changed and saved from the inspector header.
        </p>
      </div>
      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      {message ? <div className="axis-alert axis-alert-info">{message}</div> : null}
      <AutopilotProfileForm
        draft={draft}
        lockedJoinAndMode
        disabled={readOnly || busy}
        onChange={(patch) => {
          setDraft((current) => {
            const next = { ...current, ...patch };
            next.joinKind = current.joinKind;
            next.deviceUsageType = current.deviceUsageType;
            next.deviceType = current.deviceType;
            return next;
          });
        }}
      />
    </div>
  );
}
