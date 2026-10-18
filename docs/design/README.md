# Design — fontes do canvas

Fontes dos desenhos do canvas [Moductus — identidade visual](https://claude.ai/artifact/8im3xVzwsYkKuTocTiDfXZ), guardadas aqui para versionar junto com o produto. Os tokens que saem deles estão em [../DESIGN.md](../DESIGN.md).

| Arquivo | O que mostra |
|---|---|
| `canvas/Main.dc.html` | Tema Grafite: dock colado na borda e painel Hoje, com um lembrete tocando no topo |
| `canvas/Papel.dc.html` | Tema Papel: dock flutuante e painel Hoje |
| `canvas/Vidro.dc.html` | Tema Vidro: dock e painel translúcidos |
| `canvas/Sistema.dc.html` | Janela Sistema · Início, com seletor dos três temas |
| `canvas/Agentes.dc.html` | Painel Agentes: o time do Moductus e as sessões de IA por projeto, com aprovação |
| `canvas/Midia.dc.html` | Painel Mídia, controles (microfone, manter acordado, volume) e apps abertos |
| `canvas/Captura.dc.html` | Captura rápida transformando uma frase num gasto |
| `canvas/Marca.dc.html` | Quatro opções de marca em fundo escuro e claro, de 104 a 16 px |
| `canvas/Dock.dc.html` | Componente do dock, com tema e item ativo, usado pelos painéis |
| `canvas/Time.dc.html` | Os quatro agentes (Alba, Tula, Faina, Nuno) como personagens, com as expressões de cada estado e o esboço de criar um agente |
| `canvas/Personagem.dc.html` | Componente do personagem: agente, expressão, corpo inteiro ou só a cabeça, tamanho; na cabeça, o recorte da Faina começa 3 unidades à direita para o nó da bandana caber inteiro |
| `canvas/Uso1Boas.dc.html` a `canvas/Uso5Conexoes.dc.html` | Primeiro uso: boas-vindas, tema e dock, modelo, conhecer o time, conexões; no passo 5, o Google Agenda conectado com os calendários marcados, e pastas e extrato marcados "chega com Arquivos" e "chega com Finanças" |
| `canvas/Tutorial.dc.html` | "Primeiros passos" no Início, com o cartão de aprovação de treino |
| `canvas/TutorialTour.dc.html` | O tour curto em quatro paradas (dock, um painel, o Sistema, a captura rápida) e os Primeiros passos desta versão, com as missões que ainda não valem em "Chegam depois" |
| `canvas/Briefing.dc.html`, `canvas/Fechamento.dc.html` | Briefing da manhã e fechamento do dia |
| `canvas/PainelFoco.dc.html`, `PainelFinancas`, `PainelDev`, `PainelArquivos` | Painéis do dock de cada agente |
| `canvas/PainelTarefas.dc.html`, `canvas/PainelNotas.dc.html` | Painéis Tarefas (adicionar por frase, atrasadas, hoje, marcar com desfazer) e Notas (nota fixa editável, busca e recentes), em 400 px |
| `canvas/LembreteHoje.dc.html` | O lembrete no painel Hoje: chegando, tocando (Adiar 10 min e Feito, também no aviso do Windows) e atrasados agrupados na volta da suspensão |
| `canvas/Estados.dc.html` | Estados do agente: sem modelo, erro, teto de gasto, vazio, conexão caída, pausado |
| `canvas/Conversas.dc.html` | Conversa com o time, com aprovação no meio da conversa |
| `canvas/ExtratoColunas.dc.html`, `canvas/ExtratoRevisar.dc.html` | Importar extrato de banco sem perfil e revisar antes de lançar |
| `canvas/PreviaFaina.dc.html` | Prévia da Faina antes de organizar uma pasta |
| `canvas/OutroPC.dc.html`, `canvas/AreaNotificacoes.dc.html` | Configurações: levar para outro PC e notificações |
| `canvas/ConfigModelos.dc.html`, `ConfigModelosAgente`, `ConfigModelosVazio` | Configurações › Modelos: provedores com testar, estado e tempo de resposta (um testando, um com erro), principal e reserva por agente, teto por dia com a moeda pendente, trocar o modelo de um agente e nenhum conectado |
| `canvas/ConfigConexoes.dc.html`, `ConfigConexoesPrevia`, `ConfigConexoesErros`, `ConfigConexoesVazio` | Configurações › Conexões: Claude Code e GitHub ligados, prévia do `settings.json` antes e depois com consentimento, GitHub conectando, erros (JSON inválido, `gh` sem login), nenhuma ligada; OpenCode "em breve" |
| `canvas/ConfigConexoesGoogle.dc.html`, `ConfigConexoesGoogleAutorizar`, `ConfigConexoesGoogleEstados` | Configurações › Conexões › Google Agenda: conectado, com o calendário "Moductus" criado e os calendários que a Alba lê; antes de conectar, o que ela pode fazer e o que sai do PC, com o aviso de app não verificado; abrindo o navegador, prazo, reconectar, sem rede, usar o próprio cliente e desconectar |
| `canvas/ConfigDia.dc.html` | Configurações › O dia: dias de trabalho e fuso, briefing na primeira atividade ou em horário fixo, hora de parar, expediente e ciclos do foco |
| `canvas/AreaTarefas.dc.html`, `AreaFinancas`, `AreaNotas`, `AreaSessoes`, `AreaDev`, `AreaMemoria`, `AreaAgente` | Áreas do Sistema e a página de um agente, com "Restaurar padrão" e a confirmação aberta |
| `canvas/AreaFoco.dc.html`, `AreaFocoEstados`, `AreaFocoVazio` | Sistema · Foco: ciclo rodando com a tarefa ligada, etapas da rodada, hoje, semana e relatório por tarefa; em pausa, ciclo terminado, na pausa e rodada completa; nenhum ciclo ainda |
| `canvas/DetalheTarefa.dc.html`, `DetalheEvento`, `DetalheEventoLeitura` | Detalhe de tarefa (todos os campos, origem, espelho no "Moductus", apagar) e de evento ao lado da agenda do dia; evento de outro calendário só leitura, com "Pedir à Alba para mudar" e o cartão de aprovação |
| `canvas/InicioEditar.dc.html` | Início no modo de editar blocos: ordenar por arraste ou teclado, esconder e mostrar |
| `canvas/canvas.json` | Disposição dos quadros no canvas |
| `marca/` | Ícone do app (`.ico` e PNG), ícones da bandeja e a marca em SVG |

Os arquivos `.dc.html` usam o formato do Claude Design e dependem do runtime do canvas (`support.js`), então não abrem sozinhos no navegador. Para ver e editar, use o link do canvas; para mudar o desenho, edite lá e atualize estas cópias.
