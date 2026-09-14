import type { ReactNode } from "react";

export function SettingDefaultCue({ show }: { show?: boolean }) {
  if (!show) return null;
  return <span className="axis-pill">Default</span>;
}

export function SettingValueWithDefaultCue({
  children,
  show,
}: {
  children: ReactNode;
  show?: boolean;
}) {
  return (
    <span className="setting-value-with-cue">
      {children}
      <SettingDefaultCue show={show} />
    </span>
  );
}
