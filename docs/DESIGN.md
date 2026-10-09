# Moductus — Design

> O sistema visual do Moductus: três temas sobre a mesma estrutura. O produto está em [PRODUCT.md](PRODUCT.md); os desenhos vivem no canvas [Moductus — identidade visual](https://claude.ai/artifact/8im3xVzwsYkKuTocTiDfXZ), com cópia das fontes em [design/](design/).

**Status:** em uso desde a fase 1. Os valores abaixo saem dos desenhos do canvas e são a fonte dos tokens em `src/tokens/`.

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
- Texto com contraste mínimo de 4,5:1; status nunca só por cor (sempre acompanhado de texto ou forma). No Papel, `texto.3` e `aviso` ficaram um tom abaixo do canvas (`#6B6A64` e `#B5761A`) para passar sobre `fundo.ativo` e como texto de selo; `src/tokens/acessibilidade.test.ts` mede todos os pares.
- Foco do teclado: anel de 2 px no token `--cor-foco` (o destaque do tema, 3:1 ou mais sobre todo fundo) em todo elemento interativo; no dock o anel fica por dentro do botão.
- Alto contraste do Windows (`forced-colors`): cores do sistema; item atual, opção marcada e foco em `Highlight` (`src/tokens/alto-contraste.css`). Personagens e prévias de tema mantêm as próprias cores, como imagem.

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
| `texto.3` | Rótulos e metadados | `#8C9097` | `#686761` | `#9AA1B1` |
| `texto.apagado` | Concluído, desativado | `#6F737A` | `#8A8983` | `#7C8394` |
| `destaque` | Ação primária, progresso, marca | `#E8E9EB` | `#1A1A18` | `#A3B5FF` |
| `sobre.destaque` | Texto sobre o destaque | `#0D0E10` | `#FBFAF8` | `#10131C` |
| `sucesso` | Trabalhando, dentro do orçamento | `#7FB89E` | `#2F7A52` | `#7CCBA2` |
| `aviso` | Esperando você, perto do limite | `#E3B262` | `#96600F` | `#E8B86A` |
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
| Marca: quatro opções, com a **C · Borda e ponto** escolhida e aplicada em todos os desenhos | ✓ | ✓ | ✓ |
| Agentes: personagens, expressões e criar agente | ✓ (tweak de tema) | ✓ | ✓ |
| Componente Personagem (agente, expressão, corpo ou cabeça) | ✓ | ✓ | ✓ |
| Primeiro uso: boas-vindas, tema e dock, modelo, conhecer o time, conexões | ✓ (tweak de tema) | ✓ | ✓ |
| Tutorial "Primeiros passos" no Início, com cartão de aprovação de treino | ✓ (tweak de tema) | ✓ | ✓ |
| Briefing da manhã e fechamento do dia | ✓ (tweak de tema) | ✓ | ✓ |
| Painéis do dock: Foco, Finanças, Dev, Arquivos | ✓ (tweak de tema) | ✓ | ✓ |
| Estados do agente: sem modelo, erro, teto de gasto, vazio, conexão caída, pausado | ✓ (tweak de tema) | ✓ | ✓ |
| Conversa com o time | ✓ (tweak de tema) | ✓ | ✓ |
| Importar extrato: mapear colunas e revisar antes de lançar | ✓ (tweak de tema) | ✓ | ✓ |
| Prévia da Faina antes de organizar | ✓ (tweak de tema) | ✓ | ✓ |
| Sistema: Tarefas, Finanças, Notas, Sessões de IA, Dev, Memória, página do agente | ✓ (tweak de tema) | ✓ | ✓ |
| Configurações: notificações e levar para outro PC | ✓ (tweak de tema) | ✓ | ✓ |

O cartão de aprovação traz três ações: **Negar**, **Sempre neste projeto** e **Permitir**. A do meio vira uma regra de permissão do Claude Code para aquele projeto, registrada pelo hook.

Padrões que saíram dessas telas e valem para o resto:

- **Aprovação:** cartão elevado com o que vai acontecer, o tamanho e se dá para desfazer; botão primário é verbo com objeto ("Organizar 142 arquivos"), o secundário recusa sem culpa ("Não mover", "Agora não").
- **Fala do agente:** cabeça do personagem (20 a 30 px) + nome na cor de identidade + até duas frases; ação logo abaixo, nunca num modal.
- **Origem:** todo item criado por agente diz quem e de onde ("Tula leu o extrato", "você, pela captura").
- **Status nunca só por cor:** ponto + texto ("esperando você", "CI falhou").
- **Seleção:** caixa marcada no destaque com ✓; tarefa feita fica apagada e riscada.
- **Configurações:** sub-navegação própria à esquerda; cada seção numa página.

**A desenhar:** Foco e Ferramentas no Sistema, instruções e ferramentas na página do agente, criar agente (fase 7), demais seções de Configurações (Geral, Modelos, Conexões, Atalhos, Privacidade) e o instalador.

**Ícones da marca:** em [design/marca/](design/marca/): `moductus.ico` (16 a 256 px, Grafite), `app-*.png` (32 a 512), ícones da bandeja claro e escuro (16 e 32) e `marca.svg` em `currentColor`.

---

## 6. Agentes

Cada agente é um **personagem**: corpo, rosto e um traço próprio. Formas simples e cores chapadas, sem contorno, para ler bem de 16 px a corpo inteiro. O tom do agente é a única cor de identidade; o resto da interface continua nos tokens do tema. Componente de referência: `design/canvas/Personagem.dc.html`.

| Agente | Silhueta | Traço | Corpo | Sombra (braços) | Acessório |
|---|---|---|---|---|---|
| **Alba** | Ovo | Três raios de sol | `#E2B26A` | `#C9974D` | `#A9762A` |
| **Tula** | Pera | Coque e óculos redondos | `#86BC9C` | `#6CA283` | `#3F7F5C` |
| **Faina** | Bloco arredondado | Bandana com nó | `#DE9070` | `#C67757` | `#A24F37` |
| **Nuno** | Cápsula alta | Fones de ouvido | `#8FAADE` | `#7590C6` | `#46639F` |

- **Rosto:** olhos e boca em `#1C1D20`, bochechas em branco a 22%. As cores do personagem não mudam com o tema: ele é o mesmo em Grafite, Papel e Vidro.
- **Expressões = estados:**

| Estado | Expressão | Moldura (cabeça em lista) |
|---|---|---|
| `ocioso` | Descansando: olhos normais, sorriso leve | Nenhuma |
| `trabalhando` | Focado: olhos baixos, boca reta, sobrancelhas concentradas | Anel em `sucesso` |
| `esperando você` | Atento: olhos grandes, sobrancelhas erguidas, boca em "o" | Anel em `aviso` |
| `erro` | Preocupado: sobrancelhas caídas, boca para baixo | Anel tracejado em `perigo` |
| `desligado` | Dormindo: olhos fechados e "z" | Nenhuma, a 55% |

- **Tamanhos:** cabeça a 16, 24 e 32 px (listas e dock) e 36 px (painéis); corpo inteiro a 168 px nos cartões e na página do agente.
- **Movimento:** respiração de 4,2 s e piscar a cada 5,5 s. Tudo para com `prefers-reduced-motion`. Nada de pulos, confetes ou balões de fala.
- **Agentes do usuário:** montados de peças fechadas (4 silhuetas, 8 traços, 8 tons), para o time continuar coerente.

---

## 7. Marca

**Borda e ponto:** uma linha vertical com um ponto ao lado, no alto. A linha é o dock na lateral da tela; o ponto é um agente presente, pronto para trabalhar.

Geometria num quadrado de lado `L`:

| Elemento | Posição | Tamanho | Raio |
|---|---|---|---|
| Linha | `x = 0,24 L`, de `y = 0,04 L` a `y = 0,96 L` | largura `0,15 L` | metade da largura |
| Ponto | `x = 0,50 L`, `y = 0,08 L` | diâmetro `0,32 L` | círculo |

- **Cor:** uma só, sempre. `destaque` do tema na interface (claro no Grafite, tinta no Papel, lavanda no Vidro); preto ou branco puro fora do app.
- **Tamanhos testados:** 104, 48, 32 e 16 px, em fundo claro e escuro. A 16 px a linha tem 2,4 px e o ponto 5 px, e continua legível na bandeja.
- **Área de respiro:** `0,25 L` em volta, sem texto nem borda encostando.
- **Com o nome:** marca à esquerda, "Moductus" em peso 600 com espaçamento de −0,02 em, altura do texto em 90% da marca.
- **Não fazer:** contorno, sombra, gradiente, rotação, trocar a ordem dos elementos ou colocar o ponto embaixo.
