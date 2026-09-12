using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using Moductus.Core.Text;

namespace Moductus.Modules.Scratch;

/// <summary>
/// Pinta markdown dentro de um <see cref="RichTextBox"/> enquanto se digita. O
/// documento é sempre uma pilha de parágrafos de uma linha cada, e o texto que
/// vai para o disco é a concatenação deles — o realce não deixa rastro no
/// arquivo.
///
/// Toda aparência sai de chave do Tokens.xaml por
/// <see cref="FrameworkContentElement.SetResourceReference"/>: mudar de tema ou
/// entrar em alto contraste repinta o que já está na tela.
/// </summary>
internal static class RealceMarkdown
{
    /// <summary>
    /// O que cada parágrafo já mostra. Fica no <see cref="FrameworkContentElement.Tag"/>
    /// do próprio parágrafo para evitar dicionário que segura parágrafo morto.
    /// </summary>
    private sealed record Estado(string Texto, bool DentroDeCerca, MarkdownLinha Linha);

    /// <summary>Lê o documento como texto puro, uma linha por parágrafo.</summary>
    public static string Ler(FlowDocument documento)
    {
        var sb = new StringBuilder();
        var primeiro = true;

        foreach (var paragrafo in documento.Blocks.OfType<Paragraph>())
        {
            // Fim de linha do Windows, que é o que o TextBox daqui gravava antes.
            // Trocar para LF reescreveria em CRLF um scratch.txt já existente
            // inteiro na primeira tecla — quem aponta o arquivo para uma pasta
            // versionada veria o diff do arquivo todo.
            if (!primeiro)
            {
                sb.Append(Environment.NewLine);
            }

            sb.Append(Texto(paragrafo));
            primeiro = false;
        }

        return sb.ToString();
    }

    /// <summary>Joga texto puro no documento, um parágrafo por linha, já realçado.</summary>
    public static void Escrever(FlowDocument documento, string texto)
    {
        documento.Blocks.Clear();

        var dentroDeCerca = false;

        foreach (var linha in texto.ReplaceLineEndings("\n").Split('\n'))
        {
            var paragrafo = new Paragraph();
            documento.Blocks.Add(paragrafo);
            dentroDeCerca = Aplicar(paragrafo, linha, dentroDeCerca, forcar: true);
        }
    }

    /// <summary>
    /// Repinta o documento. Passa por todos os parágrafos porque cerca de código
    /// atravessa linhas, e relê o texto de todos porque o Tag de um parágrafo
    /// viaja junto quando o WPF o parte em dois — quem acabou de nascer alega ter
    /// o conteúdo de quem lhe deu origem. Ler é barato; o que custa é refazer os
    /// Inlines, e isso só acontece onde o texto realmente mudou.
    /// </summary>
    public static void Reformatar(FlowDocument documento)
    {
        // Ler antes e de uma vez só, por dois motivos. Trocar os Inlines de um
        // parágrafo mexe no TextContainer, e o enumerador de Blocks morre no
        // passo seguinte com "a coleção foi modificada" — o que derruba o
        // processo, já que TextChanged não tem onde a exceção pousar. E reler o
        // documento depois de normalizar seria uma segunda varredura por tecla
        // digitada, quando quase sempre não há nada a normalizar.
        var linhas = Lidas(documento);

        if (Normalizar(documento, linhas))
        {
            linhas = Lidas(documento);
        }

        var dentroDeCerca = false;

        foreach (var (paragrafo, texto) in linhas)
        {
            dentroDeCerca = Aplicar(paragrafo, texto, dentroDeCerca, forcar: false);
        }
    }

    private static List<(Paragraph Paragrafo, string Texto)> Lidas(FlowDocument documento)
    {
        var linhas = new List<(Paragraph, string)>(documento.Blocks.Count);

        foreach (var paragrafo in documento.Blocks.OfType<Paragraph>())
        {
            linhas.Add((paragrafo, Texto(paragrafo)));
        }

        return linhas;
    }

    /// <summary>
    /// Deixa o documento na única forma que o resto daqui entende: uma pilha de
    /// parágrafos de uma linha cada.
    ///
    /// Quebra dentro do parágrafo vem de Shift+Enter e de certas colagens, e duas
    /// linhas num parágrafo só sairiam realçadas como uma. Bloco que não é
    /// parágrafo — lista, tabela, seção — vem de arrastar texto rico de outro
    /// programa para dentro do campo, e <see cref="Ler"/> o deixaria cair na
    /// hora de gravar: o que se vê na tela sumiria do arquivo.
    /// </summary>
    private static bool Normalizar(FlowDocument documento, List<(Paragraph Paragrafo, string Texto)> linhas)
    {
        var tortos = Tortos(documento, linhas);

        if (tortos is null)
        {
            return false;
        }

        foreach (var (bloco, texto) in tortos)
        {
            var anterior = bloco;

            foreach (var linha in texto.ReplaceLineEndings("\n").Split('\n'))
            {
                var novo = new Paragraph();
                documento.Blocks.InsertAfter(anterior, novo);
                Aplicar(novo, linha, dentroDeCerca: false, forcar: true);
                anterior = novo;
            }

            documento.Blocks.Remove(bloco);
        }

        return true;
    }

    /// <summary>
    /// Os blocos que precisam virar parágrafos de uma linha, ou null quando não
    /// há nenhum — que é o caso a cada tecla digitada, e por isso não aloca lista
    /// para dizer que está tudo em ordem.
    /// </summary>
    private static List<(Block Bloco, string Texto)>? Tortos(
        FlowDocument documento,
        List<(Paragraph Paragrafo, string Texto)> linhas)
    {
        List<(Block, string)>? tortos = null;
        var i = 0;

        foreach (var bloco in documento.Blocks)
        {
            // `linhas` só tem parágrafos, e na mesma ordem: o índice só avança
            // quando o bloco é um deles.
            var paragrafo = bloco as Paragraph;
            var texto = paragrafo is null ? TextoDoBloco(bloco) : linhas[i++].Texto;

            if (paragrafo is not null && !texto.Contains('\n') && !Estranho(paragrafo.Inlines))
            {
                continue;
            }

            // Parágrafo com conteúdo que Juntar não lê — uma imagem arrastada de
            // um navegador, por exemplo — sai daqui pelo TextRange, que ao menos
            // salva o texto em volta. Deixá-lo passar seria pior: Aplicar limpa
            // os Inlines na tecla seguinte e o que estava na tela some calado.
            if (paragrafo is not null && Estranho(paragrafo.Inlines))
            {
                texto = TextoDoBloco(bloco);
            }

            (tortos ??= []).Add((bloco, texto));
        }

        return tortos;
    }

    private static string TextoDoBloco(Block bloco)
        => bloco is Paragraph paragrafo
            ? Texto(paragrafo)
            : new TextRange(bloco.ContentStart, bloco.ContentEnd).Text;

    /// <summary>Onde o cursor está, em caracteres desde o começo do parágrafo.</summary>
    public static int Coluna(Paragraph paragrafo, TextPointer cursor)
        => new TextRange(paragrafo.ContentStart, cursor).Text.Length;

    /// <summary>
    /// Se o parágrafo sobreviveu a <see cref="Reformatar"/>. Normalizar troca um
    /// parágrafo partido por vários, e devolver o cursor a um parágrafo que já
    /// saiu do documento aponta para fora dele.
    /// </summary>
    public static bool Vive(Paragraph paragrafo, FlowDocument documento)
        => ReferenceEquals(paragrafo.Parent, documento);

    /// <summary>O ponto a tantos caracteres do começo do parágrafo, para devolver o cursor.</summary>
    public static TextPointer Ponto(Paragraph paragrafo, int coluna)
    {
        var restante = coluna;

        foreach (var corrido in paragrafo.Inlines.OfType<Run>())
        {
            if (restante <= corrido.Text.Length)
            {
                return corrido.ContentStart.GetPositionAtOffset(restante) ?? paragrafo.ContentEnd;
            }

            restante -= corrido.Text.Length;
        }

        return paragrafo.ContentEnd;
    }

    // ---- Um parágrafo ---------------------------------------------------------

    /// <summary>Pinta um parágrafo e devolve se a cerca continua aberta depois dele.</summary>
    private static bool Aplicar(Paragraph paragrafo, string texto, bool dentroDeCerca, bool forcar)
    {
        var antes = paragrafo.Tag as Estado;

        if (!forcar && antes is not null && antes.Texto == texto && antes.DentroDeCerca == dentroDeCerca)
        {
            return Depois(antes, dentroDeCerca);
        }

        var linha = Markdown.Realcar(texto, dentroDeCerca);
        var estado = new Estado(texto, dentroDeCerca, linha);

        if (!forcar && antes is not null && JaEstaBom(antes, estado))
        {
            paragrafo.Tag = estado;
            return Depois(estado, dentroDeCerca);
        }

        paragrafo.Tag = estado;
        Bloco(paragrafo, linha);

        paragrafo.Inlines.Clear();
        foreach (var trecho in linha.Trechos)
        {
            paragrafo.Inlines.Add(Corrido(texto.Substring(trecho.Inicio, trecho.Comprimento), trecho.Estilo));
        }

        return Depois(estado, dentroDeCerca);
    }

    /// <summary>
    /// Linha sem nenhuma marcação é um Run só, e o WPF já cresce o Run sozinho
    /// quando se digita nele — não há o que refazer.
    ///
    /// Linha com marcação é refeita a cada tecla, e refazer os Inlines é uma
    /// unidade de desfazer própria: ali o Ctrl+Z precisa de dois toques, o
    /// primeiro tira o realce e o segundo a digitação. O preço fica restrito à
    /// linha com marcação porque é este teste que tira a linha comum do caminho.
    /// </summary>
    private static bool JaEstaBom(Estado antes, Estado agora)
        => antes.Linha.Bloco == MarkdownBloco.Paragrafo
        && agora.Linha.Bloco == MarkdownBloco.Paragrafo
        && antes.Linha.Trechos.Count == 1
        && agora.Linha.Trechos.Count == 1
        && antes.Linha.Trechos[0].Estilo == MarkdownEstilo.Nenhum
        && agora.Linha.Trechos[0].Estilo == MarkdownEstilo.Nenhum;

    private static bool Depois(Estado? estado, bool dentroDeCerca)
        => estado?.Linha.Bloco == MarkdownBloco.Cerca ? !dentroDeCerca : dentroDeCerca;

    /// <summary>O que a linha inteira é: tamanho, peso, fundo. Sempre limpa antes.</summary>
    private static void Bloco(Paragraph paragrafo, MarkdownLinha linha)
    {
        // Uma linha deixa de ser título quando se apaga o "#": sem limpar, ela
        // ficaria grande para sempre.
        paragrafo.ClearValue(TextElement.FontSizeProperty);
        paragrafo.ClearValue(TextElement.FontWeightProperty);
        paragrafo.ClearValue(TextElement.FontFamilyProperty);
        paragrafo.ClearValue(TextElement.FontStyleProperty);
        paragrafo.ClearValue(TextElement.ForegroundProperty);
        paragrafo.ClearValue(TextElement.BackgroundProperty);

        // Parágrafo do WPF vem com espaço em cima e embaixo; aqui cada parágrafo
        // é uma linha de um arquivo de texto, e linha não tem margem.
        paragrafo.Margin = default;

        switch (linha.Bloco)
        {
            case MarkdownBloco.Titulo:
                paragrafo.SetResourceReference(TextElement.FontWeightProperty, "weight.semibold");
                paragrafo.SetResourceReference(TextElement.FontSizeProperty, TamanhoDeTitulo(linha.Nivel));
                break;

            case MarkdownBloco.Citacao:
                paragrafo.SetResourceReference(TextElement.ForegroundProperty, "text.secondary");
                paragrafo.FontStyle = FontStyles.Italic;
                break;

            case MarkdownBloco.Cerca:
            case MarkdownBloco.Codigo:
                paragrafo.SetResourceReference(TextElement.FontFamilyProperty, "font.mono");

                // bg.raised e não bg.hover: em alto contraste o hover é a cor de
                // seleção do sistema, e o texto, que segue em text.primary,
                // ficaria branco sobre ciano. O par raised/primary o Windows
                // garante legível nos dois temas de contraste.
                paragrafo.SetResourceReference(TextElement.BackgroundProperty, "bg.raised");
                break;

            case MarkdownBloco.Regua:
                paragrafo.SetResourceReference(TextElement.ForegroundProperty, "text.muted");
                break;
        }
    }

    /// <summary>
    /// A escala tipográfica do Tokens.xaml tem três degraus acima do corpo, e
    /// markdown tem seis níveis. Do terceiro para baixo só o peso separa.
    /// </summary>
    private static string TamanhoDeTitulo(int nivel) => nivel switch
    {
        1 => "type.title",
        2 => "type.body-lg",
        _ => "type.body",
    };

    private static Run Corrido(string texto, MarkdownEstilo estilo)
    {
        var corrido = new Run(texto);

        var riscos = new TextDecorationCollection();

        if (estilo.HasFlag(MarkdownEstilo.Destaque))
        {
            corrido.SetResourceReference(TextElement.ForegroundProperty, "accent");
        }
        else if (estilo.HasFlag(MarkdownEstilo.Marcador))
        {
            corrido.SetResourceReference(TextElement.ForegroundProperty, "text.muted");
        }
        else if (estilo.HasFlag(MarkdownEstilo.Link))
        {
            corrido.SetResourceReference(TextElement.ForegroundProperty, "accent");

            // Numa coleção, não atribuído: "[~~a~~](x)" é link e riscado ao mesmo
            // tempo, e quem atribuísse por último apagaria o outro.
            riscos.Add(TextDecorations.Underline);
        }

        if (estilo.HasFlag(MarkdownEstilo.Mono))
        {
            corrido.SetResourceReference(TextElement.FontFamilyProperty, "font.mono");
        }

        if (estilo.HasFlag(MarkdownEstilo.Negrito))
        {
            corrido.SetResourceReference(TextElement.FontWeightProperty, "weight.semibold");
        }

        if (estilo.HasFlag(MarkdownEstilo.Italico))
        {
            corrido.FontStyle = FontStyles.Italic;
        }

        if (estilo.HasFlag(MarkdownEstilo.Riscado))
        {
            riscos.Add(TextDecorations.Strikethrough);
        }

        if (riscos.Count > 0)
        {
            corrido.TextDecorations = riscos;
        }

        return corrido;
    }

    /// <summary>
    /// O texto de um parágrafo, lido dos Runs. <see cref="TextRange"/> daria o
    /// mesmo, mas serializa o trecho inteiro a cada chamada, e aqui isto roda
    /// para todo parágrafo do documento a cada tecla digitada.
    /// </summary>
    private static string Texto(Paragraph paragrafo)
    {
        if (paragrafo.Inlines.Count == 1 && paragrafo.Inlines.FirstInline is Run unico)
        {
            return unico.Text;
        }

        var sb = new StringBuilder();
        Juntar(paragrafo.Inlines, sb);
        return sb.ToString();
    }

    private static void Juntar(InlineCollection inlines, StringBuilder sb)
    {
        foreach (var inline in inlines)
        {
            switch (inline)
            {
                case Run corrido:
                    sb.Append(corrido.Text);
                    break;
                case LineBreak:
                    sb.Append('\n');
                    break;

                // Hyperlink chega por aqui, que é Span.
                case Span trecho:
                    Juntar(trecho.Inlines, sb);
                    break;

                // Floater e Figure guardam blocos inteiros de texto dentro.
                case AnchoredBlock ancorado:
                    foreach (var dentro in ancorado.Blocks.OfType<Paragraph>())
                    {
                        Juntar(dentro.Inlines, sb);
                    }

                    break;
            }
        }
    }

    /// <summary>
    /// Se há inline que <see cref="Juntar"/> não sabe ler — <c>InlineUIContainer</c>
    /// é o caso real, uma imagem solta no meio do texto. Serve para decidir se o
    /// parágrafo precisa ser refeito a partir do texto.
    /// </summary>
    private static bool Estranho(InlineCollection inlines)
    {
        foreach (var inline in inlines)
        {
            var esquisito = inline switch
            {
                Run or LineBreak or AnchoredBlock => false,
                Span trecho => Estranho(trecho.Inlines),
                _ => true,
            };

            if (esquisito)
            {
                return true;
            }
        }

        return false;
    }
}
