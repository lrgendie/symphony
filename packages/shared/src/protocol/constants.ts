/** Protokol sürümü — alan silme/yeniden adlandırma bu sayıyı artırır (PROTOKOL.md §7). */
export const PROTOCOL_VERSION = 1;

/** Daemon'un varsayılan portu; `~/.symphony/config.json` → `daemon.port` ile değişebilir. */
export const DEFAULT_DAEMON_PORT = 7770;

/** Daemon yalnızca loopback'e bind edilir (PROTOKOL.md §1). */
export const DAEMON_HOST = "127.0.0.1";
