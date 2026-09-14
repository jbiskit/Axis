export function BooleanToggle({
  checked,
  onChange,
  disabled,
  ariaLabel,
  autoFocus,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`axis-toggle${checked ? " is-on" : ""}`}
      disabled={disabled}
      autoFocus={autoFocus}
      onClick={() => onChange(!checked)}
    >
      <span className="axis-toggle-thumb" aria-hidden />
    </button>
  );
}
