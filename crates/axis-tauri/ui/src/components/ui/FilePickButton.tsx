import { useRef } from "react";

/** An `axis-btn` that opens the browser file picker; the native "Choose Files" control stays hidden. */
export function FilePickButton({
  label,
  accept,
  multiple = true,
  onFiles,
}: {
  label: string;
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void | Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="axis-btn" onClick={() => input.current?.click()}>
        {label}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(event) => {
          const target = event.target;
          // Clear after reading so picking the same file again still fires onChange.
          void Promise.resolve(onFiles(Array.from(target.files ?? []))).finally(() => (target.value = ""));
        }}
      />
    </>
  );
}
