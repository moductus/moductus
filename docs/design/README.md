# Design — fontes do canvas

Fontes dos desenhos do canvas [Moductus — identidade visual](https://claude.ai/artifact/8im3xVzwsYkKuTocTiDfXZ), guardadas aqui para versionar junto com o produto. Os tokens que saem deles estão em [../DESIGN.md](../DESIGN.md).

| Arquivo | O que mostra |
|---|---|
| `canvas/Main.dc.html` | Tema Grafite: dock colado na borda e painel Hoje |
| `canvas/Papel.dc.html` | Tema Papel: dock flutuante e painel Hoje |
| `canvas/Vidro.dc.html` | Tema Vidro: dock e painel translúcidos |
| `canvas/Sistema.dc.html` | Janela Sistema · Início, com seletor dos três temas |
| `canvas/Agentes.dc.html` | Painel Agentes: o time do Moductus e as sessões de IA por projeto, com aprovação |
| `canvas/Midia.dc.html` | Painel Mídia, controles (microfone, manter acordado, volume) e apps abertos |
| `canvas/Captura.dc.html` | Captura rápida transformando uma frase num gasto |
| `canvas/Marca.dc.html` | Quatro opções de marca em fundo escuro e claro, de 104 a 16 px |
| `canvas/Dock.dc.html` | Componente do dock, com tema e item ativo, usado pelos painéis |
| `canvas/Time.dc.html` | Os quatro agentes (Alba, Tula, Faina, Nuno) como personagens, com as expressões de cada estado e o esboço de criar um agente |
| `canvas/Personagem.dc.html` | Componente do personagem: agente, expressão, corpo inteiro ou só a cabeça, tamanho |
| `canvas/Uso1Boas.dc.html` a `canvas/Uso5Conexoes.dc.html` | Primeiro uso: boas-vindas, tema e dock, modelo, conhecer o time, conexões |
| `canvas/Tutorial.dc.html` | "Primeiros passos" no Início, com o cartão de aprovação de treino |
| `canvas/Briefing.dc.html`, `canvas/Fechamento.dc.html` | Briefing da manhã e fechamento do dia |
| `canvas/PainelFoco.dc.html`, `PainelFinancas`, `PainelDev`, `PainelArquivos` | Painéis do dock de cada agente |
| `canvas/Estados.dc.html` | Estados do agente: sem modelo, erro, teto de gasto, vazio, conexão caída, pausado |
| `canvas/Conversas.dc.html` | Conversa com o time, com aprovação no meio da conversa |
| `canvas/ExtratoColunas.dc.html`, `canvas/ExtratoRevisar.dc.html` | Importar extrato de banco sem perfil e revisar antes de lançar |
| `canvas/PreviaFaina.dc.html` | Prévia da Faina antes de organizar uma pasta |
| `canvas/OutroPC.dc.html`, `canvas/AreaNotificacoes.dc.html` | Configurações: levar para outro PC e notificações |
| `canvas/AreaTarefas.dc.html`, `AreaFinancas`, `AreaNotas`, `AreaSessoes`, `AreaDev`, `AreaMemoria`, `AreaAgente` | Áreas do Sistema e a página de um agente |
| `canvas/canvas.json` | Disposição dos quadros no canvas |
| `marca/` | Ícone do app (`.ico` e PNG), ícones da bandeja e a marca em SVG |

Os arquivos `.dc.html` usam o formato do Claude Design e dependem do runtime do canvas (`support.js`), então não abrem sozinhos no navegador. Para ver e editar, use o link do canvas; para mudar o desenho, edite lá e atualize estas cópias.
