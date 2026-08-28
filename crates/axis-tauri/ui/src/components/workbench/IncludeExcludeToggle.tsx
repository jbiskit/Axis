type Mode = "include" | "exclude";

export function IncludeExcludeToggle({
  value,
  onChange,
  disabled,
  includeLabel = "Include",
  excludeLabel = "Exclude",
  ariaLabel = "Include or exclude",
}: {
  value?: Mode | null;
  onChange: (value: Mode) => void;
  disabled?: boolean;
  includeLabel?: string;
  excludeLabel?: string;
  ariaLabel?: string;
}) {
  return (
    <span className="axis-seg" role="group" aria-label={ariaLabel}>
      <button
        type="button"
        className={`axis-seg-btn axis-seg-include${value === "include" ? " is-active" : ""}`}
        aria-pressed={value === "include"}
        disabled={disabled}
        onClick={() => onChange("include")}
      >
        {includeLabel}
      </button>
      <button
        type="button"
        className={`axis-seg-btn axis-seg-exclude${value === "exclude" ? " is-active" : ""}`}
        aria-pressed={value === "exclude"}
        disabled={disabled}
        onClick={() => onChange("exclude")}
      >
        {excludeLabel}
      </button>
    </span>
  );
}
