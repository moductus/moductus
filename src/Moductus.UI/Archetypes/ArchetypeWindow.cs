using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using Moductus.Core.Interop;

namespace Moductus.UI.Archetypes;

/// <summary>
/// O que os quatro arquétipos têm em comum. Módulo nenhum herda disto:
/// módulo escolhe um dos quatro e preenche o conteúdo.
/// </summary>
/// <remarks>
/// <para>
/// São singletons, construídos em tempo ocioso e nunca destruídos. Mostrar é
/// <see cref="Present"/>, fechar é <see cref="Dismiss"/>. O spike mediu ~490ms
/// na primeira janela de um processo; <see cref="Prewarm"/> paga isso fora do
/// caminho do usuário.
/// </para>
/// <para>
/// Contrato de interação, valendo para todos: Esc fecha sem confirmar; a
/// hotkey é toggle; a superfície aparece no monitor da janela em foreground.
/// </para>
/// </remarks>
public abstract class ArchetypeWindow : Window
{
    private readonly ContentPresenter _slot = new();
    private bool _dismissing;

    protected ArchetypeWindow(bool stealsFocus)
    {
        StealsFocus = stealsFocus;

        // Estilo implícito não casa com subclasse. Sem esta linha, a janela
        // nasce branca com texto claro.
        SetResourceReference(StyleProperty, typeof(Window));

        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        Topmost = true;
        ShowActivated = stealsFocus;
        WindowStartupLocation = WindowStartupLocation.Manual;

        Content = BuildChrome(_slot);

        SourceInitialized += (_, _) => OnHandleCreated();
        PreviewKeyDown += OnPreviewKeyDown;
    }

    /// <summary>Palette e Canvas roubam; HUD e Panel nunca.</summary>
    public bool StealsFocus { get; }

    /// <summary>O que o módulo coloca dentro do arquétipo.</summary>
    public object? SlotContent
    {
        get => _slot.Content;
        set => _slot.Content = value;
    }

    protected nint Handle => new WindowInteropHelper(this).Handle;

    /// <summary>Mostra, ou traz para o monitor certo se já estiver visível.</summary>
    public void Present()
    {
        var foreground = ForegroundWindow.Capture();
        OnPresenting(foreground);

        Place(Monitors.Around(foreground));

        if (!IsVisible)
        {
            Show();
        }

        if (StealsFocus)
        {
            // Activate() do WPF é só SetForegroundWindow, que o Windows
            // recusa em boa parte dos casos. Take() faz o contorno.
            ForegroundWindow.Take(Handle);
            Activate();
        }

        OnPresented();
    }

    /// <summary>Esconde. Nunca destrói: a janela é reutilizada.</summary>
    public void Dismiss()
    {
        if (_dismissing || !IsVisible)
        {
            return;
        }

        _dismissing = true;

        try
        {
            Hide();
            OnDismissed();
        }
        finally
        {
            _dismissing = false;
        }
    }

    /// <summary>A hotkey é toggle: apertar de novo fecha.</summary>
    public void Toggle()
    {
        if (IsVisible)
        {
            Dismiss();
        }
        else
        {
            Present();
        }
    }

    /// <summary>
    /// Cria o HWND e força a primeira renderização fora da tela, em tempo
    /// ocioso. Depois disto, <see cref="Present"/> custa milissegundos.
    /// </summary>
    public void Prewarm()
    {
        if (Handle != 0)
        {
            return;
        }

        var ativava = ShowActivated;
        ShowActivated = false;
        Left = -32000;
        Top = -32000;

        Show();
        Hide();

        ShowActivated = ativava;
    }

    /// <summary>Onde e com que tamanho, em pixels físicos do monitor dado.</summary>
    protected abstract void Place(MonitorArea area);

    protected void PlacePhysical(MonitorArea area, int x, int y, int width, int height)
    {
        if (Handle != 0)
        {
            Monitors.Place(Handle, x, y, width, height);
        }
        else
        {
            // Só acontece se alguém chamar Present antes do Prewarm.
            Left = x / area.Scale;
            Top = y / area.Scale;
            Width = width / area.Scale;
            Height = height / area.Scale;
        }
    }

    protected double Token(string key) => (double)FindResource(key);

    protected virtual FrameworkElement BuildChrome(ContentPresenter slot)
    {
        var moldura = new Border { Child = slot };
        moldura.SetResourceReference(Border.BackgroundProperty, "bg.base");
        moldura.SetResourceReference(Border.BorderBrushProperty, "border.strong");
        moldura.SetResourceReference(Border.BorderThicknessProperty, "border.width");
        moldura.SetResourceReference(Border.CornerRadiusProperty, "radius.window");
        return moldura;
    }

    protected virtual void OnHandleCreated()
    {
        WindowStyles.MakeToolWindow(Handle);

        if (!StealsFocus)
        {
            WindowStyles.MakeNoActivate(Handle);
        }

        Dwm.RoundCorners(Handle);
    }

    protected virtual void OnPresenting(nint foreground)
    {
    }

    protected virtual void OnPresented()
    {
    }

    /// <summary>
    /// Limpa ao esconder, não ao exibir: limpar na exibição gastaria tempo
    /// dentro do orçamento de 140ms.
    /// </summary>
    protected virtual void OnDismissed() => SlotContent = null;

    private void OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            e.Handled = true;
            Dismiss();
        }
    }
}
