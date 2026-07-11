/**
 * Tekrarlayan hata teşhisi (ADR-018 Karar 1, Faz 8 Dilim D1) — SAF: SQLite'a dokunmaz, girdisi
 * daemon'un ÇOKTAN çektiği `topErrorCodesSince` satırlarıdır (ADR-016 Karar 5'in AYNI kaynağı
 * — "ikinci gerçek üretme" burada da geçerli). LLM'e "hangi hata önemli?" SORULMAZ; eşik
 * deterministiktir (ADR-016'nın rapor felsefesiyle aynı): bir hata kodu yalnız yeterince SIK
 * tekrarlanmışsa VE hâlâ açık/uygulanmış bir önerisi yoksa aday olur.
 */

export interface DetectInput {
  code: string;
  count: number;
}

/** Kanıt sayılan alt sınır: bundan az tekrar eden hata kodu aday OLMAZ. */
export const MIN_RECURRENCE = 3;

/**
 * `rows` (ör. `topErrorCodesSince` çıktısı) → aday listesi: `excluded` (hâlâ açık/uygulanmış
 * önerisi olan kodlar, `store.openOrAppliedErrorCodes()`) elenir, `count < minRecurrence`
 * elenir, kalan sayıya göre AZALAN sıralanır (en sık tekrarlayan önce).
 */
export function detectRecurring(
  rows: readonly DetectInput[],
  excluded: readonly string[],
  minRecurrence = MIN_RECURRENCE,
): DetectInput[] {
  const excludedSet = new Set(excluded);
  return rows
    .filter((row) => row.count >= minRecurrence && !excludedSet.has(row.code))
    .sort((a, b) => b.count - a.count);
}
