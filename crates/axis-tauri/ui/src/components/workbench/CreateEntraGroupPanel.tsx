import { useId, useMemo, useState } from "react";
import { createDirectoryGroup } from "../../lib/tauri";
import type { CreateGroupMembership, DirectoryGroup } from "../../types/inventory";

const USER_RULE = '(user.department -eq "Finance")';
const DEVICE_RULE = '(device.deviceOSType -eq "Windows")';

const RULE_EXAMPLES = [
  { label: "Windows devices", rule: '(device.deviceOSType -eq "Windows")', kind: "dynamicDevice" as const },
  {
    label: "Autopilot devices",
    rule: '(device.devicePhysicalIDs -any (_ -contains "[ZTDID]"))',
    kind: "dynamicDevice" as const,
  },
  { label: "Users by department", rule: '(user.department -eq "Finance")', kind: "dynamicUser" as const },
] as const;

function templateFor(membership: CreateGroupMembership): string {
  if (membership === "dynamicUser") return USER_RULE;
  if (membership === "dynamicDevice") return DEVICE_RULE;
  return "";
}

export function CreateEntraGroupPanel({
  onCreated,
  successHint,
  namePlaceholder = "e.g. Contoso — Policy pilots",
  disabled = false,
}: {
  onCreated: (group: DirectoryGroup) => void;
  successHint?: string;
  namePlaceholder?: string;
  disabled?: boolean;
}) {
  const radioName = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [membership, setMembership] = useState<CreateGroupMembership>("assigned");
  const [rule, setRule] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<DirectoryGroup | null>(null);

  const examples = useMemo(
    () => RULE_EXAMPLES.filter((example) => example.kind === membership),
    [membership],
  );

  const setMembershipKind = (next: CreateGroupMembership) => {
    setMembership(next);
    const current = rule.trim();
    if (next === "assigned") {
      setRule("");
      return;
    }
    if (!current || current === USER_RULE || current === DEVICE_RULE) {
      setRule(templateFor(next));
    }
  };

  const createGroup = async () => {
    if (disabled) return;
    setError(null);
    setCreating(true);
    try {
      const response = await createDirectoryGroup({
        displayName: name,
        description,
        membership,
        membershipRule: membership === "assigned" ? undefined : rule,
      });
      if (!response.group) {
        setError(response.error ?? "Failed to create group.");
        return;
      }
      setCreated(response.group);
      setName("");
      setDescription("");
      setRule("");
      setMembership("assigned");
      onCreated(response.group);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create group.");
    } finally {
      setCreating(false);
    }
  };

  const canCreate =
    !disabled &&
    !creating &&
    Boolean(name.trim()) &&
    (membership === "assigned" || Boolean(rule.trim()));

  return (
    <div className="create-group-panel">
      <button
        type="button"
        className="create-group-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        disabled={disabled}
      >
        <span>Create Entra group</span>
        <span className="muted">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="create-group-body">
          <label className="device-field">
            Display name
            <input
              className="axis-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={namePlaceholder}
              disabled={disabled || creating}
            />
          </label>
          <label className="device-field">
            Description (optional)
            <input
              className="axis-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={disabled || creating}
            />
          </label>
          <fieldset className="create-group-membership" disabled={disabled || creating}>
            <legend>Membership</legend>
            <label>
              <input
                type="radio"
                name={radioName}
                checked={membership === "assigned"}
                onChange={() => setMembershipKind("assigned")}
              />
              Assigned
            </label>
            <label>
              <input
                type="radio"
                name={radioName}
                checked={membership === "dynamicUser"}
                onChange={() => setMembershipKind("dynamicUser")}
              />
              Dynamic user
            </label>
            <label>
              <input
                type="radio"
                name={radioName}
                checked={membership === "dynamicDevice"}
                onChange={() => setMembershipKind("dynamicDevice")}
              />
              Dynamic device
            </label>
          </fieldset>
          {membership !== "assigned" ? (
            <div className="create-group-rule">
              <label className="device-field">
                Membership rule
                <textarea
                  className="axis-input create-group-rule-input"
                  value={rule}
                  onChange={(event) => setRule(event.target.value)}
                  placeholder={templateFor(membership)}
                  disabled={disabled || creating}
                />
              </label>
              <div className="create-group-examples">
                {examples.map((example) => (
                  <button
                    key={example.label}
                    type="button"
                    className="axis-btn axis-btn-ghost"
                    onClick={() => setRule(example.rule)}
                    disabled={disabled || creating}
                  >
                    {example.label}
                  </button>
                ))}
              </div>
              <p className="muted" style={{ margin: 0, fontSize: "0.6875rem" }}>
                {membership === "dynamicDevice"
                  ? "Uses a device.* rule. Dynamic groups need Entra ID P1 (or higher)."
                  : "Uses a user.* rule. Dynamic groups need Entra ID P1 (or higher)."}
              </p>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0, fontSize: "0.6875rem" }}>
              Creates an empty security group (mailEnabled false, securityEnabled true). Add members
              in Entra after if needed.
            </p>
          )}
          {error ? <p className="muted" style={{ color: "var(--axis-danger)", margin: 0 }}>{error}</p> : null}
          {created ? (
            <p className="muted" style={{ margin: 0 }}>
              Created <span style={{ color: "var(--axis-fg)" }}>{created.displayName}</span>
              {successHint ? <> {successHint}</> : null}
            </p>
          ) : null}
          <button
            type="button"
            className="axis-btn axis-btn-primary"
            disabled={!canCreate}
            onClick={() => void createGroup()}
          >
            {creating ? "Creating…" : "Create group"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
