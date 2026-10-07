import type { CreateLapsPolicyInput } from "./tauri";

/** `1` backs the password up to Microsoft Entra ID, `2` to Active Directory. */
export type LapsBackupDirectory = 1 | 2;

export type LapsPolicyDraft = {
  displayName: string;
  backupDirectory: LapsBackupDirectory;
  passwordAgeDays: number;
  passwordLength: number;
  passphraseLength: number;
  passwordComplexity: number;
  managedAccountName: string;
  postAuthenticationActions: number;
  postAuthenticationResetDelay: number;
};

export const LAPS_BACKUP_OPTIONS: { value: LapsBackupDirectory; label: string; hint: string }[] = [
  {
    value: 1,
    label: "Microsoft Entra ID only",
    hint: "The password is backed up to Microsoft Entra ID and readable from the device recovery panel.",
  },
  {
    value: 2,
    label: "Active Directory only",
    hint: "The password is backed up to on-premises Active Directory. Requires hybrid-joined devices.",
  },
];

export const LAPS_COMPLEXITY_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Large letters" },
  { value: 2, label: "Large letters + small letters" },
  { value: 3, label: "Large letters + small letters + numbers" },
  { value: 4, label: "Large letters + small letters + numbers + special characters" },
  {
    value: 5,
    label: "Large letters + small letters + numbers + special characters (improved readability)",
  },
  { value: 6, label: "Passphrase (long words)" },
  { value: 7, label: "Passphrase (short words)" },
  { value: 8, label: "Passphrase (short words with unique prefixes)" },
];

export const LAPS_POST_AUTH_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Reset password" },
  { value: 3, label: "Reset password and sign out" },
  { value: 5, label: "Reset password and reboot" },
  { value: 11, label: "Reset password, sign out, and terminate remaining processes" },
];

export function defaultLapsPolicyDraft(): LapsPolicyDraft {
  return {
    displayName: "Windows LAPS",
    backupDirectory: 1,
    passwordAgeDays: 30,
    passwordLength: 14,
    passphraseLength: 6,
    passwordComplexity: 4,
    managedAccountName: "",
    postAuthenticationActions: 3,
    postAuthenticationResetDelay: 24,
  };
}

/** Complexity `6`–`8` produce a passphrase instead of a character password. */
export function lapsComplexityIsPassphrase(complexity: number): boolean {
  return complexity >= 6 && complexity <= 8;
}

export function lapsPolicyNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Policy name is required.";
  if (trimmed.length > 200) return "Policy name must be 200 characters or fewer.";
  return null;
}

export function lapsPasswordAgeProblem(days: number): string | null {
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return "Password age must be from 1 to 365 days.";
  }
  return null;
}

export function lapsPasswordLengthProblem(length: number): string | null {
  if (!Number.isInteger(length) || length < 8 || length > 64) {
    return "Password length must be from 8 to 64 characters.";
  }
  return null;
}

export function lapsPassphraseLengthProblem(length: number): string | null {
  if (!Number.isInteger(length) || length < 3 || length > 10) {
    return "Passphrase length must be from 3 to 10 words.";
  }
  return null;
}

export function lapsResetDelayProblem(hours: number): string | null {
  if (!Number.isInteger(hours) || hours < 0 || hours > 24) {
    return "Reset delay must be from 0 to 24 hours.";
  }
  return null;
}

export function lapsManagedAccountNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (trimmed.length > 20) {
    return "Managed account name must be 20 characters or fewer.";
  }
  return null;
}

export function toCreateLapsInput(draft: LapsPolicyDraft): CreateLapsPolicyInput {
  return {
    displayName: draft.displayName.trim(),
    description: null,
    backupDirectory: draft.backupDirectory,
    passwordAgeDays: draft.passwordAgeDays,
    passwordComplexity: draft.passwordComplexity,
    passwordLength: draft.passwordLength,
    passphraseLength: draft.passphraseLength,
    managedAccountName: draft.managedAccountName.trim() || null,
    postAuthenticationActions: draft.postAuthenticationActions,
    postAuthenticationResetDelay: draft.postAuthenticationResetDelay,
  };
}
