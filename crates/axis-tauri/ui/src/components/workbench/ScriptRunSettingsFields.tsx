import { BooleanToggle } from "./BooleanToggle";

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
        <BooleanToggle
          checked={runAsUser}
          disabled={disabled}
          ariaLabel="Run this script using the logged-on credentials"
          onChange={onRunAsUserChange}
        />
      </label>
      {showSignature ? (
        <label className="inspector-form-row">
          <span>Enforce script signature check</span>
          <BooleanToggle
            checked={enforceSignatureCheck}
            disabled={disabled}
            ariaLabel="Enforce script signature check"
            onChange={onEnforceSignatureCheckChange}
          />
        </label>
      ) : null}
      {show64Bit ? (
        <label className="inspector-form-row">
          <span>Run script in 64-bit PowerShell</span>
          <BooleanToggle
            checked={runAs64Bit}
            disabled={disabled}
            ariaLabel="Run script in 64-bit PowerShell"
            onChange={onRunAs64BitChange}
          />
        </label>
      ) : null}
    </>
  );
}
