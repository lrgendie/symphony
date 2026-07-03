// symphonyd giriş noktası: `pnpm --filter @symphony/core dev`
import { PROTOCOL_VERSION } from "@symphony/shared";
import { startDaemon, DAEMON_VERSION } from "./server/daemon.js";

const daemon = await startDaemon();
console.log(
  `🎼 symphonyd v${DAEMON_VERSION} — 127.0.0.1:${daemon.port} (protokol v${PROTOCOL_VERSION})`,
);
console.log(`   REST: http://127.0.0.1:${daemon.port}/api/health`);
console.log(`   WS:   ws://127.0.0.1:${daemon.port}/ws`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void daemon.close().then(() => process.exit(0));
  });
}
