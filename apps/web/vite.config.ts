import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// Anything prefixed VITE_ is copied into the public JavaScript bundle.
// Fail the build if a variable name suggests a secret was exposed by mistake.
const FORBIDDEN = /(SECRET|SERVICE_ROLE|PRIVATE|PASSKEY|CONSUMER_KEY|CELCOM|DARAJA)/i;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  for (const key of Object.keys(env)) {
    if (FORBIDDEN.test(key)) {
      throw new Error(
        `Refusing to build: ${key} would be exposed in the browser bundle. ` +
          `Secrets belong in server functions, never in VITE_ variables.`,
      );
    }
  }
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    build: { sourcemap: false, target: "es2022" },
  };
});
