using System.Windows.Input;

namespace Moductus.Core.Hotkeys;

/// <summary>
/// Modificadores de hotkey global. Os valores espelham os <c>MOD_*</c> do
/// Win32 de propósito, para que a conversão na borda do interop seja um cast.
/// </summary>
[Flags]
public enum HotkeyModifiers : uint
{
    None = 0,
    Alt = 0x0001,
    Control = 0x0002,
    Shift = 0x0004,
    Windows = 0x0008,

    /// <summary>Não repete enquanto a tecla fica pressionada.</summary>
    NoRepeat = 0x4000,
}

/// <summary>Uma combinação de teclas.</summary>
public readonly record struct HotkeyBinding(HotkeyModifiers Modifiers, uint VirtualKey)
{
    /// <summary>Texto legível, do jeito que aparece na tela de configuração.</summary>
    public override string ToString()
    {
        var partes = new List<string>(4);

        if (Modifiers.HasFlag(HotkeyModifiers.Control)) partes.Add("Ctrl");
        if (Modifiers.HasFlag(HotkeyModifiers.Alt)) partes.Add("Alt");
        if (Modifiers.HasFlag(HotkeyModifiers.Shift)) partes.Add("Shift");
        if (Modifiers.HasFlag(HotkeyModifiers.Windows)) partes.Add("Win");

        partes.Add(NomeDaTecla());

        return string.Join('+', partes);
    }

    private string NomeDaTecla()
    {
        try
        {
            var key = KeyInterop.KeyFromVirtualKey((int)VirtualKey);
            return key == Key.None ? $"0x{VirtualKey:X2}" : key.ToString();
        }
        catch (ArgumentException)
        {
            return $"0x{VirtualKey:X2}";
        }
    }
}
