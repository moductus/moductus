# Moductus — Design

> O sistema visual do Moductus: três temas sobre a mesma estrutura. O produto está em [PRODUCT.md](PRODUCT.md); os desenhos vivem no canvas [Moductus — identidade visual](https://claude.ai/artifact/8im3xVzwsYkKuTocTiDfXZ), com cópia das fontes em [design/](design/).

**Status:** fase 0. Os valores abaixo saem dos desenhos do canvas e são a fonte dos tokens quando o código começar.

---

## 1. Princípio

**A estrutura é uma só; o tema troca a pele.** O dock, os painéis e o Sistema têm o mesmo layout, os mesmos componentes e o mesmo comportamento em qualquer tema. O que muda:

- cores e materiais (sólido ou vidro);
- raios;
- par de fontes;
- forma padrão do dock (colado na borda ou flutuante).

Nenhum componente conhece o nome do tema. Ele lê tokens, e o tema é só um conjunto de valores para esses tokens.

Regras que valem para os três:

- Sóbrio: **uma** cor de destaque por tema, e cor de status (sucesso, aviso, perigo) só onde há status.
- Dois pesos de fonte: 400 e 600.
- Números (tempo, dinheiro, contagem) e atalhos na fonte mono.
- Elevação por borda de 1 px + uma sombra suave. Nunca sombras empilhadas.
- Animação: entrada até 140 ms, saída até 90 ms, nada acima de 200 ms; duração zero quando o Windows pede menos animação.
- Ícones de traço único, 1,6 px, no mesmo conjunto.
- Texto com contraste mínimo de 4,5:1; status nunca só por cor (sempre acompanhado de texto ou forma).

---

## 2. Os temas

| | Grafite | Papel | Vidro |
|---|---|---|---|
| **Clima** | Escuro, monocromático, denso | Claro, calmo, papel e tinta | Translúcido, integrado ao Windows 11 |
| **Modo** | Escuro | Claro | Escuro |
| **Material** | Sólido | Sólido | Vidro fosco (desfoque) com fallback sólido |
| **Dock padrão** | Colado na borda | Flutuante | Flutuante |
| **Fonte** | Geist | Instrument Sans | Onest |
| **Mono** | Geist Mono | JetBrains Mono | IBM Plex Mono |

As fontes vão empacotadas no app (todas têm licença OFL); nada é baixado em tempo de execução.

**Seguir o Windows:** a configuração "Automático" usa um tema escuro e um claro conforme o modo do sistema. Padrão: Grafite no escuro, Papel no claro.

---

## 3. Tokens

### Cor

| Token | Uso | Grafite | Papel | Vidro |
|---|---|---|---|---|
| `fundo.dock` | Dock | `#0D0E10` | `#FBFAF8` | `rgba(20,23,31,0.55)` + desfoque |
| `fundo.janela` | Painel e janela do Sistema | `#131417` | `#FFFFFF` | `rgba(18,21,29,0.62)` + desfoque |
| `fundo.lateral` | Barra lateral do Sistema | `#0D0E10` | `#F6F5F2` | `rgba(0,0,0,0.16)` |
| `fundo.cartao` | Cartões | `#16181B` | `#FFFFFF` | `rgba(255,255,255,0.05)` |
| `fundo.elevado` | Bloco em destaque (foco, briefing) | `#1A1C20` | `#F6F5F2` | `rgba(255,255,255,0.07)` |
| `fundo.campo` | Campos de texto | `#0F1012` | `#FFFFFF` | `rgba(0,0,0,0.18)` |
| `fundo.chip` | Atalho, código, seletor | `rgba(255,255,255,0.06)` | `#EFEEEA` | `rgba(255,255,255,0.08)` |
| `fundo.ativo` | Item selecionado | `rgba(255,255,255,0.08)` | `#EAE8E3` | `rgba(255,255,255,0.10)` |
| `fundo.trilho` | Fundo de barra de progresso | `rgba(255,255,255,0.08)` | `#E6E4DF` | `rgba(255,255,255,0.10)` |
| `borda` | Divisória e contorno | `rgba(255,255,255,0.07)` | `rgba(20,20,19,0.08)` | `rgba(255,255,255,0.09)` |
| `borda.forte` | Botão secundário, foco | `rgba(255,255,255,0.14)` | `rgba(20,20,19,0.16)` | `rgba(255,255,255,0.18)` |
| `texto` | Texto principal | `#E8E9EB` | `#1A1A18` | `#EEF0F6` |
| `texto.2` | Texto de apoio | `#B5B8BD` | `#3E3D39` | `#C4C9D4` |
| `texto.3` | Rótulos e metadados | `#8C9097` | `#6B6A64` | `#9AA1B1` |
| `texto.apagado` | Concluído, desativado | `#6F737A` | `#8A8983` | `#7C8394` |
| `destaque` | Ação primária, progresso, marca | `#E8E9EB` | `#1A1A18` | `#A3B5FF` |
| `sobre.destaque` | Texto sobre o destaque | `#0D0E10` | `#FBFAF8` | `#10131C` |
| `sucesso` | Trabalhando, dentro do orçamento | `#7FB89E` | `#2F7A52` | `#7CCBA2` |
| `aviso` | Esperando você, perto do limite | `#E3B262` | `#B5761A` | `#E8B86A` |
| `perigo` | Erro, estourou | `#E5787A` | `#B4443C` | `#F08A8A` |

### Forma

| Token | Grafite | Papel | Vidro |
|---|---|---|---|
| `raio.janela` | 10 | 14 | 16 |
| `raio.painel` | 12 | 16 | 18 |
| `raio.cartao` | 10 | 14 | 14 |
| `raio.controle` | 8 | 10 | 10 |
| `raio.botao` | 8 | pílula (17) | 10 |
| `raio.caixa` (checkbox) | 4 | círculo | 5 |
| `sombra.painel` | `0 24px 48px rgba(0,0,0,0.45)` | `0 16px 40px rgba(40,36,28,0.12)` | nenhuma (o vidro separa) |
| `desfoque` | — | — | `blur(28–40px) saturate(140%)` |

### Escala comum aos três

- **Espaço** (grade de 4): 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 32.
- **Tipo:** 11 (meta, atalho), 12 (rótulo), 13 (corpo), 17–22 (título de painel), 26 (título do Sistema), 30–36 (número grande, mono).
- **Dock:** 64–68 px de largura; botões de 44 × 44; badge de 16 px.
- **Painel lateral:** 368–372 px de largura.

---

## 4. Vidro sem sustos

- O desfoque usa o efeito nativo de janela do Windows 11 (Acrylic), não CSS sobre captura de tela.
- **Windows 10, economia de bateria ou "efeitos de transparência" desligados:** o Vidro cai para um fundo sólido `#1B1F2B` com os mesmos tokens de texto e destaque.
- O contraste é medido contra o pior caso do papel de parede (claro e saturado); se não passar, a opacidade do fundo sobe.

---

## 5. O que está desenhado

| Superfície | Grafite | Papel | Vidro |
|---|---|---|---|
| Dock + painel Hoje | ✓ | ✓ | ✓ |
| Sistema · Início | ✓ (troca de tema no próprio desenho) | ✓ | ✓ |
| Painel Agentes: time e sessões de IA, com aprovação | ✓ (tweak de tema) | ✓ | ✓ |
| Painel Mídia, controles e apps abertos | ✓ (tweak de tema) | ✓ | ✓ |
| Captura rápida | ✓ (tweak de tema) | ✓ | ✓ |
| Componente Dock, reutilizado pelos painéis | ✓ | ✓ | ✓ |
| Marca: quatro opções (Trilho, Coluna, Borda e ponto, M modular) | — | — | — |
| Agentes: identidade, estados e criar agente | ✓ (tweak de tema) | ✓ | ✓ |

O cartão de aprovação traz três ações: **Negar**, **Sempre neste projeto** e **Permitir**. A do meio vira uma regra de permissão do Claude Code para aquele projeto, registrada pelo hook.

**A desenhar:** painéis de Foco, Finanças e Dev no dock, as demais áreas do Sistema, estados do agente (vazio, erro, sem modelo), configurações de tema e dock, e a marca escolhida (a atual é provisória).

---

## 6. Agentes

Cada agente é um **glifo geométrico dentro de um quadrado arredondado**. O glifo usa o traço dos ícones (1,6 px a 20 px) e precisa ler a 16 px; o tom é a única cor de identidade e aparece só no fundo do quadrado e no glifo. O resto da interface continua nos tokens do tema.

| Agente | Glifo | Tom no escuro (Grafite, Vidro) | Tom no claro (Papel) |
|---|---|---|---|
| **Alba** | Meio sol nascendo sobre uma linha | `#D9A55A` | `#9A6A1E` |
| **Lastro** | Três barras empilhadas, a de cima mais curta | `#6FAE8C` | `#2F7A52` |
| **Faina** | Dois blocos se encaixando em ângulo | `#D2805E` | `#A34E2E` |
| **Vigia** | Ponto central com dois arcos de radar | `#7C9CD6` | `#3F64A8` |

- **Quadrado:** raio de 30% do lado; fundo no tom a 14% de opacidade no escuro e 16% no claro.
- **Tamanhos:** 16 (lista densa), 24 (dock), 32 (painel), 56 (cabeçalho do agente no Sistema).
- **Estados:** anel de 2 px a 2 px de distância do quadrado. `trabalhando`: arco de 90° girando em 1,6 s, parado quando o Windows pede menos animação. `esperando você`: anel cheio em `aviso`. `erro`: anel tracejado em `perigo`. `desligado`: quadrado e glifo a 40%. A legenda de texto acompanha sempre.
- **Agentes do usuário:** escolhem glifo e tom de uma biblioteca fechada (12 glifos, 8 tons), para que nenhum agente novo quebre a sobriedade do conjunto.
