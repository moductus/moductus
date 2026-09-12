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
    private const string ChaveCaminho = "path";
    private const string ChaveAtraso = "saveDelayMs";

    private const int AtrasoPadrao = 600;
    private const int AtrasoMinimo = 200;
    private const int AtrasoMaximo = 5000;

    private static readonly TimeSpan Debounce = TimeSpan.FromMilliseconds(AtrasoPadrao);
    private static readonly UTF8Encoding Utf8 = new(false);

    private readonly TextBox _texto = new();
    private readonly TextBlock _estado = new();
    private readonly DockPanel _corpo = new();
    private readonly DispatcherTimer _salvar = new() { Interval = Debounce };

    /// <summary>
    /// Guardado em campo porque Disable desassina e religar o módulo precisa
    /// reassinar. Lambda anônima não dá para remover, e o texto continuaria
    /// indo para o disco com o módulo desligado.
    /// </summary>
    private TextChangedEventHandler? _aoMudarTexto;
    private bool _carregado;
    private bool _sujo;

    /// <summary>A árvore visual só é construída uma vez, por mais que Enable repita.</summary>
    private bool _montado;

    public string Id => "scratch";

    public string Name => "Scratch";

    public string Description => "Bloco de notas que salva sozinho";

    public ModuleArchetype Archetype => ModuleArchetype.Panel;

    public char SuggestedLeaderKey => 's';

    public bool HasSurface => true;

    /// <summary>Vazio na configuração significa o arquivo padrão, na pasta de dados.</summary>
    private string Arquivo
    {
        get
        {
            var escolhido = context.ConfigScope(Id)[ChaveCaminho]?.GetValue<string>();
            return string.IsNullOrWhiteSpace(escolhido)
                ? Path.Combine(context.DataDirectory, "scratch.txt")
                : escolhido.Trim();
        }
    }

    private int Atraso => Milissegundos(context.ConfigScope(Id)[ChaveAtraso]?.GetValue<int>() ?? AtrasoPadrao);

    public void Enable()
    {
        // Fora da guarda de _montado: Disable desassina, e religar tem de reassinar.
        _aoMudarTexto ??= (_, _) =>
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
        _texto.TextChanged -= _aoMudarTexto;
        _texto.TextChanged += _aoMudarTexto;

        // Enable roda de novo toda vez que o módulo é religado nas configurações.
        // A árvore visual já está montada, e readicionar um filho que já tem pai
        // derruba o processo inteiro — ver docs/MODULES.md, "Armadilhas conhecidas".
        if (_montado)
        {
            return;
        }

        _montado = true;

        _texto.Tag = "Escreva. Salva sozinho.";
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
        _salvar.Tick += (_, _) =>
        {
            _salvar.Stop();
            Gravar();
        };

        _estado.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
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
        // Grava antes de fechar: o Panel some, mas o que foi digitado fica.
        _salvar.Stop();
        Gravar();

        var panel = context.Archetypes.Panel;
        if (panel.Owner == Id && panel.IsVisible)
        {
            panel.Dismiss();
        }

        if (_aoMudarTexto is not null)
        {
            _texto.TextChanged -= _aoMudarTexto;
        }
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

        _salvar.Interval = TimeSpan.FromMilliseconds(Atraso);

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
        var arquivo = Arquivo;

        try
        {
            _texto.Text = File.Exists(arquivo) ? File.ReadAllText(arquivo, Encoding.UTF8) : string.Empty;
            _estado.Text = string.IsNullOrEmpty(_texto.Text) ? "Escreva. Salva sozinho." : "Salvo";
        }
        catch (Exception e)
        {
            _estado.Text = $"Não deu para ler {arquivo}: {e.Message}";
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
            var arquivo = Arquivo;
            var pasta = Path.GetDirectoryName(arquivo);
            if (!string.IsNullOrEmpty(pasta))
            {
                Directory.CreateDirectory(pasta);
            }

            var temp = arquivo + ".tmp";
            File.WriteAllText(temp, _texto.Text, Utf8);
            if (File.Exists(arquivo))
            {
                File.Replace(temp, arquivo, null);
            }
            else
            {
                File.Move(temp, arquivo);
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

    // ---- Configuração ---------------------------------------------------------

    private static int Milissegundos(int valor) => Math.Clamp(valor, AtrasoMinimo, AtrasoMaximo);

    public UserControl? BuildSettings()
    {
        var corpo = new StackPanel();

        corpo.Children.Add(CampoCaminho());
        corpo.Children.Add(Nota("Vazio usa o arquivo padrão, na pasta de dados. Aponte para uma pasta sincronizada se quiser o bloco em mais de uma máquina."));

        corpo.Children.Add(CampoAtraso());
        corpo.Children.Add(Nota("Quanto tempo sem digitar antes de gravar, de 200 a 5000 milissegundos."));

        return new UserControl { Content = corpo };
    }

    private FrameworkElement CampoCaminho()
    {
        var caixa = new TextBox
        {
            Text = context.ConfigScope(Id)[ChaveCaminho]?.GetValue<string>() ?? string.Empty,
            Tag = "Vazio usa o arquivo padrão",
            VerticalAlignment = VerticalAlignment.Center,
        };

        caixa.LostFocus += (_, _) =>
        {
            var caminho = caixa.Text.Trim().Trim('"');
            caixa.Text = caminho;
            Gravar(ChaveCaminho, caminho);

            // O conteúdo em tela é do arquivo antigo: grava nele antes de
            // trocar, senão o que foi digitado morre na troca.
            _salvar.Stop();
            Gravar();
            _carregado = false;
            Carregar();
        };

        return Linha("Arquivo", caixa, esticar: true);
    }

    private FrameworkElement CampoAtraso()
    {
        var caixa = new TextBox
        {
            Text = Atraso.ToString(),
            Width = 80,
            HorizontalContentAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Grava no que sair do campo, não a cada tecla: "2" a caminho de "200"
        // não pode virar dois milissegundos gravados.
        caixa.LostFocus += (_, _) =>
        {
            var valor = int.TryParse(caixa.Text, out var n) ? Milissegundos(n) : AtrasoPadrao;
            caixa.Text = valor.ToString();
            Gravar(ChaveAtraso, valor);
            _salvar.Interval = TimeSpan.FromMilliseconds(valor);
        };

        return Linha("Atraso", caixa, esticar: false);
    }

    private static FrameworkElement Linha(string rotulo, FrameworkElement campo, bool esticar)
    {
        var nome = new TextBlock { Text = rotulo, VerticalAlignment = VerticalAlignment.Center, MinWidth = 72 };

        var linha = new DockPanel { LastChildFill = esticar };
        linha.SetResourceReference(FrameworkElement.MarginProperty, "inset.4");
        DockPanel.SetDock(nome, Dock.Left);
        linha.Children.Add(nome);

        if (!esticar)
        {
            DockPanel.SetDock(campo, Dock.Left);
        }

        linha.Children.Add(campo);
        return linha;
    }

    private static TextBlock Nota(string texto)
    {
        var t = new TextBlock { Text = texto, TextWrapping = TextWrapping.Wrap };
        t.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        t.SetResourceReference(FrameworkElement.MarginProperty, "inset.4");
        return t;
    }

    private void Gravar(string chave, string valor)
    {
        context.ConfigScope(Id)[chave] = valor;
        context.SaveConfig();
    }

    private void Gravar(string chave, int valor)
    {
        context.ConfigScope(Id)[chave] = valor;
        context.SaveConfig();
    }
}
