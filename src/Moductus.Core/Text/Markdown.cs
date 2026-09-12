namespace Moductus.Core.Text;

/// <summary>
/// O que cada trecho de uma linha é. Combinável porque negrito dentro de
/// citação existe, e o marcador de um par continua sendo marcador.
/// </summary>
[Flags]
public enum MarkdownEstilo
{
    Nenhum = 0,

    /// <summary>Conteúdo entre <c>**</c> ou <c>__</c>.</summary>
    Negrito = 1,

    /// <summary>Conteúdo entre <c>*</c> ou <c>_</c>.</summary>
    Italico = 2,

    /// <summary>Conteúdo entre <c>~~</c>.</summary>
    Riscado = 4,

    /// <summary>Conteúdo entre crases, ou linha dentro de cerca.</summary>
    Mono = 8,

    /// <summary>A sintaxe em si: <c>#</c>, <c>**</c>, crase, colchete. Fica discreta.</summary>
    Marcador = 16,

    /// <summary>O rótulo de um link, entre colchetes.</summary>
    Link = 32,

    /// <summary>Marcador que merece a cor de destaque: bala de lista, caixa de tarefa.</summary>
    Destaque = 64,
}

/// <summary>O que a linha inteira é. Decide tamanho, peso e fundo do parágrafo.</summary>
public enum MarkdownBloco
{
    Paragrafo,
    Titulo,
    Citacao,
    Lista,
    Regua,

    /// <summary>A linha de <c>```</c> que abre ou fecha um bloco de código.</summary>
    Cerca,

    /// <summary>Linha entre duas cercas.</summary>
    Codigo,
}

/// <summary>Um pedaço contíguo de uma linha com um estilo só.</summary>
/// <param name="Inicio">Índice do primeiro caractere, dentro da linha.</param>
/// <param name="Comprimento">Quantos caracteres o trecho cobre.</param>
/// <param name="Estilo">Como esse pedaço deve ser pintado.</param>
public readonly record struct MarkdownTrecho(int Inicio, int Comprimento, MarkdownEstilo Estilo);

/// <summary>O realce de uma linha: o que ela é, e como cada pedaço dela se pinta.</summary>
/// <param name="Bloco">O papel da linha inteira.</param>
/// <param name="Nivel">1 a 6 quando <paramref name="Bloco"/> é título; zero fora disso.</param>
/// <param name="Trechos">Cobertura contígua da linha, do começo ao fim, sem buracos.</param>
public readonly record struct MarkdownLinha(
    MarkdownBloco Bloco,
    int Nivel,
    IReadOnlyList<MarkdownTrecho> Trechos);

/// <summary>
/// Realce de markdown linha a linha. Puro: string entra, trechos saem — quem
/// pinta é o módulo. Analisa uma linha por vez porque o Scratch reformata só o
/// parágrafo que o usuário mexeu, não o documento inteiro a cada tecla.
///
/// Não é um parser de markdown: não constrói árvore nem gera HTML. Só enxerga o
/// bastante para dar a cada pedaço da linha uma aparência, e o que não reconhece
/// vira texto comum em vez de erro.
/// </summary>
public static class Markdown
{
    private const int NivelMaximoDeTitulo = 6;
    private const int TracosParaRegua = 3;
    private const int CrasesParaCerca = 3;

    /// <summary>
    /// Lê uma linha. <paramref name="dentroDeCerca"/> vem de fora porque bloco
    /// de código atravessa linhas, e só quem percorre o documento sabe.
    /// </summary>
    public static MarkdownLinha Realcar(string linha, bool dentroDeCerca = false)
    {
        var trechos = new List<MarkdownTrecho>();

        if (EhCerca(linha))
        {
            Emitir(trechos, 0, linha.Length, MarkdownEstilo.Marcador | MarkdownEstilo.Mono);
            return new MarkdownLinha(MarkdownBloco.Cerca, 0, trechos);
        }

        if (dentroDeCerca)
        {
            Emitir(trechos, 0, linha.Length, MarkdownEstilo.Mono);
            return new MarkdownLinha(MarkdownBloco.Codigo, 0, trechos);
        }

        if (EhRegua(linha))
        {
            Emitir(trechos, 0, linha.Length, MarkdownEstilo.Marcador);
            return new MarkdownLinha(MarkdownBloco.Regua, 0, trechos);
        }

        var recuo = Recuo(linha);

        if (Titulo(linha, recuo) is var nivel and > 0)
        {
            // O recuo e a sequência de # até o espaço são sintaxe; o resto é texto.
            var fim = recuo + nivel;
            while (fim < linha.Length && linha[fim] == ' ')
            {
                fim++;
            }

            Emitir(trechos, 0, fim, MarkdownEstilo.Marcador);
            Inline(linha, fim, linha.Length, MarkdownEstilo.Nenhum, trechos);
            return new MarkdownLinha(MarkdownBloco.Titulo, nivel, trechos);
        }

        if (Citacao(linha, recuo) is var setas and > 0)
        {
            var fim = recuo + setas;
            if (fim < linha.Length && linha[fim] == ' ')
            {
                fim++;
            }

            Emitir(trechos, 0, fim, MarkdownEstilo.Marcador | MarkdownEstilo.Destaque);
            Inline(linha, fim, linha.Length, MarkdownEstilo.Nenhum, trechos);
            return new MarkdownLinha(MarkdownBloco.Citacao, 0, trechos);
        }

        if (Bala(linha, recuo) is var bala and > 0)
        {
            var fim = recuo + bala;
            while (fim < linha.Length && linha[fim] == ' ')
            {
                fim++;
            }

            Emitir(trechos, 0, fim, MarkdownEstilo.Destaque);

            // "- [ ] comprar pão": a caixa também é marcador, não texto da tarefa.
            var caixa = Caixa(linha, fim);
            if (caixa > 0)
            {
                var depois = fim + caixa;
                while (depois < linha.Length && linha[depois] == ' ')
                {
                    depois++;
                }

                Emitir(trechos, fim, depois - fim, MarkdownEstilo.Destaque);
                fim = depois;
            }

            Inline(linha, fim, linha.Length, MarkdownEstilo.Nenhum, trechos);
            return new MarkdownLinha(MarkdownBloco.Lista, 0, trechos);
        }

        Inline(linha, 0, linha.Length, MarkdownEstilo.Nenhum, trechos);
        return new MarkdownLinha(MarkdownBloco.Paragrafo, 0, trechos);
    }

    /// <summary>Três crases ou três tis abrem e fecham bloco de código.</summary>
    private static bool EhCerca(string linha)
    {
        var i = Recuo(linha);
        if (linha.Length - i < CrasesParaCerca)
        {
            return false;
        }

        var c = linha[i];
        return (c == '`' || c == '~') && linha[i + 1] == c && linha[i + 2] == c;
    }

    // ---- Blocos ---------------------------------------------------------------

    private static int Recuo(string linha)
    {
        var i = 0;
        while (i < linha.Length && (linha[i] == ' ' || linha[i] == '\t'))
        {
            i++;
        }

        return i;
    }

    /// <summary>Quantos <c>#</c> a linha abre, ou zero se não for título.</summary>
    private static int Titulo(string linha, int recuo)
    {
        var n = 0;
        while (recuo + n < linha.Length && linha[recuo + n] == '#')
        {
            n++;
        }

        if (n == 0 || n > NivelMaximoDeTitulo)
        {
            return 0;
        }

        // "#tag" não é título; "# " e "#" sozinho no fim da linha são.
        var depois = recuo + n;
        return depois == linha.Length || linha[depois] == ' ' ? n : 0;
    }

    private static int Citacao(string linha, int recuo)
    {
        var n = 0;
        while (recuo + n < linha.Length && linha[recuo + n] == '>')
        {
            n++;
        }

        return n;
    }

    /// <summary>Tamanho da bala de lista — <c>-</c>, <c>*</c>, <c>+</c>, <c>1.</c> — ou zero.</summary>
    private static int Bala(string linha, int recuo)
    {
        if (recuo >= linha.Length)
        {
            return 0;
        }

        var c = linha[recuo];

        if (c is '-' or '*' or '+')
        {
            // Exige o espaço: "-- nota" e "*ênfase*" não são itens de lista.
            return recuo + 1 < linha.Length && linha[recuo + 1] == ' ' ? 1 : 0;
        }

        var n = 0;
        while (recuo + n < linha.Length && char.IsAsciiDigit(linha[recuo + n]))
        {
            n++;
        }

        if (n == 0 || recuo + n >= linha.Length || linha[recuo + n] is not ('.' or ')'))
        {
            return 0;
        }

        return recuo + n + 1 < linha.Length && linha[recuo + n + 1] == ' ' ? n + 1 : 0;
    }

    /// <summary>Tamanho da caixa de tarefa em <c>[ ]</c> ou <c>[x]</c>, ou zero.</summary>
    private static int Caixa(string linha, int i)
    {
        if (i + 2 >= linha.Length || linha[i] != '[' || linha[i + 2] != ']')
        {
            return 0;
        }

        return linha[i + 1] is ' ' or 'x' or 'X' ? 3 : 0;
    }

    private static bool EhRegua(string linha)
    {
        var i = Recuo(linha);
        if (i >= linha.Length || linha[i] is not ('-' or '*' or '_'))
        {
            return false;
        }

        var c = linha[i];
        var n = 0;

        for (; i < linha.Length; i++)
        {
            if (linha[i] == c)
            {
                n++;
            }
            else if (linha[i] != ' ')
            {
                return false;
            }
        }

        return n >= TracosParaRegua;
    }

    // ---- Dentro da linha ------------------------------------------------------

    /// <summary>
    /// Varre <c>[inicio, fim)</c> emitindo trechos. Recursivo porque negrito
    /// carrega itálico dentro; código não, o que está entre crases é literal.
    /// </summary>
    private static void Inline(string s, int inicio, int fim, MarkdownEstilo herdado, List<MarkdownTrecho> saida)
    {
        var texto = inicio;
        var i = inicio;

        while (i < fim)
        {
            var consumido = Par(s, i, fim, herdado, saida, texto);

            if (consumido == 0)
            {
                i++;
                continue;
            }

            i += consumido;
            texto = i;
        }

        Emitir(saida, texto, fim - texto, herdado);
    }

    /// <summary>
    /// Tenta ler um par de delimitadores começando em <paramref name="i"/>.
    /// Devolve quantos caracteres consumiu, ou zero se ali não começa nada.
    /// Só emite o texto pendente quando encontra par de verdade.
    /// </summary>
    private static int Par(string s, int i, int fim, MarkdownEstilo herdado, List<MarkdownTrecho> saida, int textoPendente)
    {
        switch (s[i])
        {
            case '`':
                return Codigo(s, i, fim, herdado, saida, textoPendente);
            case '[':
                return Link(s, i, fim, herdado, saida, textoPendente);
            case '*' or '_' or '~':
                return Enfase(s, i, fim, herdado, saida, textoPendente);
            default:
                return 0;
        }
    }

    private static int Codigo(string s, int i, int fim, MarkdownEstilo herdado, List<MarkdownTrecho> saida, int textoPendente)
    {
        var f = s.IndexOf('`', i + 1);
        if (f < 0 || f >= fim)
        {
            return 0;
        }

        Emitir(saida, textoPendente, i - textoPendente, herdado);
        Emitir(saida, i, 1, herdado | MarkdownEstilo.Marcador | MarkdownEstilo.Mono);
        Emitir(saida, i + 1, f - i - 1, herdado | MarkdownEstilo.Mono);
        Emitir(saida, f, 1, herdado | MarkdownEstilo.Marcador | MarkdownEstilo.Mono);
        return f - i + 1;
    }

    private static int Link(string s, int i, int fim, MarkdownEstilo herdado, List<MarkdownTrecho> saida, int textoPendente)
    {
        var fechaRotulo = s.IndexOf(']', i + 1);
        if (fechaRotulo < 0 || fechaRotulo + 1 >= fim || s[fechaRotulo + 1] != '(')
        {
            return 0;
        }

        var fechaAlvo = s.IndexOf(')', fechaRotulo + 2);
        if (fechaAlvo < 0 || fechaAlvo >= fim)
        {
            return 0;
        }

        Emitir(saida, textoPendente, i - textoPendente, herdado);
        Emitir(saida, i, 1, herdado | MarkdownEstilo.Marcador);
        Inline(s, i + 1, fechaRotulo, herdado | MarkdownEstilo.Link, saida);
        Emitir(saida, fechaRotulo, fechaAlvo - fechaRotulo + 1, herdado | MarkdownEstilo.Marcador);
        return fechaAlvo - i + 1;
    }

    private static int Enfase(string s, int i, int fim, MarkdownEstilo herdado, List<MarkdownTrecho> saida, int textoPendente)
    {
        var c = s[i];
        var duplo = i + 1 < fim && s[i + 1] == c;

        // Til só vale dobrado: "~/pasta" é caminho, não texto riscado.
        if (c == '~' && !duplo)
        {
            return 0;
        }

        var estilo = (c, duplo) switch
        {
            ('~', _) => MarkdownEstilo.Riscado,
            (_, true) => MarkdownEstilo.Negrito,
            _ => MarkdownEstilo.Italico,
        };

        // Já estamos dentro desse estilo: o delimitador aqui é o fechamento de
        // quem nos chamou, não a abertura de outro par.
        if (herdado.HasFlag(estilo))
        {
            return 0;
        }

        // snake_case não é itálico. Sublinhado precisa de fronteira de palavra.
        if (c == '_' && i > 0 && !char.IsWhiteSpace(s[i - 1]) && !char.IsPunctuation(s[i - 1]))
        {
            return 0;
        }

        var tamanho = duplo ? 2 : 1;
        var miolo = i + tamanho;
        if (miolo >= fim || s[miolo] == ' ')
        {
            return 0;
        }

        var f = Fechamento(s, miolo, fim, c, tamanho);
        if (f < 0)
        {
            return 0;
        }

        Emitir(saida, textoPendente, i - textoPendente, herdado);
        Emitir(saida, i, tamanho, herdado | MarkdownEstilo.Marcador);
        Inline(s, miolo, f, herdado | estilo, saida);
        Emitir(saida, f, tamanho, herdado | MarkdownEstilo.Marcador);
        return f + tamanho - i;
    }

    /// <summary>Acha o delimitador que fecha, pulando o que está entre crases.</summary>
    private static int Fechamento(string s, int inicio, int fim, char c, int tamanho)
    {
        for (var i = inicio; i + tamanho <= fim; i++)
        {
            if (s[i] == '`')
            {
                var crase = s.IndexOf('`', i + 1);
                if (crase >= 0 && crase < fim)
                {
                    i = crase;
                    continue;
                }
            }

            if (s[i] != c || s[i - 1] == ' ')
            {
                continue;
            }

            // "**" fecha "**"; um asterisco só não fecha negrito.
            var seguinte = i + tamanho < fim && s[i + tamanho] == c;
            if (tamanho == 2 && s[i + 1] != c)
            {
                continue;
            }

            if (tamanho == 1 && seguinte)
            {
                continue;
            }

            return i;
        }

        return -1;
    }

    private static void Emitir(List<MarkdownTrecho> saida, int inicio, int comprimento, MarkdownEstilo estilo)
    {
        if (comprimento > 0)
        {
            saida.Add(new MarkdownTrecho(inicio, comprimento, estilo));
        }
    }
}
