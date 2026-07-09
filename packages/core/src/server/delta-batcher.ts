/**
 * Token-başına yayın amplifikasyonunu azaltır (rapor/fabelincelemeraporu.md §5.1):
 * `agent.delta`/`chat.delta` gibi yüksek-frekanslı olaylar her chunk'ta TÜM bağlı
 * istemcilere ayrı zarf göndermek yerine kısa bir pencerede (`intervalMs`) birikip
 * tek parça olarak yayınlanır. Anahtar (runId/sessionId) başına bağımsız tamponlanır.
 *
 * `flush(key)` akışın doğal bitiş noktalarında (tur sonu, hata, iptal) ÇAĞRILMALIDIR —
 * aksi hâlde biriken son parça kaybolur ya da `completed`/`failed` olayından SONRA gelip
 * istemcide sıra bozulur.
 */
export const DELTA_BATCH_MS = 40;

export class DeltaBatcher {
  private readonly buffers = new Map<string, string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly onFlush: (key: string, text: string) => void,
    private readonly intervalMs: number = DELTA_BATCH_MS,
  ) {}

  push(key: string, text: string): void {
    this.buffers.set(key, (this.buffers.get(key) ?? "") + text);
    if (this.timers.has(key)) return;
    const timer = setTimeout(() => this.flush(key), this.intervalMs);
    timer.unref(); // testte/daemon kapanışında süreci canlı tutmasın
    this.timers.set(key, timer);
  }

  /** Birikmiş metni HEMEN yayınlar; boşsa no-op. İdempotent (çift çağrı güvenli). */
  flush(key: string): void {
    const timer = this.timers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    const text = this.buffers.get(key);
    if (text === undefined) return;
    this.buffers.delete(key);
    if (text.length > 0) this.onFlush(key, text);
  }
}
