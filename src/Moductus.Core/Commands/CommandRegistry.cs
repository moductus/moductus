namespace Moductus.Core.Commands;

/// <summary>Uma ação que a Palette lista. <see cref="Hint"/> aparece à direita.</summary>
/// <param name="Primary">
/// Verdadeiro no resultado que <b>é</b> a resposta à consulta — a conta
/// resolvida. Vem antes de tudo, sem passar pelo ranking. Só provedor
/// dinâmico marca isto.
/// </param>
public sealed record PaletteCommand(
    string Id,
    string Text,
    string? Detail,
    string? Hint,
    Action Execute,
    bool Primary = false);

/// <summary>
/// Registro central de comandos da Palette. Host e módulos registram; a
/// Palette busca. É o que torna o hub extensível sem a Palette conhecer
/// ninguém.
/// </summary>
/// <remarks>
/// Há dois tipos de fonte. O <b>estático</b> é o comando conhecido de
/// antemão ("Abrir Ports"). O <b>provedor</b> é uma função consultada a cada
/// tecla, para o que só existe por causa do que foi digitado: a conta
/// resolvida, o app instalado, o arquivo achado.
/// </remarks>
public sealed class CommandRegistry
{
    private readonly List<(string Owner, PaletteCommand Command)> _comandos = [];
    private readonly List<(string Owner, Func<string, IEnumerable<PaletteCommand>> Provider)> _provedores = [];

    public IReadOnlyList<PaletteCommand> All => [.. _comandos.Select(c => c.Command).OrderBy(c => c.Text)];

    /// <summary>
    /// Os comandos de um dono só, na ordem em que ele registrou. O menu da
    /// bandeja usa isto para montar o submenu de cada módulo; a Palette
    /// continua vendo tudo junto, que é o ponto dela.
    /// </summary>
    public IReadOnlyList<PaletteCommand> Of(string owner) =>
        [.. _comandos.Where(c => c.Owner == owner).Select(c => c.Command)];

    public void Register(string owner, PaletteCommand command)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(owner);
        ArgumentNullException.ThrowIfNull(command);

        _comandos.RemoveAll(c => c.Command.Id == command.Id);
        _comandos.Add((owner, command));
    }

    public void Unregister(string owner) => _comandos.RemoveAll(c => c.Owner == owner);

    /// <summary>
    /// Registra uma fonte consultada a cada busca. Um dono tem um provedor
    /// só; registrar de novo substitui. A ordem de registro é o desempate
    /// entre provedores.
    /// </summary>
    public void RegisterProvider(string owner, Func<string, IEnumerable<PaletteCommand>> provider)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(owner);
        ArgumentNullException.ThrowIfNull(provider);

        _provedores.RemoveAll(p => p.Owner == owner);
        _provedores.Add((owner, provider));
    }

    public void UnregisterProvider(string owner) => _provedores.RemoveAll(p => p.Owner == owner);

    /// <summary>
    /// Ranking simples e previsível: prefixo do texto, depois início de
    /// palavra, depois qualquer trecho do texto, depois trecho do detalhe.
    /// Empate resolve por ordem alfabética. Sem fuzzy: o usuário digita
    /// três letras e precisa saber o que vai aparecer.
    /// </summary>
    /// <remarks>
    /// O resultado marcado como <see cref="PaletteCommand.Primary"/> vem
    /// antes de tudo. O resto dos resultados de provedor entra no mesmo
    /// ranking dos estáticos e ganha o empate, porque nasceu da consulta.
    /// Busca vazia abre com o que os provedores oferecem sem texto nenhum —
    /// para o lançador de aplicativos, o que se abriu por último — e só então
    /// os estáticos. Nessa ordem porque o valor de não abrir vazio é ver o que
    /// se usa no primeiro quadro; embaixo de uma dúzia de comandos não serviria
    /// de nada. Provedor que só sabe responder a uma consulta devolve nada
    /// aqui, que é o que calculadora e busca de arquivo já faziam.
    /// </remarks>
    public IReadOnlyList<PaletteCommand> Search(string? query)
    {
        var q = query?.Trim() ?? string.Empty;

        if (q.Length == 0)
        {
            return [.. Dinamicos(string.Empty), .. All];
        }

        var dinamicos = Dinamicos(q);

        return
        [
            .. dinamicos.Where(c => c.Primary),
            .. dinamicos
                .Where(c => !c.Primary)
                .Select(c => (Command: c, Score: ScoreDinamico(c, q), Estatico: 0))
                .Concat(_comandos.Select(c => (Command: c.Command, Score: Score(c.Command, q), Estatico: 1)))
                .Where(x => x.Score >= 0)
                .OrderBy(x => x.Score)
                .ThenBy(x => x.Estatico)
                .ThenBy(x => x.Command.Text)
                .Select(x => x.Command),
        ];
    }

    private static int Score(PaletteCommand c, string q)
    {
        const StringComparison cmp = StringComparison.OrdinalIgnoreCase;

        if (c.Text.StartsWith(q, cmp))
        {
            return 0;
        }

        if (c.Text.Split(' ', StringSplitOptions.RemoveEmptyEntries).Any(p => p.StartsWith(q, cmp)))
        {
            return 1;
        }

        if (c.Text.Contains(q, cmp))
        {
            return 2;
        }

        if (c.Detail?.Contains(q, cmp) == true)
        {
            return 3;
        }

        return -1;
    }

    /// <summary>
    /// O provedor já casou pelo critério dele. O que não pontua no ranking
    /// comum cai para o fim da lista em vez de sumir.
    /// </summary>
    private static int ScoreDinamico(PaletteCommand c, string q)
    {
        var nota = Score(c, q);
        return nota >= 0 ? nota : 4;
    }

    private List<PaletteCommand> Dinamicos(string q)
    {
        List<PaletteCommand> saida = [];

        foreach (var (_, provedor) in _provedores)
        {
            try
            {
                saida.AddRange(provedor(q));
            }
            catch (Exception)
            {
                // Provedor quebrado tira a si mesmo da lista, não a busca inteira.
            }
        }

        return saida;
    }
}
