/**
 * Autopilot Language (Region) values.
 * Display names and tags from Microsoft Learn — Available Language Packs for Windows.
 * Special Intune values: Operating system default (`os-default`), User select (empty).
 */

export type AutopilotLocaleOption = {
  /** Graph `locale` value. Empty string = User select. */
  value: string;
  label: string;
};

const SPECIAL: AutopilotLocaleOption[] = [
  { value: "os-default", label: "Operating system default" },
  { value: "", label: "User select" },
];

/** Full Windows language packs (primary Autopilot Language/Region list). */
const LANGUAGE_PACKS: AutopilotLocaleOption[] = [
  { value: "ar-SA", label: "Arabic (Saudi Arabia)" },
  { value: "eu-ES", label: "Basque (Basque)" },
  { value: "bg-BG", label: "Bulgarian (Bulgaria)" },
  { value: "ca-ES", label: "Catalan" },
  { value: "zh-CN", label: "Chinese (Simplified, China)" },
  { value: "zh-TW", label: "Chinese (Traditional, Taiwan)" },
  { value: "hr-HR", label: "Croatian (Croatia)" },
  { value: "cs-CZ", label: "Czech (Czech Republic)" },
  { value: "da-DK", label: "Danish (Denmark)" },
  { value: "nl-NL", label: "Dutch (Netherlands)" },
  { value: "en-US", label: "English (United States)" },
  { value: "en-GB", label: "English (United Kingdom)" },
  { value: "et-EE", label: "Estonian (Estonia)" },
  { value: "fi-FI", label: "Finnish (Finland)" },
  { value: "fr-CA", label: "French (Canada)" },
  { value: "fr-FR", label: "French (France)" },
  { value: "gl-ES", label: "Galician" },
  { value: "de-DE", label: "German (Germany)" },
  { value: "el-GR", label: "Greek (Greece)" },
  { value: "he-IL", label: "Hebrew (Israel)" },
  { value: "hu-HU", label: "Hungarian (Hungary)" },
  { value: "id-ID", label: "Indonesian (Indonesia)" },
  { value: "it-IT", label: "Italian (Italy)" },
  { value: "ja-JP", label: "Japanese (Japan)" },
  { value: "ko-KR", label: "Korean (Korea)" },
  { value: "lv-LV", label: "Latvian (Latvia)" },
  { value: "lt-LT", label: "Lithuanian (Lithuania)" },
  { value: "nb-NO", label: "Norwegian, Bokmål (Norway)" },
  { value: "pl-PL", label: "Polish (Poland)" },
  { value: "pt-BR", label: "Portuguese (Brazil)" },
  { value: "pt-PT", label: "Portuguese (Portugal)" },
  { value: "ro-RO", label: "Romanian (Romania)" },
  { value: "ru-RU", label: "Russian (Russia)" },
  { value: "sr-Latn-RS", label: "Serbian (Latin, Serbia)" },
  { value: "sk-SK", label: "Slovak (Slovakia)" },
  { value: "sl-SI", label: "Slovenian (Slovenia)" },
  { value: "es-MX", label: "Spanish (Mexico)" },
  { value: "es-ES", label: "Spanish (Spain)" },
  { value: "sv-SE", label: "Swedish (Sweden)" },
  { value: "th-TH", label: "Thai (Thailand)" },
  { value: "tr-TR", label: "Turkish (Türkiye)" },
  { value: "uk-UA", label: "Ukrainian (Ukraine)" },
  { value: "vi-VN", label: "Vietnamese" },
];

/** Additional Windows 11 LIP locales commonly offered in Language (Region) pickers. */
const LANGUAGE_INTERFACE_PACKS: AutopilotLocaleOption[] = [
  { value: "af-ZA", label: "Afrikaans (South Africa)" },
  { value: "sq-AL", label: "Albanian (Albania)" },
  { value: "am-ET", label: "Amharic (Ethiopia)" },
  { value: "hy-AM", label: "Armenian (Armenia)" },
  { value: "as-IN", label: "Assamese (India)" },
  { value: "az-Latn-AZ", label: "Azerbaijani (Latin)" },
  { value: "bn-IN", label: "Bangla (India)" },
  { value: "be-BY", label: "Belarusian" },
  { value: "bs-Latn-BA", label: "Bosnian (Latin)" },
  { value: "chr-CHER-US", label: "Cherokee" },
  { value: "fil-PH", label: "Filipino" },
  { value: "ka-GE", label: "Georgian (Georgia)" },
  { value: "gu-IN", label: "Gujarati (India)" },
  { value: "hi-IN", label: "Hindi (India)" },
  { value: "is-IS", label: "Icelandic (Iceland)" },
  { value: "ga-IE", label: "Irish (Ireland)" },
  { value: "kn-IN", label: "Kannada (India)" },
  { value: "kk-KZ", label: "Kazakh (Kazakhstan)" },
  { value: "km-KH", label: "Khmer (Cambodia)" },
  { value: "kok-IN", label: "Konkani (India)" },
  { value: "lo-LA", label: "Lao (Laos)" },
  { value: "lb-LU", label: "Luxembourgish (Luxembourg)" },
  { value: "mk-MK", label: "Macedonian (North Macedonia)" },
  { value: "ms-MY", label: "Malay (Malaysia)" },
  { value: "ml-IN", label: "Malayalam (India)" },
  { value: "mt-MT", label: "Maltese (Malta)" },
  { value: "mi-NZ", label: "Maori (New Zealand)" },
  { value: "mr-IN", label: "Marathi (India)" },
  { value: "ne-NP", label: "Nepali (Nepal)" },
  { value: "nn-NO", label: "Norwegian, Nynorsk (Norway)" },
  { value: "or-IN", label: "Odia (India)" },
  { value: "fa-IR", label: "Persian" },
  { value: "pa-IN", label: "Punjabi (India)" },
  { value: "quz-PE", label: "Quechua (Peru)" },
  { value: "gd-GB", label: "Scottish Gaelic" },
  { value: "sr-Cyrl-RS", label: "Serbian (Cyrillic, Serbia)" },
  { value: "sr-Cyrl-BA", label: "Serbian (Cyrillic, Bosnia and Herzegovina)" },
  { value: "ta-IN", label: "Tamil (India)" },
  { value: "tt-RU", label: "Tatar (Russia)" },
  { value: "te-IN", label: "Telugu (India)" },
  { value: "ur-PK", label: "Urdu" },
  { value: "ug-CN", label: "Uyghur" },
  { value: "uz-Latn-UZ", label: "Uzbek (Latin)" },
  { value: "ca-ES-valencia", label: "Valencian" },
  { value: "cy-GB", label: "Welsh (United Kingdom)" },
];

function dedupeByValue(options: AutopilotLocaleOption[]): AutopilotLocaleOption[] {
  const seen = new Set<string>();
  const out: AutopilotLocaleOption[] = [];
  for (const option of options) {
    const key = option.value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(option);
  }
  return out;
}

const PACKS_SORTED = dedupeByValue([...LANGUAGE_PACKS, ...LANGUAGE_INTERFACE_PACKS]).sort((a, b) =>
  a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
);

/** Options for Autopilot Language (Region), specials first then A–Z packs. */
export const AUTOPILOT_LOCALE_OPTIONS: AutopilotLocaleOption[] = [...SPECIAL, ...PACKS_SORTED];

export function normalizeAutopilotLocale(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (lower === "os-default" || lower === "osdefault") return "os-default";
  return trimmed;
}

export function autopilotLocaleLabel(value: string | null | undefined): string {
  const normalized = normalizeAutopilotLocale(value);
  const hit = AUTOPILOT_LOCALE_OPTIONS.find(
    (option) => option.value.toLowerCase() === normalized.toLowerCase(),
  );
  if (hit) return hit.label;
  if (!normalized) return "User select";
  return normalized;
}

export function filterAutopilotLocales(
  query: string,
  limit = 40,
): AutopilotLocaleOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return AUTOPILOT_LOCALE_OPTIONS.slice(0, limit);
  const matches = AUTOPILOT_LOCALE_OPTIONS.filter((option) => {
    const label = option.label.toLowerCase();
    const tag = option.value.toLowerCase();
    return label.includes(q) || tag.includes(q) || (!option.value && "user select".includes(q));
  });
  return matches.slice(0, limit);
}
