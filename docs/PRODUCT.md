# Moductus — Documento de Produto

> Suíte de utilitários para Windows, open source, em processo único, acionada por teclado.

**Status:** roadmap concluído — os doze módulos aprovados existem, mais os utilitários pequenos como comandos da Palette. `v0.3.0` é o primeiro release público, com os doze e com o mark de verdade; nenhum rascunho anterior chegou a ser publicado. Este documento é a fonte de verdade.
**Última revisão:** setembro de 2026

---

## Sumário

1. [Tese do produto](#1-tese-do-produto)
2. [Modelo open source](#2-modelo-open-source)
3. [Arquitetura](#3-arquitetura)
4. [A tecla líder](#4-a-tecla-líder)
5. [Módulos](#5-módulos)
6. [Design system](#6-design-system)
7. [Identidade visual](#7-identidade-visual)
8. [Estrutura do repositório](#8-estrutura-do-repositório)
9. [Roadmap](#9-roadmap)
10. [Decisões registradas](#10-decisões-registradas)
11. [Riscos conhecidos](#11-riscos-conhecidos)
12. [Prompt base para geração de módulo](#12-prompt-base-para-geração-de-módulo)
13. [Apêndice: nome](#13-apêndice-nome)

---

## 1. Tese do produto

> Um único processo leve que coloca utilitários de sistema a um atalho de distância, aparecendo e sumindo sem nunca virar mais uma janela pra gerenciar.

Três palavras carregam o produto inteiro:

- **Atalho** — nada se abre com clique de ícone. Tudo nasce de tecla.
- **Aparece e some** — nenhuma superfície é permanente, exceto o ícone de bandeja.
- **Um processo** — 18 utilitários não podem custar 18 processos.

Se um módulo não cabe nessas três, ele não entra na suíte.

### Contra quem

O concorrente direto é o **Microsoft PowerToys**. Ele é bom, gratuito e completo, e ainda assim deixa espaço: instala centenas de MB, roda vários processos, a janela de configuração demora pra abrir e a experiência é orientada a mouse. A brecha é um concorrente enxuto, portable, keyboard-first, com um executável só.

A inspiração de espírito é o **Omarchy** (distro Linux baseada em Arch), pela ideia de um conjunto de ferramentas pequenas, coerentes entre si e operadas por teclas líderes.

### Não-objetivos

Deixar explícito o que o projeto **não** vai ser evita 80% das discussões futuras de escopo:

- Não é um framework de automação (isso é AutoHotkey)
- Não é um gerenciador de janelas completo (isso é FancyZones)
- Não tem loja de plugins de terceiros
- Não tem conta, login, nuvem ou sincronização
- Não tem telemetria de nenhum tipo
- Não tem versão paga

---

## 2. Modelo open source

Repositório público desde o primeiro commit. Isso não é detalhe de distribuição, é parte da proposta: um app que roda em segundo plano, registra hotkeys globais e lê o clipboard **precisa** ser auditável pra merecer confiança.

### Licença

**MIT.** É a escolha certa aqui por três motivos: máxima adoção, compatível com empacotadores como winget e scoop sem fricção, e permite que trechos sejam reaproveitados por outros projetos (que é como um utilitário pequeno ganha relevância). GPL só faria sentido se houvesse medo de fork comercial fechado, o que não é um risco real neste nicho.

Adicionar o `LICENSE` no commit inicial. Sem licença, o padrão legal é "todos os direitos reservados" e ninguém pode contribuir.

### CI e distribuição

Tudo em camada gratuita:

| Item | Ferramenta | Custo |
|---|---|---|
| Build e teste | GitHub Actions (runner `windows-latest`) | Grátis em repo público |
| Release | GitHub Releases | Grátis |
| Procedência do binário | Artifact Attestations do GitHub | Grátis |
| Pacote | `winget` e `scoop` | Grátis |
| Site | GitHub Pages | Grátis |

### Dois canais de distribuição

Decidido: **zip portable self-contained como download principal, e pacote framework-dependent no winget e no scoop.**

O motivo é uma contradição que só aparece quando se olha o número. WPF **não pode ser trimmed** — trimming de WPF não é suportado — e não suporta NativeAOT. Um publish self-contained fica na faixa de 130 a 160 MB em disco, algo entre 60 e 70 MB no zip com single-file e compressão. É menos que o PowerToys, mas não é a diferença de ordem de grandeza que "instala centenas de MB" sugere.

O framework-dependent resolve isso: fica na casa de 10 a 15 MB, porque o .NET Desktop Runtime vira dependência declarada. Isso funciona perfeitamente no winget e no scoop, que instalam a dependência sozinhos, e funciona mal num zip solto, onde a pessoa descobriria a exigência só ao dar duplo clique.

| Canal | Formato | Tamanho | Por quê |
|---|---|---|---|
| Download do README | Zip portable, self-contained | **62,7 MB** medidos no v0.2.0 | "Extrai e roda" sem exigir nada instalado |
| winget e scoop | Framework-dependent | **6,6 MB** medidos no v0.2.0 | O gerenciador resolve o runtime; é o canal do público-alvo |

A estimativa original de 10–15 MB para o framework-dependent estava errada para mais: sem o runtime, o app tinha 0,3 MB. Os 6,6 MB atuais são a projeção WinRT (`Microsoft.Windows.SDK.NET`) que o OCR nativo exige — o preço de não baixar modelo nenhum.

Custa dois jobs no `release.yml` em vez de um. Em troca, o argumento de peso continua verdadeiro no canal onde ele é medido, e a promessa de portable continua verdadeira no canal onde ela importa.

**O README precisa dizer os dois números com honestidade.** Esconder o tamanho do self-contained é o tipo de coisa que alguém mede e comenta.

### O problema da assinatura de código

Certificado de code signing custa entre US$ 200 e 400 por ano, e não existe alternativa gratuita reconhecida pelo Windows. Sem ele, o SmartScreen exibe aviso de "aplicativo desconhecido" em toda instalação.

Mitigações que funcionam sem dinheiro:

- **Distribuir o .zip portable como download principal.** Extrair e rodar tem menos atrito psicológico do que um instalador não assinado.
- **Publicar no winget e no scoop.** Instalação por linha de comando não passa pelo SmartScreen da mesma forma, e é exatamente o canal do público-alvo.
- **Build 100% pelo Actions, com attestation.** Qualquer pessoa consegue verificar que o binário publicado veio daquele commit.
- **Documentar o aviso no README** com honestidade, explicando o motivo. Esconder gera mais desconfiança do que explicar.

### Postura de privacidade

**Zero telemetria, zero rede.** O app não faz nenhuma requisição HTTP, nem para checar atualização. Isso é decisão de produto, não só de privacidade: é a resposta mais forte pra pergunta "por que eu deixaria isso lendo meu clipboard?".

Se um dia houver checagem de atualização, ela precisa ser opt-in explícito e documentada.

### Contribuição

O `CONTRIBUTING.md` deve conter regras curtas e não negociáveis:

- Um módulo por PR
- Todo módulo usa um dos quatro arquétipos de janela, sem exceção
- Nenhuma cor, tamanho ou duração fora dos tokens
- Nenhuma dependência nova sem justificativa no PR
- Proposta de módulo novo vai como issue antes do código, usando o template

Vale criar um template de issue chamado "Proposta de módulo" com os campos: qual dor resolve, qual arquétipo usa, qual API do Windows, e o que já existe que faz isso.

---

## 3. Arquitetura

### Um app com módulos, não vários apps

Decidido: **processo único, um ícone na bandeja, módulos ativáveis**.

Os motivos são concretos:

- Cada app separado seria um processo, um registro de startup e um pool de memória próprio. Oito miniapps ativos custariam algo perto de 320 MB de RAM, o que mata o objetivo de rodar em máquina fraca.
- `RegisterHotKey` falha em silêncio quando outro processo já tomou a combinação. Com um processo só, existe um registro central de atalhos e é possível avisar o usuário sobre conflito.
- Overlay transparente, hook de teclado, ícone de bandeja, tema e persistência são compartilhados. Escrever essa base 18 vezes é onde o projeto morre.

**Não haverá plugins de terceiros carregados em runtime.** Módulos são internos, implementando uma interface comum. Plugin externo traz problema de segurança e de versionamento que o projeto não precisa antes da v1.

### Stack

**C# com .NET 10 (LTS), WPF puro. Sem WinForms.**

Versão fixa em vez de "8 ou superior": alvo flutuante faz o CI divergir da máquina de desenvolvimento, e sempre no pior momento.

O WPF não tem API de ícone de bandeja, e o caminho óbvio seria trazer o WinForms só pelo `NotifyIcon`. **Medimos o preço disso e ele é alto demais para um wrapper.** Ter os dois stacks no mesmo projeto torna ambíguos quase todos os nomes de UI — `Application`, `TextBox`, `ListBox`, `Orientation`, `Color`, `Brushes` — e exige uma lista de aliases em *todo* arquivo que toca interface, o que incluiria os doze módulos. Custa ainda uma assembly a mais no startup.

A bandeja é chamada direto: `Shell_NotifyIcon` pelo CsWin32. O spike de latência confirmou que o CsWin32 acerta as assinaturas sem ajuste manual, que era o risco que justificava o wrapper.

Justificativa por critério:

- **Acerto em vibecode.** É o stack com mais exemplo de P/Invoke Win32 disponível, e metade dos módulos é chamada direta de API do Windows.
- **Peso.** Faixa de 40 a 80 MB de RAM para o app inteiro. Electron custaria 200 MB só pra abrir uma janela.
- **Custo.** Nenhum runtime pago, nenhuma licença.

**Use o `Microsoft.Windows.CsWin32`.** Você lista o nome da função Win32 num arquivo de texto e ele gera a assinatura P/Invoke correta. Isso elimina a maior fonte de bug em vibecode Win32, que é assinatura errada de struct. Configure no dia um.

### Stacks descartadas

| Stack | Motivo |
|---|---|
| Electron / Tauri+web | Contradiz o objetivo de performance |
| Tauri / Rust puro | Interop Win32 em Rust é onde o modelo mais alucina |
| AutoHotkey v2 | Ótimo pra protótipo, mas UI limitada e falso positivo constante em antivírus |
| WinUI 3 | Deployment mais frágil e comunidade menor que WPF |

### Interface de módulo

```csharp
public interface IModule
{
    string Id { get; }                  // "ports"
    string Name { get; }                // "Ports"
    string Description { get; }
    ModuleArchetype Archetype { get; }

    char SuggestedLeaderKey { get; }    // letra padrão; o usuário pode trocar
    bool HasSurface { get; }            // false em módulo puro de estado (Awake)

    void Enable();                      // barato: registra letra e hotkey. Startup.
    void Disable();
    void Invoke();                      // mostra ou alterna a superfície. Atalho.

    UserControl? BuildSettings();       // painel de config, ou null
}
```

**`Enable` e `Invoke` são separados de propósito.** `Enable` roda para todo módulo ativo no startup e não pode tocar em UI. `Invoke` roda no atalho e é o único lugar onde a superfície aparece. Juntar os dois faz o startup carregar a UI de todos os módulos ativos, e é assim que um app de bandeja passa a demorar três segundos para subir.

`BuildSettings` retorna `UserControl` porque **`Moductus.Core` referencia WPF e assume isso**. Não é uma lib portável, é a base de um app Windows; fingir independência de UI custaria uma camada de abstração declarativa que o primeiro módulo com config incomum quebraria de qualquer jeito.

Config em JSON. Dois modos:

- **Instalado:** `%APPDATA%\Moductus\config.json`
- **Portable:** `config.json` ao lado do executável, detectado pela presença de um arquivo `portable.txt`

O arquivo tem um campo `version` desde o primeiro release, e **chave desconhecida é preservada, nunca apagada.** Sem isso, abrir uma versão antiga depois de testar uma nova destrói silenciosamente a configuração do usuário.

### Instância única

Um app de hotkey global não pode rodar duas vezes: a segunda instância falha ao registrar tudo e o usuário fica com um Moductus que não responde, sem nenhuma pista do motivo. Mutex nomeado no startup e, se já houver instância, sinalizar a existente para abrir as configurações antes de sair.

---

## 4. A tecla líder

Esta é a decisão de UX que resolve o maior problema técnico do projeto.

Registrar 18 hotkeys globais garante conflito com outros apps, e `RegisterHotKey` não avisa quando falha.

**Solução:** uma hotkey líder abre o **overlay do líder**, e uma letra escolhe o módulo.

**O overlay do líder não é o módulo Palette.** São duas coisas com nomes perigosamente parecidos:

| | O que é | Onde mora | Quando |
|---|---|---|---|
| **LeaderOverlay** | Mostra as letras e dispara módulos | `Moductus.UI`, infraestrutura do host | Fase 1 |
| **Palette** | Lançador: conta, aplicativo, arquivo, comandos e scripts | `Moductus.Modules`, um módulo | Fase 3 |

Se os dois nascerem com o mesmo nome, a Fase 3 vira refactor do núcleo em vez de mais um módulo. O Palette, quando chegar, se registra como só mais um destino alcançável pelo líder.

```
Ctrl+Alt+M  →  o  →  abre Ports
Ctrl+Alt+M  →  s  →  abre Scratch
```

Atalho direto continua existindo, mas como opção para dois ou três favoritos, nunca como padrão de fábrica.

Isso entrega três coisas de graça:

1. Um único ponto de conflito a resolver
2. Descoberta dos módulos sem abrir configuração
3. A mesma sensação de leader key que torna o Omarchy agradável de usar

**Combinações a evitar como padrão:**

| Combinação | Conflito |
|---|---|
| `Alt+Space` | Menu de sistema da janela |
| `Win+Space` | Troca de layout de teclado |
| `Ctrl+Space` | IME e autocomplete de IDE |
| `Win+V` | Histórico de clipboard nativo |
| `Ctrl+Alt+Space` | **Claude Code** (app desktop) — descoberto na máquina de desenvolvimento pelo registro de conflito |

Padrão: **`Ctrl+Alt+M`** — M de Moductus — configurável pela tela de configurações desde a Fase 1. Era `Ctrl+Alt+Space` até o `v0.1`; a colisão com o Claude Code, descoberta pelo registro de conflito na máquina de desenvolvimento, era grave demais porque é o público-alvo exato. A troca nunca deixa o usuário sem líder: se a combinação nova conflita, a anterior é mantida e o motivo aparece na hora.

---

## 5. Módulos

### Convenção de nome

Substantivo curto, um só, em inglês. Lê bem como `Moductus · Ports` e é digitável na paleta. Os nomes compostos do brainstorm original misturavam três estilos (funcional, metafórico e temático), o que não escala numa lista de configuração.

Única exceção com personalidade: **Freeze**, porque o congelamento de tela é o mecanismo e é o que a pessoa lembra.

### Aprovados

| Módulo | Faz | Arquétipo | API principal | Fase |
|---|---|---|---|---|
| **Awake** | Impede hibernar e desligar tela | HUD | `PowerCreateRequest` | 1 |
| **Peek** | Miniatura flutuante ao vivo de qualquer janela | Panel | `DwmRegisterThumbnail` | 2 |
| **Ports** | Lista portas locais ocupadas, mata o processo | Panel | `GetExtendedTcpTable` | 2 |
| **Scratch** | Bloco de notas que desliza do topo, salva sozinho | Panel | — | 2 |
| **Palette** | Busca de comandos, scripts e ações | Palette | `RegisterHotKey` | 3 |
| **Clips** | Histórico de clipboard navegável por teclado | Palette | `AddClipboardFormatListener` | 4 |
| **Freeze** | Congela a tela: recorte, anotação, régua, conta-gotas, lupa e OCR | Canvas | `BitBlt` + `Windows.Media.Ocr` | 4 |
| **Shelf** | Bandeja temporária na borda pra segurar arquivos | Panel | `IDropTarget` + `DoDragDrop` | 4 |
| **Mic** | Mudo de microfone por hardware, com indicador | HUD | Core Audio (`IAudioEndpointVolume`) | 4 |
| **Links** | Cria junction e symlink arrastando pasta | Panel | `CreateSymbolicLink` / junction | 4 |
| **Kill** | Mira que encerra janela travada com um clique | Canvas | `WindowFromPoint` + `TerminateProcess` | 4 |
| **Timer** | Pomodoro desenhado dentro do ícone da bandeja | HUD | GDI+ no ícone | 4 |

### Registro de letras

Três módulos disputam o `p`: Peek, Ports e Palette. A letra **não pode ser derivada da inicial** — precisa ser dado explícito, com a mesma mecânica do registro de hotkeys: atribuição central, configurável pelo usuário, e colisão detectada no startup com aviso visível.

Atribuição inicial sugerida:

| Letra | Módulo | | Letra | Módulo |
|---|---|---|---|---|
| `a` | Awake | | `c` | Clips |
| `k` | Peek | | `f` | Freeze |
| `o` | Ports | | `h` | Shelf |
| `s` | Scratch | | `m` | Mic |
| `p` | Palette | | `l` | Links |
| | | | `x` | Kill |
| | | | `t` | Timer |

`p` fica com o Palette porque ele é o hub e será o mais usado. Peek herda `k` e Ports herda `o` — consoantes fortes do próprio nome, que é mais memorizável que uma segunda letra arbitrária.

### Adiados

| Módulo | Motivo |
|---|---|
| **Audio** (volume por app, troca de saída) | Depende de `IPolicyConfig`, API **não documentada** da Microsoft que quebra entre versões do Windows. O EarTrumpet já resolve bem. |
| **Brightness** (brilho de monitor externo) | DDC/CI é loteria de firmware: muitos monitores respondem errado ou não respondem. Semanas debugando hardware alheio contra o Twinkle Tray, que é maduro e gratuito. |
| **Hosts** (perfis do arquivo hosts) | Escrever em `System32\drivers\etc\hosts` briga com o Windows Defender e exige elevação constante. |

### Cortados

| Módulo | Motivo |
|---|---|
| **GhostClick** (automação de cliques) | Pouco diferencial, e hooks de mouse de baixo nível fazem anti-cheat de jogo marcar o app. |
| **WorkspaceTiler** (tiling de janelas) | Parece simples e não é: DPI misto entre monitores, offset invisível de borda em janelas modernas, apps que ignoram `SetWindowPos`, desktops virtuais. É um projeto inteiro sozinho, contra o FancyZones. |
| **WindowShade** (enrolar janela) | Exige hook global interpretando área não-cliente de janelas alheias, e quebra em todo app com title bar customizada — Chrome, VS Code, Discord, Spotify, quase tudo. |

### Ideias adicionadas

| Ideia | Por quê | Forma |
|---|---|---|
| **OCR de tela** | O Windows tem OCR nativo e gratuito via `Windows.Media.Ocr`. Sem dependência externa, sem modelo pra baixar. Provavelmente a funcionalidade de maior valor percebido da lista inteira. | Dentro do Freeze |
| **PasteFlow** | Transformações de clipboard: colar sem formatação, slug, camelCase, JSON formatado, decodificar base64 e JWT. | Comandos da Palette |
| **RunNotify** | Envolve um comando longo e notifica quando termina, com tempo gasto e exit code. Trivial de fazer, resolve dor real. | Comando da Palette |
| **QR do clipboard** | Gera QR do que estiver copiado, pra mandar link ao celular. "Vinte linhas" assumia uma biblioteca: o Windows não tem codificador nativo. **QRCoder (MIT) aprovado** como a única dependência NuGet do projeto, em 2026-09-06. | Comando da Palette ✅ |

### Armadilhas técnicas por módulo

Anotações que economizam dias de debug:

- **Clips** — gerenciadores de senha marcam o clipboard com os formatos `ExcludeClipboardContentFromMonitorProcessing` e `CanIncludeInClipboardHistory`. Respeitar isso é obrigatório, ou o app vira algo que grava senha em disco.
- **Links** — symlink exige admin ou Modo Desenvolvedor, mas **junction de pasta não exige nada**. Como 95% do uso real é mover pasta pesada de disco (`node_modules`, pasta de jogo, cache), usar junction por padrão e deixar symlink como opção avançada. Isso tira o UAC do caminho.
- **Ports** — para ver o processo dono de portas de serviço do sistema é preciso elevação. Sem admin, alguns aparecem como desconhecidos. Mostrar isso na UI em vez de esconder.
- **Timer** — a bandeja pede o ícone em 16, 20, 24 ou 32px conforme o scaling do monitor. Gerar o bitmap no tamanho solicitado, nunca fixo em 16.
- **Freeze** — capturar o desktop como bitmap, jogar numa janela fullscreen borderless topmost, e operar régua, lupa e conta-gotas sobre esse bitmap em memória. Fica preciso e independe do que estava se movendo na tela.
- **Kill** — pode ser marcado por anti-cheat. Documentar isso no README.

---

## 6. Design system

### Princípios

1. **Velocidade é a estética.** Um overlay bonito que demora 300ms parece pior que um feio instantâneo.
2. **Nada é permanente.** Só o ícone de bandeja fica na tela.
3. **Teclado primeiro, mouse possível.** Toda ação tem caminho por tecla; nenhuma exige mouse.
4. **Sem configuração obrigatória.** Instalou, funciona. Config existe pra quem quer.
5. **Densidade alta.** É ferramenta de trabalho, não landing page.

### Os quatro arquétipos de janela

O coração do sistema. Não se desenham 18 interfaces: desenham-se **quatro**, e todo módulo escolhe uma. É isso que torna o projeto viável em vibecode e o que faz tudo parecer da mesma família.

| Arquétipo | Onde aparece | Rouba foco | Comportamento |
|---|---|---|---|
| **Palette** | Centro, terço superior, 640px | Sim | Campo de busca + lista. Guarda o `HWND` anterior e devolve o foco ao fechar. |
| **HUD** | Pílula pequena, ancorada | Não | Transitória, some sozinha em ~1,5s. Não aceita clique. Puro feedback. |
| **Panel** | Flutuante, redimensionável | Não | Pode ficar aberto durante o trabalho. Tem botão de fixar. |
| **Canvas** | Tela cheia, topmost | Sim | Desktop congelado como bitmap por baixo, véu preto a 40%. |

HUD e Panel usam `WS_EX_NOACTIVATE` para não roubar foco.

Mais duas superfícies que não são arquétipos mas fazem parte do sistema: o **ícone de bandeja** (único ponto permanente) e a **janela de configurações** (janela normal, com Mica, aberta só quando pedida).

**A regra que faz isso valer a pena:** um módulo novo não desenha UI nova. Ele escolhe um arquétipo e preenche o conteúdo.

**Os arquétipos são janelas singleton, criadas e escondidas no startup.** Isso não é otimização, é requisito de esqueleto. O WPF paga a construção da árvore visual na primeira vez que a janela aparece, e essa conta cai inteira na primeira invocação de cada módulo — os mesmos 300ms que a seção acima chama de fatais. Se o padrão de "construir no atalho" entrar na Fase 1, todo módulo já nasce errado e a correção vira reescrita de doze arquivos.

### Tokens

Tudo num `Tokens.xaml` único, um `ResourceDictionary` que todo módulo referencia. Fonte única de verdade, e o modelo para de inventar cor a cada arquivo.

#### Cor — tema escuro (padrão)

| Token | Valor | Uso |
|---|---|---|
| `bg.base` | `#141517` | Fundo de overlay opaco |
| `bg.raised` | `#1C1E22` | Card, input, linha selecionada |
| `bg.hover` | `#24262B` | Hover de linha |
| `border.subtle` | `#2E3138` | Divisores internos |
| `border.strong` | `#3C4048` | Borda externa de toda janela flutuante |
| `text.primary` | `#E8EAED` | Texto principal |
| `text.secondary` | `#9AA0A9` | Descrição, atalho, metadado |
| `text.muted` | `#6B717A` | Placeholder, estado vazio |
| `accent` | `#FFB224` | Seleção, foco, ícone ativo |
| `accent.fg` | `#1A1204` | Texto sobre o accent |
| `success` | `#3DD68C` | Porta livre, processo saudável |
| `danger` | `#F0554F` | Ação destrutiva |

Âmbar foi escolhido porque a barra de tarefas e a maioria dos apps de dev vivem em azul e roxo. Âmbar destaca sem gritar e funciona bem no ícone monocromático da bandeja.

**Não existe token de "warning" separado.** Num utilitário desse tamanho, atenção e destaque são o mesmo sinal, e três cores semânticas bastam. Menos token, menos decisão errada.

#### Cor — tema claro

| Token | Valor |
|---|---|
| `bg.base` | `#FAFAFA` |
| `bg.raised` | `#FFFFFF` |
| `bg.hover` | `#F0F1F3` |
| `border.subtle` | `#E8EAED` |
| `border.strong` | `#D8DBDF` |
| `text.primary` | `#17181A` |
| `text.secondary` | `#5A6069` |
| `text.muted` | `#8A9099` |
| `accent` | `#FFB224` |
| `accent.fg` | `#1A1204` |
| `success` | `#1E9E63` |
| `danger` | `#D93B35` |

`success` e `danger` são mais escuros que no tema escuro porque os originais somem sobre branco.

Herdar do sistema por padrão, lendo `AppsUseLightTheme` no registro e escutando `WM_SETTINGCHANGE`.

#### Tipografia

**Segoe UI Variable** (Win11) com fallback para **Segoe UI** (Win10). Monoespaçado: **Consolas**, que existe em toda instalação.

Zero download, zero licença, zero peso no binário, e é o que faz o app parecer nativo em vez de web embrulhada.

| Nível | Tamanho (DIP) | Peso | Uso |
|---|---|---|---|
| caption | 11 | 400 | Atalho, metadado |
| body | 13 | 400 | Padrão |
| body-lg | 15 | 400 | Input da paleta |
| title | 20 | 600 | Título de painel |
| display | 28 | 600 | Número grande (timer) |

Dois pesos apenas: 400 e 600. Line-height 1.4 no corpo, 1.2 em título.

#### Espaço, raio e tamanho

Grade base de **4px**. Escala: `4, 8, 12, 16, 24, 32`.

| Elemento | Raio |
|---|---|
| Controle (botão, input) | 6 |
| Card | 10 |
| Janela flutuante | 12 |
| Badge | pill |

O Windows 11 usa 8 em menu e 12 em janela, então isso encaixa sem parecer estrangeiro.

| Elemento | Tamanho |
|---|---|
| Altura de linha de lista | 32px |
| Altura de input | 36px |
| Altura de botão | 32px |
| Ícone inline | 16px |
| Largura da Palette | 640px |
| Altura máxima da Palette | 480px |
| Tamanho mínimo de Panel | 320×240px |

#### Movimento

| Transição | Duração | Curva |
|---|---|---|
| Entrada | 140ms | ease-out |
| Saída | 90ms | ease-in |
| Hover e press | 80ms | linear |

Nada acima de 200ms em lugar nenhum. Deslocamento máximo de 8px, escala partindo de 0.98. Sem mola, sem bounce.

**O ponto crítico:** a hotkey é o produto. Se a paleta demora 300ms pra aparecer, a pessoa sente lentidão mesmo com busca instantânea. Prefira aparecer sem animação a aparecer bonito e atrasado.

Ler `SystemParametersInfo(SPI_GETCLIENTAREAANIMATION)` e desligar tudo quando o usuário tiver desativado animações na acessibilidade do Windows.

#### Fundo e elevação

| Superfície | Backdrop |
|---|---|
| Configurações | Mica (`DWMSBT_MAINWINDOW`) |
| Palette, Panel, HUD | Acrylic (`DWMSBT_TRANSIENTWINDOW`) no Win11 |
| Canvas | Bitmap congelado + véu preto 40% |
| Fallback geral | `bg.base` sólido |

**Toggle de "efeitos reduzidos" é obrigatório desde o dia um.** Blur em janela transparente custa GPU, e no Win10 o acrylic tem lag conhecido ao arrastar. A promessa de rodar em qualquer máquina depende desse fallback existir de saída, não como remendo depois.

Elevação é só: borda de 1px em `border.strong` mais uma sombra suave. Nunca empilhar sombras.

### Contrato de interação

Vale para todo módulo, sem exceção.

- `Esc` fecha, sempre, sem confirmar nada
- `Enter` executa a ação primária
- Toda hotkey é toggle: apertar de novo fecha
- Clique fora fecha Palette e Panel não fixado
- HUD e Panel nunca roubam foco
- Zero som por padrão
- Zero diálogo de confirmação, exceto ação irreversível de verdade
- Sem splash, sem tela de boas-vindas, sem modal de atualização
- Estado vazio sempre tem texto explicando o que fazer, nunca fica em branco
- Erro aparece inline no próprio overlay, nunca em `MessageBox`

**Primeiro uso:** uma única tela mostrando a tecla líder, e nada mais. Se precisar de tutorial, o design falhou.

### Acessibilidade e DPI

- Declarar **Per-Monitor DPI Awareness V2** no manifesto. Sem isso, overlay em monitor secundário sai borrado ou fora de lugar.
- Respeitar o modo de alto contraste do Windows: quando ativo, usar as cores do sistema em vez dos tokens.
- Toda ação alcançável por teclado.
- Nunca usar cor como único indicador de estado.

---

## 7. Identidade visual

O ativo mais importante **não é o logo grande**. É o ícone de 16px na bandeja, porque é ele que a pessoa vê 100% do tempo.

O mark são **quatro módulos arredondados num arranjo 2×2**, cada um com um glifo próprio, dentro de um contêiner escuro — pequenas medidas reunidas, que é o que o nome diz. Os arquivos estão em `assets/`:

| Arquivo | Para quê |
|---|---|
| `assets/mark-512.png` | A fonte. Todo tamanho novo sai daqui. |
| `assets/moductus.ico` | `<ApplicationIcon>` do executável — Alt+Tab, Explorer, taskbar fixado. Sete tamanhos, de 16 a 256. |
| `assets/mark-192.png` | Avatar da organização e README. |
| `assets/web/` | Conjunto de favicon, para quando houver site. |

**A bandeja não usa nenhum desses arquivos.** Ela usa `Mark.cs`, que traça a redução monocromática do mesmo desenho no tamanho e no tema do momento. Não é duplicação por descuido — é o que separa ícone legível de borrão:

- **Escalar raster não funciona em 16px.** O mark cheio tem contêiner, quatro módulos e um glifo dentro de cada um; em 16px sobra uma mancha âmbar. A bandeja recebe só os quatro blocos, que é o que ainda lê.
- **Bandeja é tinta sobre transparência, não placa colorida.** A placa escura do mark cheio desaparece em barra de tarefas clara, e muita gente usa barra clara. `Mark.cs` inverte a tinta conforme `SystemUsesLightTheme`.
- **O tamanho vem por parâmetro.** A bandeja pede 16, 20, 24 ou 32 conforme o scaling, e cada um é traçado na hora, com aritmética que fecha em inteiro nos quatro. `MarkTests` lê os pixels que saíram e falha se a borda escorregar da grade.
- **O ícone carrega estado.** O Timer pinta um arco em volta, o Mic mudo risca na diagonal. Os blocos recuam quando o arco aparece, porque arco e blocos disputam a mesma moldura de 16px.

Acento: `#FFB224`. Tagline: *"Tudo a uma tecla de distância."*

---

## 8. Estrutura do repositório

```
moductus/
├─ .github/
│  ├─ workflows/build.yml            # CI: build, teste, attestation
│  ├─ workflows/release.yml          # tag → zip portable + framework-dependent
│  └─ ISSUE_TEMPLATE/module.yml      # proposta de módulo
├─ src/
│  ├─ Moductus.App/                  # host: bandeja, instância única,
│  │                                 # ciclo de vida, DI, ModuleCatalog
│  ├─ Moductus.Core/
│  │  ├─ Hotkeys/                    # registro central, detecção de conflito
│  │  ├─ Leader/                     # registro de letras, mesma mecânica
│  │  ├─ Config/                     # JSON versionado, portable vs instalado
│  │  ├─ Startup/                    # autostart: chave Run + StartupApproved
│  │  ├─ Tray/                       # Shell_NotifyIcon direto
│  │  ├─ Theme/                      # decide o modo; a UI aplica
│  │  ├─ Interop/                    # MessageWindow, NativeMethods.txt
│  │  └─ Modules/                    # IModule, ModuleArchetype
│  ├─ Moductus.UI/
│  │  ├─ Tokens/
│  │  │  ├─ Tokens.xaml              # FONTE ÚNICA de tamanho, tipo e raio
│  │  │  ├─ Palette.*.xaml           # cor: Dark, Light, HighContrast
│  │  │  ├─ Motion.*.xaml            # duração: normal e reduzida
│  │  │  └─ Controls.xaml            # estilos implícitos sobre os tokens
│  │  ├─ Theme.cs                    # troca paleta e movimento ao vivo
│  │  ├─ LeaderOverlay.xaml          # a superfície da tecla líder (≠ Palette)
│  │  └─ Archetypes/                 # PaletteWindow, HudWindow,
│  │                                 # PanelWindow, CanvasWindow
│  └─ Moductus.Modules/              # UMA pasta por módulo, um projeto só
├─ tests/
│  └─ Moductus.Core.Tests/           # hotkeys, letras, config, e os pixels
│                                    # que o mark da bandeja produz
├─ assets/
│  ├─ mark-512.png                   # a fonte do mark; todo tamanho sai daqui
│  ├─ mark-192.png                   # avatar da org e README
│  ├─ moductus.ico                   # ícone do executável, 16 a 256
│  └─ web/                           # conjunto de favicon, para um site futuro
├─ docs/
│  ├─ PRODUCT.md                     # este documento
│  └─ MODULES.md                     # como escrever um módulo
├─ LICENSE                           # MIT
├─ CONTRIBUTING.md
└─ README.md
```

---

## 9. Roadmap

### Fase 0 — Identidade

1. ~~Fechar o nome e registrar a org~~ — **Moductus**, org criada em 4 de setembro de 2026
2. Registrar `moductus.dev` para o GitHub Pages, e `.com` se quiser proteger a marca — os dois verificados livres
3. Desenhar o mark em 16px e derivar as outras resoluções — antes disso, resolver o ponto em aberto do apêndice 13
4. Criar o repo público com `LICENSE`, `README` e este documento

### Fase 1 — Esqueleto

O mais importante do projeto. Nada disso aparece pro usuário, e é o que decide se o resto é fácil ou impossível.

A ordem importa mais que a lista, porque cada item destrava o seguinte:

1. **Solução vazia e CI que só compila.** Provar o pipeline antes de ter o que buildar — inclusive os dois jobs de publish, porque é ali que o número real do self-contained aparece.
2. **Config** em JSON, versionada, portable vs instalado. Tudo depende disso.
3. **Registro central de hotkeys** com detecção de conflito.
4. **Host:** ícone de bandeja, menu de contexto, instância única, autostart opcional.
5. **`Tokens.xaml` completo** e `Theme` (claro, escuro, alto contraste).
6. **Os quatro arquétipos** como janelas vazias reutilizáveis, criadas e escondidas no startup.
7. **LeaderOverlay** sobre o registro de letras.
8. **`IModule` e `ModuleCatalog`** — registro manual e explícito, não varredura por reflection.
9. **Awake** como primeiro módulo, porque a lógica cabe em 10 linhas e o objetivo é validar o formato, não a funcionalidade.

**Testes cobrem só o passo 2, 3 e 8**: config e migração de schema, conflito de hotkey, colisão de letra. Interop e UI não são testados, e o `CONTRIBUTING.md` precisa dizer isso — senão o "build, teste" do CI vira teatro que ninguém confia.

### Fase 2 — Impacto

Os três de melhor relação valor/esforço, que dão algo mostrável rápido.

- **Peek** (~80 linhas, efeito visual desproporcional ao esforço)
- **Ports** (maior retorno para o público de dev)
- **Scratch**

Ao fim da fase 2: primeiro release público, `v0.1`.

### Fase 3 — O hub

- **Palette**

Deixada para depois de propósito. Assim ela já nasce sabendo disparar os outros módulos, e todos os utilitários pequenos (QR, PasteFlow, RunNotify, conversões) viram comandos dela em vez de módulos separados.

### Fase 4 — Amplitude

Clips, Freeze (com OCR), Shelf, Mic, Links, Kill, Timer. Ordem por interesse.

---

## 10. Decisões registradas

| # | Decisão | Motivo |
|---|---|---|
| 1 | App único com módulos, não apps separados | Memória, conflito de hotkey e reuso de base |
| 2 | C# + .NET + WPF | Melhor acerto em vibecode para Win32, peso baixo, custo zero |
| 3 | CsWin32 obrigatório | Elimina a maior fonte de bug: assinatura P/Invoke errada |
| 4 | Sem plugin de terceiros | Segurança e versionamento que o projeto não precisa antes da v1 |
| 5 | Tecla líder em vez de 18 hotkeys | Um único ponto de conflito, e descoberta embutida |
| 6 | Quatro arquétipos fixos de janela | Torna cada módulo novo um problema de lógica, não de UI |
| 7 | Segoe UI em vez de fonte própria | Peso zero, aparência nativa |
| 8 | Licença MIT | Máxima adoção, compatível com winget e scoop |
| 9 | Zero telemetria e zero rede | É a resposta pra "por que eu confiaria isso com meu clipboard?" |
| 10 | Sem token de warning | Três cores semânticas bastam num app deste tamanho |
| 11 | .NET 10 fixo, não "8 ou superior" | Alvo flutuante faz o CI divergir da máquina de dev |
| 12 | WPF puro, sem WinForms — bandeja por `Shell_NotifyIcon` | O wrapper `NotifyIcon` custaria aliases de desambiguação em todo arquivo de UI, inclusive nos doze módulos. Medido no spike. |
| 13 | Zip self-contained + winget framework-dependent | Mantém o portable e o argumento de peso, cada um no canal certo |
| 14 | `Moductus.Core` referencia WPF assumidamente | É base de app Windows, não lib portável; abstração declarativa quebraria no primeiro módulo incomum |
| 15 | `Enable` separado de `Invoke` | Startup não pode construir a UI de todo módulo ativo |
| 16 | Arquétipos são singletons pré-criados | A construção da árvore visual do WPF cairia na primeira invocação |
| 17 | LeaderOverlay ≠ módulo Palette | Nomes iguais fariam a Fase 3 refatorar o núcleo |
| 18 | Letra é dado explícito no registro central | Peek, Ports e Palette disputam o `p` |
| 19 | Um `Moductus.Modules`, pasta por módulo, registro manual | Sem plugins, assembly separada só compra tempo de build; lista explícita é auditável |
| 20 | Config versionada, chave desconhecida preservada | Downgrade não pode destruir a config de quem testou versão nova |
| 21 | Autostart por chave `Run` do usuário, não Task Scheduler | É o mecanismo mais auditável e aparece na aba Inicializar, onde o usuário já sabe desligar. Task Scheduler custaria interop COM ou dependência, um UAC, e pontua em heurística de antivírus. A elevação que ele permitiria é armadilha: subir a suíte inteira como admin para o Ports ver algumas portas a mais contradiz "por que eu confiaria isso com meu clipboard". Ler `StartupApproved` junto é obrigatório, senão a configuração mente. |

---

### Awake segura a máquina por requisição de energia, não por reset de ociosidade

Levantamento de 11/09/2026 confirmou que é dor real: 487 issues rotuladas
`Product-Awake` no PowerToys, Don't Sleep na v10.22 de março de 2026, Caffeine
mantido há mais de dez anos. A causa é estrutural e não foi resolvida pelo
Windows 11 — os contadores de sono e de bloqueio contam **input do usuário**,
não atividade de processo, então download, build e render não seguram a
máquina sozinhos, e a única saída nativa é trocar o plano de energia para
"Nunca" e lembrar de desfazer.

**O que não servia:** `SetThreadExecutionState` só reseta contadores de
ociosidade. Em máquina com Modern Standby (S0), que é o padrão em notebook
novo, ela entra em connected standby minutos depois de a tela apagar mesmo com
o estado ativo. O caso de uso mais pedido — "deixe a tela dormir mas segure meu
download" — é justamente o que falhava. O Awake do PowerToys tem o mesmo
defeito, aberto na issue 48965.

**O que `Power.cs` faz hoje:** abre um handle com `PowerCreateRequest` e liga
duas requisições separadas nele, `PowerRequestSystemRequired` e
`PowerRequestDisplayRequired`, por `PowerSetRequest`. Separadas porque segurar
a máquina e segurar a tela são pedidos independentes: quem quer o download de
madrugada desliga a segunda e mantém a primeira. `PowerClearRequest` desfaz
cada uma, e o handle só morre quando o módulo é desligado. Isso é requisição de
energia de verdade, respeitada em S0.

**O motivo aparece por escrito.** `PowerCreateRequest` recebe um
`REASON_CONTEXT` com `POWER_REQUEST_CONTEXT_SIMPLE_STRING` e a frase
"Moductus: Awake ligado". Com o módulo ligado, `powercfg /requests` num
terminal elevado lista o executável com essa frase ao lado — o estado fica
auditável de fora do app, por uma ferramenta que já vem no Windows, e é isso
que a API antiga não oferecia.

**O CsWin32 resolve o struct.** A primeira versão desta seção dizia que não, e
isso travou o módulo por um tempo à toa: `REASON_CONTEXT` existe no metadata,
em `Windows.Win32.System.Threading`, e não no `System.Power` onde o resto da
área vive — é só pedir o nome no `NativeMethods.txt`. Nenhuma struct escrita à
mão, que continua proibida pelo `MODULES.md` e pela decisão 3.

**E o que não dá:** tela de bloqueio e `Interactive logon: Machine inactivity
limit` por política de grupo não são contornáveis por app de usuário.
Prometer isso gera issue e decepção. O módulo também **não simula teclado**,
nem como opção — é o que separa um utilitário de energia do mercado de mouse
jigglers, e há demissões documentadas por causa disso.

---

## 11. Riscos conhecidos

| Risco | Impacto | Mitigação |
|---|---|---|
| SmartScreen por falta de assinatura | Perda de usuários na instalação | Zip portable como padrão, winget e scoop, attestation, README honesto |
| Falso positivo de antivírus | Perda de confiança | Build reproduzível pelo Actions, código aberto, submissão de amostra aos fornecedores |
| Anti-cheat marcar o app (Kill, hooks) | Banimento de usuário em jogo | Documentar no README, deixar os módulos de hook desligados por padrão |
| Escopo crescendo sem controle | Projeto nunca sai da Fase 1 | Lista de não-objetivos e regra do arquétipo obrigatório |
| Acrylic pesado em máquina fraca | Contradiz a promessa central | Toggle de efeitos reduzidos desde o dia um |
| Conflito de hotkey com outros apps | Módulo que "não funciona" sem explicação | Registro central, detecção de conflito visível na UI, tecla líder |
| Tamanho do self-contained enfraquece o pitch | Crítica pública de que o app não é tão enxuto quanto promete | Canal framework-dependent no winget, e os dois números ditos no README sem maquiagem |
| Latência da primeira invocação de cada módulo | Contradiz a promessa central, e só aparece em uso real | Arquétipos pré-criados no startup, medido desde a Fase 1 |
| Segunda instância registrando hotkeys | App "morto" sem nenhuma pista do motivo | Mutex nomeado, sinalizar a instância existente |

---

## 12. Prompt base para geração de módulo

Colar no topo de todo prompt de módulo novo. Isso é o que mantém o vibecode dentro do sistema.

```
Contexto: projeto Moductus, C# .NET 10, WPF puro, processo único. Sem WinForms.
Usar CsWin32 para todo P/Invoke — cite a API do Windows pelo nome exato.

Regras obrigatórias:
- Implementar IModule (Id, Name, Description, Archetype, Enable, Disable, BuildSettings)
- Usar EXCLUSIVAMENTE um dos quatro arquétipos: Palette, HUD, Panel, Canvas
- Nenhuma cor, tamanho, raio ou duração literal no código — só chaves do Tokens.xaml
- Esc fecha; Enter é a ação primária; a hotkey é toggle
- HUD e Panel usam WS_EX_NOACTIVATE e não roubam foco
- Nenhuma chamada de rede
- Nenhum MessageBox: erro vai inline no overlay
- Estado vazio precisa de texto explicativo
- Nenhuma dependência NuGet nova sem eu aprovar

Módulo a construir: <nome>
Arquétipo: <um dos quatro>
API principal: <nome exato da função Win32>
Comportamento: <descrição>
```

A diferença de acerto quando se nomeia a API explicitamente em vez de descrever o comportamento é grande. Peça `DwmRegisterThumbnail`, não "uma miniatura ao vivo da janela".

---

## 13. Apêndice: nome

**Fechado: Moductus.** Org criada em 4 de setembro de 2026.

*Moductus* junta **modulus** — latim, diminutivo de *modus*, "medida pequena", raiz de "módulo" — com **conjunctus**, particípio de *coniungere*, "unidos". Literalmente "pequenas medidas unidas", que é a descrição da arquitetura: dezoito utilitários pequenos dentro de um processo só. O latim também é o único vocabulário genuinamente compartilhado entre português e inglês, então a pronúncia transfere sem esforço nos dois.

### O que a verificação revelou

Vinte e dois candidatos foram testados contra a API do GitHub, RDAP e winget. O resultado mudou o critério de escolha: **todo handle ASCII pronunciável de 4 a 6 letras já está tomado no GitHub.** O namespace curto se esgotou anos atrás, então "handle de topo livre" não é um critério utilizável — é sorte.

| Nome | Handle | `.dev` | Por que caiu |
|---|---|---|---|
| Tecla | ocupado | livre | Colide com o Tecla da Komodo, hardware de acessibilidade |
| Lesto | **livre** | registrado | Colide com o lesto.run, framework operado por CLI — mesmo público, colisão pior que a da Komodo |
| Fresta, Atalho, Aro | ocupados | registrados | Nenhuma vantagem sobre Tecla |
| Trupe, Naipe, Coro, Liga | ocupados | livres | Coro colide com a Coro, cibersegurança com US$ 255M captados |
| **Moductus** ✅ | **livre** | **livre** | — |

Moductus passa limpo em tudo: handle do GitHub, `.dev`, `.app`, `.com`, `.io`, nenhum pacote no winget e **zero resultado de busca na web**. A grafia próxima mais relevante é a MODUCT, marca japonesa de roupa reconstruída, sem interseção de setor.

### O que se perdeu, conscientemente

**São 8 letras, e o critério dizia 4 a 6.** O limite foi relaxado de propósito, não por descuido. Ele existia para manter curtos o nome de pasta, o id do winget e o que se digita — `moductus` é mais longo e não encurta para nenhum apelido natural.

**O nome deixou de carregar a interação.** O argumento que fazia Tecla vencer era nomear o *modelo de interação* em vez da aparência, e é a interação que separa o produto do PowerToys. Moductus nomeia a arquitetura, que é um fato interno: ninguém escolhe uma suíte por ela ser modular.

**A tagline assume esse trabalho sozinha.** *"Tudo a uma tecla de distância"* continua verdadeira e passa a ser a única portadora do argumento de interação. Isso a torna obrigatória no topo do README, não decorativa.

**Ponto em aberto — o mark.** O keycap da seção 7 foi escolhido por ser coerente com o nome "Tecla". Ele continua coerente com a tagline e com a tecla líder, mas não é mais derivado do nome. Decidir se permanece ou se cede lugar a algo que evoque módulos unidos, antes de desenhar os 16px.
