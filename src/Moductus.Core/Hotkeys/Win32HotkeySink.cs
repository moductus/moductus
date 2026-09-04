using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.Input.KeyboardAndMouse;

namespace Moductus.Core.Hotkeys;

/// <summary>
/// A implementação real, ligada à janela oculta que recebe <c>WM_HOTKEY</c>.
/// </summary>
public sealed class Win32HotkeySink(nint messageWindow) : IHotkeySink
{
    private readonly HWND _hwnd = (HWND)messageWindow;

    public bool TryRegister(int id, HotkeyBinding binding) =>
        PInvoke.RegisterHotKey(_hwnd, id, (HOT_KEY_MODIFIERS)binding.Modifiers, binding.VirtualKey);

    public void Unregister(int id) => PInvoke.UnregisterHotKey(_hwnd, id);
}
