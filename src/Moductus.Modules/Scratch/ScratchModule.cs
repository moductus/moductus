using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Moductus.Core.Modules;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;

namespace Moductus.Modules.Scratch;

/// <summary>
/// Bloco de notas que desliza do topo e salva sozinho. Um arquivo só, na
/// pasta de dados — em modo portable, ao lado do executável.
/// </summary>
public sealed class ScratchModule(ModuleContext context) : IModule
{
    private static readonly TimeSpan Debounce = TimeSpan.FromMilliseconds(600);
    private static readonly UTF8Encoding Utf8 = new(false);

    private readonly TextBox _texto = new();
    private readonly TextBlock _estado = new();
    private readonly DockPanel _corpo = new();
    private readonly DispatcherTimer _salvar = new() { Interval = Debounce };
    private bool _carregado;
    private bool _sujo;

    public string Id => "scratch";

    public string Name => "Scratch";

    public string Description => "Bloco de notas que salva sozinho";

    public ModuleArchetype Archetype => ModuleArchetype.Panel;

    public char SuggestedLeaderKey => 's';

    public bool HasSurface => true;

    private string Arquivo => Path.Combine(context.DataDirectory, "scratch.txt");

    public void Enable()
    {
        _texto.AcceptsReturn = true;
        _texto.AcceptsTab = true;
        _texto.TextWrapping = TextWrapping.Wrap;
        _texto.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _texto.Height = double.NaN;
        _texto.VerticalContentAlignment = VerticalAlignment.Top;
        _texto.BorderThickness = new Thickness(0);
        _texto.Background = null;
        _texto.SetResourceReference(Control.FontSizeProperty, "type.body");
        _texto.SetResourceReference(FrameworkElement.MarginProperty, "inset.8");
        _texto.TextChanged += (_, _) =>
        {
            if (!_carregado)
            {
                return;
            }

            _sujo = true;
            _estado.Text = "…";
            _salvar.Stop();
            _salvar.Start();
        };

        _salvar.Tick += (_, _) =>
        {
            _salvar.Stop();
            Gravar();
        };

        _estado.SetResourceReference(FrameworkElement.StyleProperty, "text.caption");
        _estado.HorizontalAlignment = HorizontalAlignment.Right;
        _estado.Margin = new Thickness(0, 0, 12, 6);

        // Construído uma vez. Um elemento só pode ter um pai lógico: montar
        // um painel novo a cada Invoke com os mesmos filhos derruba o app.
        DockPanel.SetDock(_estado, Dock.Bottom);
        _corpo.Children.Add(_estado);
        _corpo.Children.Add(_texto);
    }

    public void Disable()
    {
        _salvar.Stop();
        Gravar();
    }

    public void Invoke()
    {
        var panel = context.Archetypes.Panel;

        if (panel.IsVisible && panel.Owner == Id && !panel.IsPinned)
        {
            panel.Dismiss();
            return;
        }

        if (!_carregado)
        {
            Carregar();
        }

        panel.Owner = Id;
        panel.Heading = "Scratch";
        panel.Placement = PanelPlacement.Top;
        panel.SlotContent = _corpo;
        panel.Dismissed += GravarAoFechar;
        panel.Present();
        panel.TakeFocus(_texto);
        _texto.CaretIndex = _texto.Text.Length;
    }

    private void Carregar()
    {
        try
        {
            _texto.Text = File.Exists(Arquivo) ? File.ReadAllText(Arquivo, Encoding.UTF8) : string.Empty;
            _estado.Text = string.IsNullOrEmpty(_texto.Text) ? "Escreva. Salva sozinho." : "Salvo";
        }
        catch (Exception e)
        {
            _estado.Text = $"Não deu para ler {Arquivo}: {e.Message}";
        }

        _carregado = true;
        _sujo = false;
    }

    private void Gravar()
    {
        if (!_sujo)
        {
            return;
        }

        try
        {
            Directory.CreateDirectory(context.DataDirectory);
            var temp = Arquivo + ".tmp";
            File.WriteAllText(temp, _texto.Text, Utf8);
            if (File.Exists(Arquivo))
            {
                File.Replace(temp, Arquivo, null);
            }
            else
            {
                File.Move(temp, Arquivo);
            }

            _sujo = false;
            _estado.Text = "Salvo";
        }
        catch (Exception e)
        {
            _estado.Text = $"Não salvou: {e.Message}";
        }
    }

    private void GravarAoFechar()
    {
        context.Archetypes.Panel.Dismissed -= GravarAoFechar;
        _salvar.Stop();
        Gravar();
    }

    public UserControl? BuildSettings() => null;
}
