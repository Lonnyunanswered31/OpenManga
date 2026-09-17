/** Narration languages offered in the UI; any BCP-47-like code is accepted. */
export const NARRATION_LANGUAGES: { code: string; name: string }[] = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "pt", name: "Portuguese" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese (Mandarin)" },
  { code: "hi", name: "Hindi" },
  { code: "id", name: "Indonesian" },
  { code: "vi", name: "Vietnamese" },
  { code: "th", name: "Thai" },
  { code: "tr", name: "Turkish" },
  { code: "ru", name: "Russian" },
  { code: "ar", name: "Arabic" },
  { code: "pl", name: "Polish" },
  { code: "nl", name: "Dutch" },
];

export const languageName = (code: string) =>
  NARRATION_LANGUAGES.find((l) => l.code === code.toLowerCase().split("-")[0])?.name ?? code;

/** Whether a voice's language tag (e.g. "en-us", "ja", "multilingual") suits a narration language. */
export const voiceMatchesLanguage = (voiceLanguage: string, code: string) => {
  const v = voiceLanguage.toLowerCase();
  return v === "multilingual" || v === "" || v.split(/[-_]/)[0] === code.toLowerCase().split("-")[0];
};
