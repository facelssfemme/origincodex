// UI recovery only. This data never proves payment or authorizes fulfillment.
export const QUIZ_DRAFT_KEY = "syrena_quiz_draft_v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const steps = ["name", "belonging", "intensity", "nightSky", "dreams", "recharge", "empathy", "soulAge", "birthdate", "email", "reading", "reveal"] as const;
export type Step = typeof steps[number];
const traits = ["belonging", "intensity", "nightSky", "dreams", "recharge", "empathy", "soulAge"] as const;
export interface FormState {
  name: string; birthMonth: string; birthDay: string; birthYear: string; email: string;
  belonging: number | null; intensity: number | null; nightSky: number | null;
  dreams: number | null; recharge: number | null; empathy: number | null; soulAge: number | null;
}
export interface QuizDraft { step: Step; form: FormState; addShadowOrigin: boolean }
export function completeForm(form: FormState): boolean {
  return Boolean(form.name.trim()) && traits.every(key => form[key] !== null)
    && /^\d{1,2}$/.test(form.birthMonth) && Number(form.birthMonth) >= 1 && Number(form.birthMonth) <= 12
    && /^\d{1,2}$/.test(form.birthDay) && Number(form.birthDay) >= 1 && Number(form.birthDay) <= 31;
}
export function readQuizDraft(storage: Pick<Storage, "getItem">, now = Date.now()): QuizDraft | null {
  try {
    const value = JSON.parse(storage.getItem(QUIZ_DRAFT_KEY) || "null");
    if (!value || value.version !== 1 || !Number.isFinite(value.savedAt) || value.savedAt > now || now - value.savedAt >= MAX_AGE_MS) return null;
    if (!steps.includes(value.step) || typeof value.addShadowOrigin !== "boolean" || !value.form) return null;
    const form = value.form;
    for (const key of ["name", "birthMonth", "birthDay", "birthYear", "email"]) {
      if (typeof form[key] !== "string" || form[key].length > 1000) return null;
    }
    for (const key of traits) if (form[key] !== null && (!Number.isInteger(form[key]) || form[key] < 0 || form[key] > 2)) return null;
    if (["reading", "reveal"].includes(value.step) && !completeForm(form)) return null;
    // Recompute the result with the existing scorer; never persist/trust a result.
    return { step: value.step === "reading" ? "reveal" : value.step, form, addShadowOrigin: value.addShadowOrigin };
  } catch { return null; }
}
export function writeQuizDraft(storage: Pick<Storage, "setItem">, draft: QuizDraft, now = Date.now()): boolean {
  try {
    storage.setItem(QUIZ_DRAFT_KEY, JSON.stringify({ version: 1, savedAt: now, ...draft }));
    return true;
  } catch { return false; }
}
