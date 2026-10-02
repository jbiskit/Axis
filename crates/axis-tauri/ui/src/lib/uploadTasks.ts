import { listen } from "@tauri-apps/api/event";
import type { Win32UploadProgress } from "./tauri";

export type UploadTask = {
  id: string;
  label: string;
  status: "running" | "done" | "failed";
  percent: number;
  message: string;
  /** Zero-based index of this package inside a multi-package upload. */
  step: number;
  total: number;
};

let tasks: UploadTask[] = [];
const listeners = new Set<() => void>();
let listening = false;

function publish(next: UploadTask[]) {
  tasks = next;
  for (const listener of listeners) listener();
}

function ensureListening() {
  if (listening) return;
  listening = true;
  void listen<Win32UploadProgress>("axis-intunewin-upload-progress", (event) => {
    const index = tasks.findIndex((task) => task.status === "running");
    if (index < 0) return;
    const next = tasks.slice();
    const current = next[index];
    if (!current) return;
    next[index] = {
      ...current,
      percent: event.payload.percent,
      message: event.payload.message,
    };
    publish(next);
  });
}

export function subscribeUploadTasks(listener: () => void) {
  listeners.add(listener);
  ensureListening();
  return () => {
    listeners.delete(listener);
  };
}

export function getUploadTasks() {
  return tasks;
}

export function trackUpload(input: { label: string; step: number; total: number }): string {
  ensureListening();
  const task: UploadTask = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: input.label,
    status: "running",
    percent: 0,
    message: "Starting…",
    step: input.step,
    total: Math.max(input.total, 1),
  };
  publish([task, ...tasks].slice(0, 24));
  return task.id;
}

export function finishUpload(id: string, result: { ok: boolean; message: string }) {
  publish(
    tasks.map((task) =>
      task.id === id
        ? {
            ...task,
            status: result.ok ? "done" : "failed",
            percent: result.ok ? 100 : task.percent,
            message: result.message,
          }
        : task,
    ),
  );
}

export function dismissFinishedUploads() {
  publish(tasks.filter((task) => task.status === "running"));
}

export function overallUploadPercent(items: UploadTask[]): number | null {
  const running = items.filter((task) => task.status === "running");
  if (running.length === 0) return null;
  const total = running.reduce((sum, task) => {
    const span = Math.max(task.total, 1);
    return sum + ((task.step + Math.min(task.percent, 100) / 100) / span) * 100;
  }, 0);
  return Math.min(100, Math.round(total / running.length));
}
