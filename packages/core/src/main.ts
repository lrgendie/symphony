// symphonyd giriş noktası: `pnpm --filter @lrgendie/core dev`
import { PROTOCOL_VERSION } from "@lrgendie/shared";
import { startDaemon, DAEMON_VERSION } from "./server/daemon.js";

const daemon = await startDaemon().catch((error: unknown) => {
  if (error instanceof Error && error.name === "DAEMON_ALREADY_RUNNING") {
    console.error(`⚠️  ${error.message}`);
    process.exit(1);
  }
  throw error;
});
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
