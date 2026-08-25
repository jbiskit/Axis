import { getCurrentWindow } from "@tauri-apps/api/window";
import { openPopoutWindow } from "./tauri";

export async function popOutObject(kind: string, id: string, title?: string): Promise<void> {
  await openPopoutWindow(kind, id, title);
}

export async function closeThisWindow(): Promise<void> {
  await getCurrentWindow().close();
}

export function isPopoutRoute(pathname: string): boolean {
  return pathname === "/popout";
}
