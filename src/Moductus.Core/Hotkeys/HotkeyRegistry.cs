namespace Moductus.Core.Hotkeys;

/// <summary>
/// Registro central de hotkeys globais, com detecção de conflito.
/// </summary>
/// <remarks>
/// Existir um só destes é metade da razão de o Moductus ser um processo em vez
/// de doze: com um registro central dá para saber que duas coisas querem a
/// mesma combinação e dizer isso ao usuário. Doze processos separados apenas
/// falhariam em silêncio, cada um por conta própria.
/// </remarks>
public sealed class HotkeyRegistry(IHotkeySink sink)
{
    private readonly IHotkeySink _sink = sink ?? throw new ArgumentNullException(nameof(sink));
    private readonly Dictionary<int, Entrada> _porId = [];

    private int _ultimoId;

    /// <summary>A mensagem do Windows que carrega um disparo: <c>WM_HOTKEY</c>.</summary>
    public static uint WindowsMessage => Windows.Win32.PInvoke.WM_HOTKEY;

    /// <summary>Tudo que foi pedido, registrado ou em conflito.</summary>
    public IReadOnlyList<HotkeyRegistration> All =>
        [.. _porId.Values.Select(e => e.Registro)];

    /// <summary>O que a tela de configuração precisa mostrar em vermelho.</summary>
    public IReadOnlyList<HotkeyRegistration> Conflicts =>
        [.. _porId.Values.Select(e => e.Registro).Where(r => !r.Active)];

    public HotkeyRegistration Register(string owner, HotkeyBinding binding, Action callback)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(owner);
        ArgumentNullException.ThrowIfNull(callback);

        var id = ++_ultimoId;

        // Conflito interno vem primeiro porque é o único que dá para explicar
        // com precisão: sabemos exatamente quem já pediu.
        var jaNossa = _porId.Values.FirstOrDefault(e => e.Registro.Active && e.Registro.Binding == binding);
        if (jaNossa is not null)
        {
            return Guardar(id, owner, binding, callback,
                HotkeyState.ConflictInternal, $"já registrado por {jaNossa.Registro.Owner}");
        }

        if (!_sink.TryRegister(id, binding))
        {
            return Guardar(id, owner, binding, callback,
                HotkeyState.ConflictExternal, "outro aplicativo já usa esta combinação");
        }

        return Guardar(id, owner, binding, callback, HotkeyState.Registered, null);
    }

    public void Unregister(int id)
    {
        if (!_porId.TryGetValue(id, out var entrada))
        {
            return;
        }

        if (entrada.Registro.Active)
        {
            _sink.Unregister(id);
        }

        _porId.Remove(id);
    }

    public void UnregisterAll()
    {
        foreach (var id in _porId.Keys.ToList())
        {
            Unregister(id);
        }
    }

    /// <summary>
    /// Chamado quando chega <c>WM_HOTKEY</c>, com o id vindo do <c>wParam</c>.
    /// </summary>
    /// <returns><c>false</c> quando o id não é nosso ou está em conflito.</returns>
    public bool Dispatch(int id)
    {
        if (!_porId.TryGetValue(id, out var entrada) || !entrada.Registro.Active)
        {
            return false;
        }

        entrada.Callback();
        return true;
    }

    private HotkeyRegistration Guardar(
        int id, string owner, HotkeyBinding binding, Action callback,
        HotkeyState estado, string? detalhe)
    {
        var registro = new HotkeyRegistration(id, owner, binding, estado, detalhe);
        _porId[id] = new Entrada(registro, callback);
        return registro;
    }

    private sealed record Entrada(HotkeyRegistration Registro, Action Callback);
}
