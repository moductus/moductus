# Contribuindo com o Moductus

Obrigado pelo interesse. O Moductus está no meio de um pivô: de suíte de utilitários para sistema pessoal com agentes de IA. As regras abaixo valem para o produto novo.

## Antes de escrever código

**Proposta vai como issue primeiro**, usando o template [Proposta](.github/ISSUE_TEMPLATE/proposta.yml): área nova, agente novo, integração ou ferramenta. Leia antes os [princípios](docs/PRODUCT.md#2-princípios) e os [não-objetivos](docs/PRODUCT.md#não-objetivos) — eles existem para poupar o seu tempo.

Enquanto a fase 1 não começa, o código no repositório é a suíte `v0.4.0` em .NET. Correções nela ainda são bem-vindas; funcionalidade nova vai para o produto novo.

## Regras não negociáveis

- **Regra de negócio mora na área, não no prompt.** O agente chama a mesma função que a interface chama; nada que importa depende de o modelo acertar uma conta ou um formato.
- **Ação externa sempre com aprovação.** Ferramenta com efeito fora do Moductus é declarada como `externo` e passa pelo cartão de aprovação. Sem exceção.
- **Nenhuma cor, tamanho, raio ou duração literal.** Tudo vem dos tokens de [DESIGN.md](docs/DESIGN.md). Componente não conhece o nome do tema. Se falta um token, o PR discute o token antes de usar um número solto.
- **Rede só para provedor e conexões ligadas pelo usuário.** Nenhuma telemetria, nenhum serviço de terceiros por padrão.
- **Chave e token só no Gerenciador de Credenciais.** Nunca no banco, em arquivo de configuração ou em log.
- **Dependência nova com justificativa no PR.** "Facilita" não é justificativa.
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

## Testes

- **Regra de área e de agente:** teste no serviço, com Vitest. Provedor de modelo é sempre falso nos testes; nenhum teste chama rede.
- **Casca nativa:** `cargo test` no que der para separar da API do Windows.
- **Interface:** Playwright para os fluxos principais (captura, aprovação, troca de tema).

## Idioma

Documentação, comentários e mensagens de commit em português do Brasil. Commits seguem Conventional Commits (`feat(dock):`, `fix(agentes):`, `docs:`) e dizem o que a mudança entrega.
