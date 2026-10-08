# Contribuindo com o Moductus

Obrigado pelo interesse. O Moductus está no meio de um pivô: de suíte de utilitários para sistema pessoal com agentes de IA. As regras abaixo valem para o produto novo.

## Antes de escrever código

**Proposta vai como issue primeiro**, usando o template [Proposta](.github/ISSUE_TEMPLATE/proposta.yml): área nova, agente novo, integração ou ferramenta. Leia antes os [princípios](docs/PRODUCT.md#2-princípios) e os [não-objetivos](docs/PRODUCT.md#não-objetivos) — eles existem para poupar o seu tempo.

O código .NET da suíte saiu da árvore na fase 1; ele fica na tag [`v0.4.0`](https://github.com/moductus/moductus/tree/v0.4.0). Funcionalidade nova vai para o produto novo.

## Regras não negociáveis

- **Regra de negócio mora no serviço, não na interface nem no prompt.** A interface e o agente chamam a mesma função da área; nada que importa depende de o modelo acertar uma conta ou um formato. Até a configuração nativa (dock, atalhos, autostart) passa pelo serviço, que valida e só então pede à casca para aplicar. A casca em Rust só fala com o Windows.
- **Ação externa sempre com aprovação.** Ferramenta com efeito fora do Moductus é declarada como `externo` e passa pelo cartão de aprovação. Sem exceção.
- **Nenhum valor visual literal fora de `src/tokens`.** Cor, tamanho, raio, sombra, fonte e duração vêm dos tokens de [DESIGN.md](docs/DESIGN.md); o `pnpm lint` reprova o resto (`scripts/lint-visual.mjs`). Componente não conhece o nome do tema. Se falta um token, o PR discute o token antes de usar um número solto.
- **Rede só para provedor e conexões ligadas pelo usuário.** Nenhuma telemetria, nenhum serviço de terceiros por padrão.
- **Segredo só no Gerenciador de Credenciais do Windows.** Chave e token nunca no banco, em arquivo de configuração, em variável persistente ou em log; o serviço pede à casca na hora do uso.
- **Dependência nova com justificativa no PR e no commit.** "Facilita" não é justificativa.
- **Um assunto por PR.**

## Contrato de interação

- `Esc` fecha painel, captura ou modal, sem confirmar nada.
- `Enter` executa a ação primária.
- O dock não rouba foco; o teclado só vai para ele quando um painel pede digitação.
- Animação curta: entrada até 140 ms, saída até 90 ms, nada acima de 200 ms.
- Estado vazio sempre explica o que fazer.
- Erro aparece no próprio painel, nunca em diálogo.
- Confirmação só em ação irreversível de verdade.
- Toda ação alcançável por teclado.

## Comandos

Como preparar e rodar o projeto está no [README](README.md#rodar-em-desenvolvimento). Antes de abrir um PR, rode da raiz o mesmo que o CI roda:

| O quê | Comando |
|---|---|
| Formatação (conferir) | `pnpm format:check` |
| Formatação (corrigir) | `pnpm format` |
| Lint (ESLint + lint visual) | `pnpm -r lint` |
| Tipos | `pnpm -r typecheck` |
| Testes (interface, serviço, contrato) | `pnpm -r test` |
| Build da interface e do serviço | `pnpm build` |
| Fumaça do serviço (o bundle sobe e fica pronto) | `pnpm --filter @moductus/servico fumaca` |
| Clippy (em `src-tauri`) | `cargo clippy --all-targets -- -D warnings` |
| Testes da casca (em `src-tauri`) | `cargo test` |
| Build da casca, sem instalador | `pnpm tauri build --no-bundle` |

Um teste só: `pnpm vitest run src/janelas/dock` na raiz, `pnpm --filter @moductus/servico exec vitest run config` no serviço, `cargo test appbar` na casca.

Mudou algo que depende do Windows de verdade (dock, foco, atalhos, tela cheia, acessibilidade)? Rode o roteiro correspondente do `scripts/verificar.ps1` contra o build de debug (`pnpm tauri build --debug --no-bundle`). **Os roteiros mexem no mouse e no teclado**: não use o PC enquanto rodam. A lista está no README.

## Testes

- **Regra de área e de agente:** teste no serviço, com Vitest. Provedor de modelo é sempre falso nos testes; nenhum teste chama rede.
- **Casca nativa:** `cargo test` no que der para separar da API do Windows; o resto, num roteiro do `verificar.ps1`.
- **Interface:** Vitest com `happy-dom` nos componentes, incluindo nome acessível em todo controle (`src/teste/acessibilidade.ts`). Fluxos na tela real (captura, troca de tema, teclado) ficam nos roteiros com UI Automation.
- **Orçamentos:** mudança que pesa em memória ou tempo de abertura mede de novo com `scripts/medir.ps1` no build de release e atualiza a [tabela do ARCHITECTURE.md](docs/ARCHITECTURE.md#medições-da-fase-1).

## Commits

- **Português do Brasil**, em [Conventional Commits](https://www.conventionalcommits.org/pt-br/), com escopo opcional: `feat(dock):`, `fix(captura):`, `feat(a11y):`, `perf:`, `docs(arquitetura):`, `ci:`, `chore:`.
- **O assunto diz o que a mudança entrega** a quem usa ou mantém, não o processo ("corrige review", "ajustes").
- **Uma tarefa por commit.** Correção encontrada depois vira commit novo, não reescrita de histórico já publicado.
- **O corpo explica o que foi feito e por quê**, justifica cada dependência nova e traz a evidência: o teste que cobre a mudança ou a medição com números.

## Idioma

Documentação, comentários e mensagens de commit em português do Brasil. Nomes no código também, como nos arquivos vizinhos; comentário curto, explicando o porquê.
