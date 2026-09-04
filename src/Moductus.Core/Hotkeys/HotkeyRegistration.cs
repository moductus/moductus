namespace Moductus.Core.Hotkeys;

public enum HotkeyState
{
    /// <summary>Registrada no Windows e funcionando.</summary>
    Registered,

    /// <summary>Outro módulo do próprio Moductus já pediu esta combinação.</summary>
    ConflictInternal,

    /// <summary>Outro aplicativo já é dono desta combinação no sistema.</summary>
    ConflictExternal,
}

/// <summary>
/// O resultado de um pedido de registro — inclusive quando ele falha.
/// </summary>
/// <remarks>
/// Pedido que falha continua na lista, em vez de sumir. Um atalho que
/// simplesmente "não funciona", sem explicação, é o modo de falha mais caro
/// deste tipo de app, e o Windows não avisa nada por conta própria:
/// <c>RegisterHotKey</c> apenas devolve <c>false</c>.
/// </remarks>
public sealed record HotkeyRegistration(
    int Id,
    string Owner,
    HotkeyBinding Binding,
    HotkeyState State,
    string? ConflictDetail)
{
    public bool Active => State == HotkeyState.Registered;

    public override string ToString() =>
        Active
            ? $"{Binding} — {Owner}"
            : $"{Binding} — {Owner} (em conflito: {ConflictDetail})";
}
