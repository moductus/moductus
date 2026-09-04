# Moductus

**Tudo a uma tecla de distância.**

Suíte de utilitários para Windows, open source, em processo único, acionada por teclado.

[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-FFB224)](LICENSE)
[![Status: fase 1](https://img.shields.io/badge/status-fase%201%20%C2%B7%20esqueleto-6B717A)](docs/PRODUCT.md#9-roadmap)

---

> **Status: fase 1, construindo o esqueleto.** Ainda não há nada instalável. Existem a configuração versionada e o registro central de hotkeys, com testes; falta tudo que aparece na tela. Este README descreve o que está sendo construído, não o que já funciona — o [roadmap](docs/PRODUCT.md#9-roadmap) diz o que vem primeiro.

## O que é

Um único processo leve que coloca utilitários de sistema a um atalho de distância, aparecendo e sumindo sem nunca virar mais uma janela pra gerenciar.

Três regras carregam o produto inteiro, e um módulo que não cabe nas três não entra na suíte:

- **Atalho** — nada se abre com clique de ícone. Tudo nasce de tecla.
- **Aparece e some** — nenhuma superfície é permanente, exceto o ícone de bandeja.
- **Um processo** — 18 utilitários não podem custar 18 processos.

## A tecla líder

Registrar dezoito hotkeys globais garante conflito com outros aplicativos, e o Windows não avisa quando o registro falha — o atalho simplesmente não funciona, sem explicação. Então existe **uma** hotkey, e uma letra escolhe o módulo:

```
Ctrl+Alt+Space  →  o  →  Ports
Ctrl+Alt+Space  →  s  →  Scratch
Ctrl+Alt+Space  →  k  →  Peek
```

Isso entrega três coisas de uma vez: um único ponto de conflito para resolver, descoberta dos módulos sem abrir configuração, e a sensação de leader key que torna um conjunto de ferramentas pequenas agradável de operar.

Atalho direto continua existindo, mas como opção para dois ou três favoritos — nunca como padrão de fábrica.

## Módulos planejados

| Módulo | O que faz | Fase |
|---|---|---|
| **Awake** | Impede hibernar e desligar a tela | 1 |
| **Peek** | Miniatura flutuante ao vivo de qualquer janela | 2 |
| **Ports** | Lista portas locais ocupadas e mata o processo | 2 |
| **Scratch** | Bloco de notas que desliza do topo e salva sozinho | 2 |
| **Palette** | Busca de comandos, scripts e ações | 3 |
| **Clips** | Histórico de clipboard navegável por teclado | 4 |
| **Freeze** | Tela congelada com régua, conta-gotas, lupa e OCR | 4 |
| **Shelf** | Bandeja temporária na borda para segurar arquivos | 4 |
| **Mic** | Mudo de microfone com indicador na bandeja | 4 |
| **Links** | Cria junction e symlink arrastando pasta | 4 |
| **Kill** | Mira que encerra janela travada com um clique | 4 |
| **Timer** | Pomodoro desenhado dentro do ícone da bandeja | 4 |

O que ficou de fora, e por quê, está em [docs/PRODUCT.md](docs/PRODUCT.md#5-módulos) — a lista de módulos cortados é tão importante quanto a de aprovados.

## Privacidade

**Zero telemetria, zero rede.** O aplicativo não faz nenhuma requisição HTTP, nem para checar atualização.

Isso é decisão de produto antes de ser decisão de privacidade. Um programa que roda em segundo plano, registra hotkeys globais e lê o clipboard precisa ser auditável para merecer confiança, e é por isso que o repositório é público desde o primeiro commit.

Se algum dia houver checagem de atualização, ela será opt-in explícito e documentada.

## Instalação

Ainda não há release. Quando houver, serão dois canais:

| Canal | Formato | Tamanho |
|---|---|---|
| Download direto | Zip portable, self-contained | ~60–70 MB |
| `winget` e `scoop` | Framework-dependent (requer .NET Desktop Runtime) | ~10–15 MB |

O zip é maior porque carrega o runtime inteiro dentro dele — o WPF não pode ser *trimmed*, então não há como encolher isso. Em troca, ele extrai e roda em qualquer máquina, sem instalar nada. Pelo `winget` o runtime vira dependência declarada e o pacote fica pequeno.

### Sobre o aviso do SmartScreen

O Moductus não é assinado digitalmente. Um certificado de code signing custa entre US$ 200 e 400 por ano e não existe alternativa gratuita reconhecida pelo Windows, então o SmartScreen vai exibir "aplicativo desconhecido" na primeira execução.

O que dá para fazer sem dinheiro, e está sendo feito: todo binário é construído pelo GitHub Actions com [attestation](https://docs.github.com/actions/security-guides/using-artifact-attestations), o que permite a qualquer pessoa verificar que o arquivo publicado veio exatamente daquele commit deste repositório.

## Documentação

| Documento | O que responde |
|---|---|
| [docs/PRODUCT.md](docs/PRODUCT.md) | O que o produto é, por que existe, e as 20 decisões registradas |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Como funciona por dentro — ciclo de vida, tecla líder, foco, latência |
| [docs/MODULES.md](docs/MODULES.md) | Como escrever um módulo |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Regras não negociáveis de PR |

## Contribuindo

Propostas de módulo vão como issue antes do código, usando o [template](.github/ISSUE_TEMPLATE/module.yml). As regras são curtas e não negociáveis — leia o [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir um PR, e o [docs/MODULES.md](docs/MODULES.md) antes de escrever um módulo.

## Licença

[MIT](LICENSE).
