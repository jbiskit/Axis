export type UpdateCheck = {
  currentVersion: string;
  available: boolean;
  downloaded: boolean;
  version: string | null;
  notes: string | null;
};

export type UpdateDownloadProgress = {
  downloaded: number;
  total: number | null;
};
