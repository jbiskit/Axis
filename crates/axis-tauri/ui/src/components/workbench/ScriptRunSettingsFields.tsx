export function ScriptRunSettingsFields({
  runAsUser,
  onRunAsUserChange,
  enforceSignatureCheck,
  onEnforceSignatureCheckChange,
  runAs64Bit,
  onRunAs64BitChange,
  showSignature,
  show64Bit,
  disabled,
}: {
  runAsUser: boolean;
  onRunAsUserChange: (value: boolean) => void;
  enforceSignatureCheck: boolean;
  onEnforceSignatureCheckChange: (value: boolean) => void;
  runAs64Bit: boolean;
  onRunAs64BitChange: (value: boolean) => void;
  showSignature: boolean;
  show64Bit: boolean;
  disabled?: boolean;
}) {
  return (
    <>
      <label className="inspector-form-row">
        <span>Run this script using the logged-on credentials</span>
        <input
          type="checkbox"
          checked={runAsUser}
          disabled={disabled}
          onChange={(event) => onRunAsUserChange(event.target.checked)}
        />
      </label>
      {showSignature ? (
        <label className="inspector-form-row">
          <span>Enforce script signature check</span>
          <input
            type="checkbox"
            checked={enforceSignatureCheck}
            disabled={disabled}
            onChange={(event) => onEnforceSignatureCheckChange(event.target.checked)}
          />
        </label>
      ) : null}
      {show64Bit ? (
        <label className="inspector-form-row">
          <span>Run script in 64-bit PowerShell</span>
          <input
            type="checkbox"
            checked={runAs64Bit}
            disabled={disabled}
            onChange={(event) => onRunAs64BitChange(event.target.checked)}
          />
        </label>
      ) : null}
    </>
  );
}
