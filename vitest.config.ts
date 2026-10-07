import { configDefaults, defineConfig } from "vitest/config";

// claude-module/ tests run under `claude plugin test claude-module`, not vitest.
export default defineConfig({ test: { exclude: [...configDefaults.exclude, "claude-module/**"] } });
