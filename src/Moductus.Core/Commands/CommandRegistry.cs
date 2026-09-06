namespace Moductus.Core.Commands;

/// <summary>Uma ação que a Palette lista. <see cref="Hint"/> aparece à direita.</summary>
public sealed record PaletteCommand(string Id, string Text, string? Detail, string? Hint, Action Execute);

/// <summary>
/// Registro central de comandos da Palette. Host e módulos registram; a
/// Palette busca. É o que torna o hub extensível sem a Palette conhecer
/// ninguém.
/// </summary>
public sealed class CommandRegistry
{
    private readonly List<(string Owner, PaletteCommand Command)> _comandos = [];

    public IReadOnlyList<PaletteCommand> All => [.. _comandos.Select(c => c.Command).OrderBy(c => c.Text)];

    public void Register(string owner, PaletteCommand command)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(owner);
        ArgumentNullException.ThrowIfNull(command);

        _comandos.RemoveAll(c => c.Command.Id == command.Id);
        _comandos.Add((owner, command));
    }

    public void Unregister(string owner) => _comandos.RemoveAll(c => c.Owner == owner);

    /// <summary>
    /// Ranking simples e previsível: prefixo do texto, depois início de
    /// palavra, depois qualquer trecho do texto, depois trecho do detalhe.
    /// Empate resolve por ordem alfabética. Sem fuzzy: o usuário digita
    /// três letras e precisa saber o que vai aparecer.
    /// </summary>
    public IReadOnlyList<PaletteCommand> Search(string? query)
    {
        var q = query?.Trim() ?? string.Empty;

        if (q.Length == 0)
        {
            return All;
        }

        return
        [
            .. _comandos
                .Select(c => (c.Command, Score: Score(c.Command, q)))
                .Where(x => x.Score >= 0)
                .OrderBy(x => x.Score)
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
}
