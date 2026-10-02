export function graphLargeIcon(object: Record<string, unknown> | null): {
  iconType: string;
  iconValue: string;
} {
  const icon =
    object?.largeIcon && typeof object.largeIcon === "object"
      ? (object.largeIcon as Record<string, unknown>)
      : null;
  const mime = typeof icon?.type === "string" ? icon.type.trim() : "";
  const value = typeof icon?.value === "string" ? icon.value.trim() : "";
  return {
    iconType: mime || "image/png",
    iconValue: value,
  };
}
