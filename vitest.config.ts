import { defineConfig } from "vitest/config";

// A raiz testa a interface e os scripts dela; servico/ e pacotes/ rodam os próprios testes.
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
  },
});
