namespace Moductus.Core.Hotkeys;

/// <summary>
/// A borda entre o registro de hotkeys e o Win32.
/// </summary>
/// <remarks>
/// Esta interface é o que faz a decisão "testar só o Core" não ser vazia. A
/// lógica de conflito — quem pediu primeiro, quem fica marcado, o que aparece
/// na configuração — é testada contra uma implementação falsa. Se
/// <c>RegisterHotKey</c> funciona é problema da Microsoft, não deste projeto.
/// </remarks>
public interface IHotkeySink
{
    /// <returns><c>false</c> quando o sistema recusa, tipicamente porque outro processo já é dono.</returns>
    bool TryRegister(int id, HotkeyBinding binding);

    void Unregister(int id);
}
