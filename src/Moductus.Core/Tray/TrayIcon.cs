using Moductus.Core.Interop;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.Shell;
using Windows.Win32.UI.WindowsAndMessaging;

namespace Moductus.Core.Tray;

/// <summary>
/// O ícone de bandeja, por <c>Shell_NotifyIcon</c> direto — sem WinForms.
/// </summary>
/// <remarks>
/// <para>
/// O wrapper do WinForms escondia duas responsabilidades que agora são
/// nossas, e as duas estão aqui:
/// </para>
/// <para>
/// <b>O Explorer reinicia e leva o ícone junto.</b> Quando isso acontece, o
/// Windows transmite a mensagem registrada <c>TaskbarCreated</c>. Sem
/// tratá-la, o Moductus continua rodando com a única superfície permanente do
/// produto invisível, e o usuário conclui que ele morreu.
/// </para>
/// <para>
/// <b>Menu de contexto exige foreground.</b> Quem exibe o menu precisa chamar
/// <c>SetForegroundWindow</c> na janela dona antes; sem isso o menu não fecha
/// ao clicar fora. Esta classe expõe <see cref="PrepareForMenu"/> para isso.
/// </para>
/// </remarks>
public sealed class TrayIcon : IDisposable
{
    private const uint IconId = 1;
    private const int MaxTooltip = 127;

    private static readonly uint CallbackMessage = PInvoke.WM_APP + 1;
    private static readonly uint TaskbarCreated = PInvoke.RegisterWindowMessage("TaskbarCreated");

    private readonly MessageWindow _window;
    private readonly WindowMessageHandler _handler;

    private HICON _icon;
    private string _tooltip;
    private bool _visible;

    /// <param name="icon">Um <c>HICON</c>. Ver <see cref="StockIcons"/> para o provisório.</param>
    public TrayIcon(MessageWindow window, nint icon, string tooltip)
    {
        _window = window ?? throw new ArgumentNullException(nameof(window));
        _icon = new HICON(icon);
        _tooltip = tooltip ?? string.Empty;

        _handler = OnMessage;
        _window.AddHandler(_handler);

        Add();
    }

    public event Action? LeftClick;

    public event Action? RightClick;

    public void SetIcon(nint icon)
    {
        _icon = new HICON(icon);
        Modify(NOTIFY_ICON_DATA_FLAGS.NIF_ICON);
    }

    public void SetTooltip(string tooltip)
    {
        _tooltip = tooltip ?? string.Empty;
        Modify(NOTIFY_ICON_DATA_FLAGS.NIF_TIP);
    }

    /// <summary>
    /// Chame imediatamente antes de abrir o menu de contexto. É a dança do
    /// foreground: sem ela, o menu fica preso na tela ao clicar fora.
    /// </summary>
    public void PrepareForMenu() => PInvoke.SetForegroundWindow((HWND)_window.Handle);

    private bool OnMessage(uint message, nint wParam, nint lParam)
    {
        if (message == TaskbarCreated)
        {
            _visible = false;
            Add();
            return true;
        }

        if (message != CallbackMessage || (uint)wParam != IconId)
        {
            return false;
        }

        switch (unchecked((uint)(long)lParam))
        {
            case PInvoke.WM_LBUTTONUP:
                LeftClick?.Invoke();
                return true;
            case PInvoke.WM_RBUTTONUP:
                RightClick?.Invoke();
                return true;
            default:
                return false;
        }
    }

    private void Add()
    {
        var data = Build(NOTIFY_ICON_DATA_FLAGS.NIF_MESSAGE | NOTIFY_ICON_DATA_FLAGS.NIF_ICON | NOTIFY_ICON_DATA_FLAGS.NIF_TIP);
        _visible = PInvoke.Shell_NotifyIcon(NOTIFY_ICON_MESSAGE.NIM_ADD, in data);
    }

    private void Modify(NOTIFY_ICON_DATA_FLAGS flags)
    {
        if (!_visible)
        {
            return;
        }

        var data = Build(flags);
        PInvoke.Shell_NotifyIcon(NOTIFY_ICON_MESSAGE.NIM_MODIFY, in data);
    }

    private unsafe NOTIFYICONDATAW Build(NOTIFY_ICON_DATA_FLAGS flags)
    {
        var data = new NOTIFYICONDATAW
        {
            cbSize = (uint)sizeof(NOTIFYICONDATAW),
            hWnd = (HWND)_window.Handle,
            uID = IconId,
            uFlags = flags,
            uCallbackMessage = CallbackMessage,
            hIcon = _icon,
        };

        var destino = data.szTip.AsSpan();
        destino.Clear();
        _tooltip.AsSpan(0, Math.Min(_tooltip.Length, MaxTooltip)).CopyTo(destino);

        return data;
    }

    public void Dispose()
    {
        _window.RemoveHandler(_handler);

        if (_visible)
        {
            var data = Build(NOTIFY_ICON_DATA_FLAGS.NIF_MESSAGE);
            PInvoke.Shell_NotifyIcon(NOTIFY_ICON_MESSAGE.NIM_DELETE, in data);
            _visible = false;
        }
    }
}
