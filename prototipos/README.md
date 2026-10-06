# Protótipos dos testes de viabilidade

Código descartável dos testes da fase 0. Não é o produto: serve de referência para a fase 1 e para repetir as medições. Os resultados estão em [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md#9-testes-de-viabilidade) e em [docs/AGENTS.md](../docs/AGENTS.md#51-resultado-do-teste-de-viabilidade).

Os caminhos dentro dos scripts apontam para `C:/Desenvolvimento/moductus-testes`, onde os testes rodaram. Ajuste antes de repetir.

| Pasta | O que testa | Como rodar |
|---|---|---|
| `dock/` | Dock em Tauri 2: AppBar na borda esquerda, sem roubar foco, some em tela cheia, limpeza de reserva órfã | `pnpm install` e `pnpm tauri build --debug --no-bundle`; depois `verificar.ps1` mede área de trabalho, foco, tela cheia e memória |
| `hooks/` | Aprovação do Claude Code por hooks `http` | `servidor.mjs` simula o dock (permite comandos com "permitido", nega o resto); `settings.json` liga os hooks; `rodar-interativo.ps1` abre uma sessão interativa |
| `servico/` | Serviço em Node e em Bun com SQLite e HTTP | `node node-servico.mjs` ou `bun build --compile bun-servico.ts` |
| `nativo/` | Mídia tocando e janelas abertas pelo Rust | `cargo run` |

Requisitos: Rust estável com MSVC, Node 22+, pnpm, WebView2 e, para `hooks/`, o Claude Code autenticado.
