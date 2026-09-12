using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Moductus.Core.Interop;
using Moductus.Core.Modules;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;

namespace Moductus.Modules.Peek;

/// <summary>
/// Miniatura flutuante ao vivo de qualquer janela. Escolhe na Palette,
/// mostra no Panel. O DWM desenha; nós só reservamos o retângulo.
/// </summary>
public sealed class PeekModule(ModuleContext context) : IModule
{
    private const string ChaveOpacidade = "opacity";
    private const string ChaveFixado = "startPinned";

    private const int OpacidadePadrao = 100;

    private readonly Border _area = new() { Background = Brushes.Transparent };
    private readonly TextBlock _legenda = new();
    private readonly DockPanel _corpo = new();
    private DwmThumbnail? _thumbnail;
    private nint _alvo;

    /// <summary>A árvore visual só é construída uma vez, por mais que Enable repita.</summary>
    private bool _montado;

    /// <summary>
    /// Sobe a cada Invoke. A leitura que voltar com número velho é de uma
    /// abertura que já passou, e não deve escrever na Palette de agora.
    /// </summary>
    private int _geracao;

    public string Id => "peek";

    public string Name => "Peek";

    public string Description => "Miniatura ao vivo de qualquer janela";

    public ModuleArchetype Archetype => ModuleArchetype.Panel;

    public char SuggestedLeaderKey => 'k';

    public bool HasSurface => true;

    private int Opacidade => Faixa(context.ConfigScope(Id)[ChaveOpacidade]?.GetValue<int>() ?? OpacidadePadrao);

    private bool AbrirFixado => context.ConfigScope(Id)[ChaveFixado]?.GetValue<bool>() ?? false;

    public void Enable()
    {
        // Enable roda de novo toda vez que o módulo é religado nas configurações.
        // A árvore visual já está montada, e readicionar um filho que já tem pai
        // derruba o processo inteiro — ver docs/MODULES.md, "Armadilhas conhecidas".
        if (_montado)
        {
            return;
        }

        _montado = true;

        _area.SetResourceReference(FrameworkElement.MarginProperty, "inset.8");

        _area.SizeChanged += (_, _) => Reposicionar();
        _legenda.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        _legenda.HorizontalAlignment = HorizontalAlignment.Center;
        _legenda.SetResourceReference(FrameworkElement.MarginProperty, "inset.bottom.8");

        // Construído uma vez: um elemento só pode ter um pai lógico.
        DockPanel.SetDock(_legenda, Dock.Bottom);
        _corpo.Children.Add(_legenda);
        _corpo.Children.Add(_area);
    }

    public void Disable() => Soltar();

    public void Invoke()
    {
        var panel = context.Archetypes.Panel;

        if (panel.DismissIfShowing(Id))
        {
            return;
        }

        var palette = context.Archetypes.Palette;
        palette.Placeholder = "Qual janela?";
        palette.EmptyText = "Procurando janelas…";
        palette.SetItems([]);
        palette.Present();

        Listar();
    }

    /// <summary>
    /// Enumerar as janelas e descobrir o processo de cada uma é ida ao kernel
    /// por janela, e antes do Present isso aparecia como a tecla líder demorando
    /// a responder. A lista chega depois, com a Palette já na tela.
    /// </summary>
    private async void Listar()
    {
        var palette = context.Archetypes.Palette;
        var desta = ++_geracao;

        var janelas = await Task.Run(() =>
            WindowList.AltTab().Select(w => (Janela: w, Processo: Processes.NameOf(w.ProcessId) ?? "processo desconhecido")).ToList());

        // A Palette é uma só para todos os módulos e não tem dono. Se ela fechou
        // ou outro módulo a tomou enquanto líamos, estes itens não são mais os
        // dela — escrevê-los apagaria o que está em tela.
        if (desta != _geracao || !palette.IsVisible)
        {
            return;
        }

        palette.EmptyText = "Nenhuma janela aberta além desta.";
        palette.SetItems(janelas.Select(x => new PaletteItem(
            x.Janela.Title,
            x.Processo,
            null,
            () => Mostrar(x.Janela))));
    }

    private void Mostrar(TopLevelWindow janela)
    {
        var panel = context.Archetypes.Panel;

        Soltar();
        _alvo = janela.Handle;

        _legenda.Text = "Ao vivo. A hotkey fecha; Fixar mantém aberto.";

        panel.Dismissed += SoltarAoFechar;
        panel.Occupy(Id, $"Peek · {janela.Title}", PanelPlacement.Center, _corpo);

        _thumbnail = DwmThumbnail.Register(new System.Windows.Interop.WindowInteropHelper(panel).Handle, _alvo);

        if (_thumbnail is null)
        {
            _legenda.Text = "Esta janela não pode ser espelhada.";
            return;
        }

        context.Archetypes.Badge.Fixar(
            Id,
            $"Peek — {janela.Title}",
            "A miniatura fecha com o ✕ ou o atalho",
            HudTone.Neutro,
            aoClicar: null,
            [new BadgeAction("Fechar", "Dispensa a miniatura", Fechar)]);

        panel.Dispatcher.BeginInvoke(Reposicionar, System.Windows.Threading.DispatcherPriority.Loaded);
    }

    // O retângulo vai em pixels físicos, relativo à área cliente do Panel, e
    // mantém a proporção da origem.
    private void Reposicionar()
    {
        if (_thumbnail is null || !_area.IsLoaded)
        {
            return;
        }

        var panel = context.Archetypes.Panel;
        var escala = VisualTreeHelper.GetDpi(panel).DpiScaleX;
        var origem = _area.TransformToAncestor(panel).Transform(new Point(0, 0));

        var areaW = _area.ActualWidth * escala;
        var areaH = _area.ActualHeight * escala;
        var (srcW, srcH) = _thumbnail.SourceSize();

        if (areaW <= 0 || areaH <= 0 || srcW <= 0 || srcH <= 0)
        {
            return;
        }

        var razao = Math.Min(areaW / srcW, areaH / srcH);
        var w = srcW * razao;
        var h = srcH * razao;
        var x = origem.X * escala + (areaW - w) / 2;
        var y = origem.Y * escala + (areaH - h) / 2;

        _thumbnail.Update((int)x, (int)y, (int)(x + w), (int)(y + h));
    }

    private void SoltarAoFechar()
    {
        context.Archetypes.Panel.Dismissed -= SoltarAoFechar;
        Soltar();
    }

    /// <summary>
    /// Fecha pela pastilha. Dismiss só dispara Dismissed com o Panel visível,
    /// então o caso do Panel já fechado solta a miniatura na mão.
    /// </summary>
    private void Fechar()
    {
        var panel = context.Archetypes.Panel;

        if (panel.IsShowingFor(Id))
        {
            panel.Dismiss();
            return;
        }

        Soltar();
    }

    private void Soltar()
    {
        _thumbnail?.Dispose();
        _thumbnail = null;
        _alvo = 0;
        context.Archetypes.Badge.Soltar(Id);
    }

    // ---- Configuração ---------------------------------------------------------

    private static int Faixa(int valor) => Math.Clamp(valor, 20, 100);

    public UserControl? BuildSettings()
    {
        var corpo = new StackPanel();

        corpo.Children.Add(Campo("Opacidade", "de 20 a 100; abaixo de 100 a miniatura deixa ver o que está atrás", ChaveOpacidade));

        var fixado = new CheckBox { Content = "Abrir já fixado", IsChecked = AbrirFixado };
        fixado.SetResourceReference(FrameworkElement.MarginProperty, "inset.4");
        fixado.Checked += (_, _) => Gravar(ChaveFixado, true);
        fixado.Unchecked += (_, _) => Gravar(ChaveFixado, false);
        corpo.Children.Add(fixado);

        corpo.Children.Add(SettingsUI.Note("Fixado, a miniatura não fecha quando o atalho é repetido — é o que serve para acompanhar um build."));
        corpo.Children.Add(SettingsUI.Note("As duas opções ficam gravadas, mas ainda não valem: a opacidade da miniatura e o estado do alfinete do Panel são decididos fora do módulo."));

        return new UserControl { Content = corpo };
    }

    private FrameworkElement Campo(string rotulo, string dica, string chave)
    {
        var caixa = SettingsUI.NumberBox(Opacidade.ToString());

        // Grava no que sair do campo, não a cada tecla: "2" a caminho de "20"
        // não pode virar opacidade gravada.
        caixa.LostFocus += (_, _) =>
        {
            var valor = int.TryParse(caixa.Text, out var n) ? Faixa(n) : OpacidadePadrao;
            caixa.Text = valor.ToString();
            Gravar(chave, valor);
        };

        return SettingsUI.Row(rotulo, dica, caixa);
    }

    private void Gravar(string chave, int valor)
    {
        context.ConfigScope(Id)[chave] = valor;
        context.SaveConfig();
    }

    private void Gravar(string chave, bool valor)
    {
        context.ConfigScope(Id)[chave] = valor;
        context.SaveConfig();
    }
}
