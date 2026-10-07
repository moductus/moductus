import { defineConfig } from "vitest/config";

// A raiz testa só a interface; servico/ e pacotes/ rodam os próprios testes.
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
