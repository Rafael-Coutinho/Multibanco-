import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  // Substituir pelo project ref do dashboard do Trigger.dev (Settings → Project ref).
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_REPLACE_ME",
  dirs: ["./trigger"],
  // A tarefa de lembretes chega a esperar 5 dias entre passos. Os waits > 5s são
  // checkpointed pelo Trigger.dev, mas damos margem generosa ao maxDuration de cada
  // segmento de execução (o tempo de espera não conta para este limite).
  maxDuration: 3600,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 5000,
      maxTimeoutInMs: 30000,
      randomize: true,
    },
  },
});
