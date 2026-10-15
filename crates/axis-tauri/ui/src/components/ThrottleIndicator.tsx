import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/** Matches `ThrottleNotice` in axis-sdk `graph.rs`. */
type ThrottleNotice = {
  status: number;
  path: string;
  attempt: number;
  maxAttempts: number;
  waitMs: number;
};

type Waiting = { path: string; until: number; attempt: number; maxAttempts: number };

/**
 * Title-bar pill shown while Graph is throttling and Axis is waiting to retry.
 * Retries happen in Rust; this only reports them, and hides once the last wait ends.
 */
export function ThrottleIndicator() {
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen<ThrottleNotice>("graph-throttle", (event) => {
      const notice = event.payload;
      const entry: Waiting = {
        path: notice.path,
        until: Date.now() + notice.waitMs,
        attempt: notice.attempt,
        maxAttempts: notice.maxAttempts,
      };
      setNow(Date.now());
      setWaiting((current) => [...current.filter((item) => item.until > Date.now()), entry]);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const active = waiting.filter((item) => item.until > now);

  useEffect(() => {
    if (active.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active.length]);

  if (active.length === 0) return null;
  const seconds = Math.max(1, Math.ceil((Math.max(...active.map((item) => item.until)) - now) / 1000));
  const worst = active.reduce((max, item) => (item.attempt > max.attempt ? item : max), active[0]);
  const detail = [
    `Microsoft Graph asked Axis to slow down. ${active.length} request${active.length === 1 ? " is" : "s are"} waiting to retry.`,
    `Highest retry so far: ${worst.attempt} of ${worst.maxAttempts}.`,
    ...Array.from(new Set(active.map((item) => item.path))).slice(0, 5),
  ].join("\n");

  return (
    <span className="throttle-indicator" role="status" title={detail}>
      Graph busy · retrying in {seconds}s
    </span>
  );
}
