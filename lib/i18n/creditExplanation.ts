/**
 * The sentence that says what a credit is — ONE copy, in three languages.
 *
 * Credit deduction slice 6 (D-b, D-h). Three surfaces show it: the dashboard
 * card's tooltip and the plan screen read it through `LanguageContext`
 * (`usage.explain.monthly` / `usage.explain.trial`), and the public invite page,
 * which renders in the INVITE's language and so cannot use the viewer's
 * dictionary, reads it through `invitePageCopy.ts`. Both point here, so the
 * wording cannot drift between them.
 *
 * `monthly` for a plan whose allowance resets each month, `trial` for a one-off
 * total. The variant is chosen from the allowance's SHAPE, never from a plan
 * name. No figure belongs in this text: the numbers are read from config.
 *
 * Client-safe: plain data, imports nothing.
 */

export const CREDIT_EXPLANATION = {
  en: {
    monthly:
      'Credits measure the work Business OS does for you. Each task uses credits according to what it actually took to run, and your plan includes a fixed amount every month.',
    trial:
      'Credits measure the work Business OS does for you. Each task uses credits according to what it actually took to run, and your trial includes a fixed amount in total.',
  },
  he: {
    monthly:
      'קרדיטים מודדים את העבודה ש־Business OS עושה בשבילך. כל משימה משתמשת בקרדיטים לפי מה שנדרש בפועל כדי לבצע אותה, והתוכנית שלך כוללת כמות קבועה בכל חודש.',
    trial:
      'קרדיטים מודדים את העבודה ש־Business OS עושה בשבילך. כל משימה משתמשת בקרדיטים לפי מה שנדרש בפועל כדי לבצע אותה, ותקופת הניסיון שלך כוללת כמות קבועה בסך הכול.',
  },
  es: {
    monthly:
      'Los créditos miden el trabajo que Business OS hace por ti. Cada tarea usa créditos según lo que realmente requirió realizarla, y tu plan incluye una cantidad fija cada mes.',
    trial:
      'Los créditos miden el trabajo que Business OS hace por ti. Cada tarea usa créditos según lo que realmente requirió realizarla, y tu prueba incluye una cantidad fija en total.',
  },
} as const;
