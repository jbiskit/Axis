import {
  createContext,
  useContext,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

const ReadOnlyContext = createContext<boolean>(false);

export const READ_ONLY_WRITE_HINT =
  "Read-only mode: creating, modifying, and deleting are disabled.";

export const SHELL_BANNER_DISMISS_KEYS = {
  scopeWarning: "axis:shell-banner:scope-warning",
  readonlyInfo: "axis:shell-banner:readonly-info",
} as const;

export function clearShellBannerDismissals() {
  sessionStorage.removeItem(SHELL_BANNER_DISMISS_KEYS.scopeWarning);
  sessionStorage.removeItem(SHELL_BANNER_DISMISS_KEYS.readonlyInfo);
}

export function ReadOnlyProvider({
  value,
  children,
}: {
  value: boolean;
  children: ReactNode;
}) {
  return <ReadOnlyContext.Provider value={value}>{children}</ReadOnlyContext.Provider>;
}

export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}

export function useWriteGate() {
  const readOnly = useReadOnly();
  return {
    readOnly,
    writeDisabled: readOnly,
    writeHint: READ_ONLY_WRITE_HINT,
  };
}

export function WriteActionButton({
  disabled,
  title,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { writeDisabled, writeHint } = useWriteGate();
  return (
    <button
      {...props}
      disabled={writeDisabled || disabled}
      title={writeDisabled ? writeHint : title}
    />
  );
}
