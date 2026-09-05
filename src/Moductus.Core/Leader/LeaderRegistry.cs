namespace Moductus.Core.Leader;

public enum LeaderKeyState
{
    Registered,

    /// <summary>Outro módulo já tem esta letra.</summary>
    Conflict,
}

public sealed record LeaderKeyRegistration(
    char Key,
    string ModuleId,
    string Name,
    string Description,
    LeaderKeyState State,
    string? ConflictDetail)
{
    public bool Active => State == LeaderKeyState.Registered;
}

/// <summary>
/// Registro central de letras da tecla líder. Mesma mecânica do registro de
/// hotkeys, pela mesma razão: três módulos disputam o <c>p</c>.
/// </summary>
/// <remarks>
/// Diferente das hotkeys, aqui o app é dono do namespace inteiro: sabe
/// exatamente quem colide com quem e resolve de forma determinística — o
/// primeiro fica, o segundo aparece em conflito na configuração.
/// </remarks>
public sealed class LeaderRegistry
{
    private readonly List<Entrada> _entradas = [];

    public IReadOnlyList<LeaderKeyRegistration> All => [.. _entradas.Select(e => e.Registro)];

    public IReadOnlyList<LeaderKeyRegistration> Conflicts =>
        [.. _entradas.Select(e => e.Registro).Where(r => !r.Active)];

    public LeaderKeyRegistration Register(char key, string moduleId, string name, string description, Action invoke)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(moduleId);
        ArgumentNullException.ThrowIfNull(invoke);

        var normalizada = Normalize(key);

        if (_entradas.Any(e => e.Registro.ModuleId == moduleId))
        {
            throw new InvalidOperationException($"O módulo '{moduleId}' já está registrado.");
        }

        var dono = _entradas.FirstOrDefault(e => e.Registro.Active && e.Registro.Key == normalizada);

        var registro = dono is null
            ? new LeaderKeyRegistration(normalizada, moduleId, name, description, LeaderKeyState.Registered, null)
            : new LeaderKeyRegistration(normalizada, moduleId, name, description, LeaderKeyState.Conflict, $"'{normalizada}' já é de {dono.Registro.Name}");

        _entradas.Add(new Entrada(registro, invoke));
        return registro;
    }

    public void Unregister(string moduleId) => _entradas.RemoveAll(e => e.Registro.ModuleId == moduleId);

    /// <summary>Dispara o módulo da letra. Falso se a letra não é de ninguém.</summary>
    public bool TryInvoke(char key)
    {
        var normalizada = char.ToLowerInvariant(key);
        var alvo = _entradas.FirstOrDefault(e => e.Registro.Active && e.Registro.Key == normalizada);

        if (alvo is null)
        {
            return false;
        }

        alvo.Invoke();
        return true;
    }

    private static char Normalize(char key)
    {
        var c = char.ToLowerInvariant(key);

        if (!char.IsAsciiLetterOrDigit(c))
        {
            throw new ArgumentException($"Letra inválida para a tecla líder: '{key}'.", nameof(key));
        }

        return c;
    }

    private sealed record Entrada(LeaderKeyRegistration Registro, Action Invoke);
}
