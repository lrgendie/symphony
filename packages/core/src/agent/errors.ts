/**
 * Agent hata tipi. `error.name` = PROTOKOL.md §2 kod uzayından bir kod
 * (AGENT_*, PERMISSION_*, VALIDATION_*...); daemon'ın toErrorPayload'ı
 * kodu name'den okur — bu sözleşme bozulursa istemciye INTERNAL_ERROR gider.
 */
export class AgentError extends Error {
  constructor(
    code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = code;
  }
}
