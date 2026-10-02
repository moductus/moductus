using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Shapes;
using System.Windows.Threading;
using Moductus.Core.Interop;
using Moductus.Core.Modules;
using Moductus.Core.Text;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;

namespace Moductus.Modules.Ports;

/// <summary>
/// Portas TCP locais em escuta, com o processo dono, e um botão para
/// encerrar. O maior retorno para o público de dev.
/// </summary>
/// <remarks>
/// Invoke retorna rápido: o Panel aparece com "carregando" e a tabela é lida
/// em <c>Task.Run</c>. Encerrar é irreversível de verdade, então pede uma
/// segunda pressão no mesmo botão — inline, sem diálogo.
/// </remarks>
public sealed class PortsModule(ModuleContext context) : IModule
{
    private const string ChaveEsconderSistema = "hideSystemPorts";
    private const string ChaveRecarregar = "autoRefreshSeconds";

    /// <summary>Abaixo disto é porta reservada a serviço do sistema.</summary>
    private const int PrimeiraPortaDeUsuario = 1024;

    private const int SegundosPadrao = 0;
    private const int SegundosMaximo = 3600;

    /// <summary>
    /// As colunas que têm a largura do conteúdo. Cabeçalho e linhas são Grids
    /// separados, e é o grupo compartilhado que mantém as colunas alinhadas.
    /// </summary>
    private const string ColunaPid = "pid";
    private const string ColunaOnde = "onde";
    private const string ColunaAcao = "acao";

    private readonly TextBox _filtro = new();
    private readonly StackPanel _linhas = new();
    private readonly TextBlock _estado = new();
    private FrameworkElement _cabecalho = new Border();
    private readonly Ellipse _ponto = new();
    private readonly TextBlock _atualizado = new();
    private readonly DockPanel _corpo = new();
    private readonly DispatcherTimer _auto = new();

    /// <summary>
    /// Reescreve o "há N s" do rodapé. Um segundo é o degrau mais fino que o
    /// texto mostra; mais rápido seria trabalho para nada.
    /// </summary>
    private readonly DispatcherTimer _relogio = new() { Interval = TimeSpan.FromSeconds(1) };

    private IReadOnlyList<Linha> _todas = [];

    /// <summary>Quando a última leitura terminou bem. Nulo antes da primeira.</summary>
    private DateTime? _lidoEm;

    /// <summary>Lendo agora: o rodapé diz isso em vez da idade da leitura anterior.</summary>
    private bool _lendo;

    /// <summary>A última leitura falhou: o ponto do rodapé fica em perigo até a próxima dar certo.</summary>
    private bool _falhou;

    /// <summary>A árvore visual só é construída uma vez, por mais que Enable repita.</summary>
    private bool _montado;

    public string Id => "ports";

    public string Name => "Ports";

    public string Description => "Portas locais ocupadas, e quem as ocupa";

    public ModuleArchetype Archetype => ModuleArchetype.Panel;

    public char SuggestedLeaderKey => 'o';

    public bool HasSurface => true;

    private bool EsconderSistema => context.ConfigScope(Id)[ChaveEsconderSistema]?.GetValue<bool>() ?? false;

    private int SegundosAteRecarregar => Segundos(context.ConfigScope(Id)[ChaveRecarregar]?.GetValue<int>() ?? SegundosPadrao);

    /// <summary>
    /// Endereço cru não responde a pergunta que a pessoa tem. "0.0.0.0" e "::"
    /// são a mesma coisa dita em duas pilhas, e o que importa é se a porta está
    /// exposta na rede ou presa na máquina.
    /// </summary>
    private static string Onde(string address) => address switch
    {
        "0.0.0.0" or "::" => "todas",
        "127.0.0.1" or "::1" => "local",
        _ => address,
    };

    private sealed record Linha(TcpListener Porta, string Processo, bool Desconhecido, string Enderecos);

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

        _filtro.Tag = "Filtrar por número da porta ou nome do processo";
        _filtro.TextChanged += (_, _) => Render();

        // F5 vale no painel inteiro, não só no filtro: com o foco num
        // "Encerrar", recarregar para ver se a porta soltou é o passo seguinte.
        _corpo.PreviewKeyDown += (_, e) =>
        {
            if (e.Key == Key.F5)
            {
                e.Handled = true;
                Carregar();
            }
        };

        _estado.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        _estado.HorizontalAlignment = HorizontalAlignment.Center;
        _estado.TextAlignment = TextAlignment.Center;
        _estado.SetResourceReference(FrameworkElement.MarginProperty, "inset.y.16");

        _auto.Tick += (_, _) => Carregar();
        _relogio.Tick += (_, _) => Rodape();

        // Construído uma vez: um elemento só pode ter um pai lógico.
        var atualizar = new Button { Content = "Atualizar", ToolTip = "Lê a tabela TCP de novo (F5)" };
        atualizar.SetResourceReference(FrameworkElement.StyleProperty, "style.button.ghost");
        atualizar.SetResourceReference(FrameworkElement.MarginProperty, "inset.start.8");
        atualizar.Click += (_, _) => Carregar();

        var topo = new DockPanel();
        topo.SetResourceReference(FrameworkElement.MarginProperty, "inset.8");
        DockPanel.SetDock(atualizar, Dock.Right);
        topo.Children.Add(atualizar);
        topo.Children.Add(_filtro);

        // O cabeçalho rola junto com as linhas, dentro do mesmo painel: a barra
        // de rolagem tira largura só de quem está dentro dela, e um cabeçalho
        // de fora ficaria com as colunas da direita desencontradas das linhas.
        var tabela = new StackPanel();
        tabela.SetResourceReference(FrameworkElement.MarginProperty, "inset.list");
        _cabecalho = Cabecalho();
        _cabecalho.Visibility = Visibility.Collapsed;
        tabela.Children.Add(_cabecalho);
        tabela.Children.Add(_estado);
        tabela.Children.Add(_linhas);

        var rolagem = new ScrollViewer { Content = tabela, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };

        var rodape = MontarRodape();

        DockPanel.SetDock(topo, Dock.Top);
        DockPanel.SetDock(rodape, Dock.Bottom);
        _corpo.Children.Add(topo);
        _corpo.Children.Add(rodape);
        _corpo.Children.Add(rolagem);

        Grid.SetIsSharedSizeScope(_corpo, true);
    }

    public void Disable()
    {
        _auto.Stop();
        _relogio.Stop();

        // O Panel continuaria na tela operando um módulo desligado — e o botão
        // "Encerrar" continuaria matando processo.
        var panel = context.Archetypes.Panel;
        if (panel.IsShowingFor(Id))
        {
            panel.Dismiss();
        }
    }

    public void Invoke()
    {
        var panel = context.Archetypes.Panel;

        if (panel.DismissIfShowing(Id))
        {
            return;
        }

        panel.Dismissed -= PararAoFechar;
        panel.Dismissed += PararAoFechar;
        panel.Occupy(Id, "Ports", PanelPlacement.Center, _corpo);
        panel.TakeFocus(_filtro);

        Carregar();
        ReiniciarAuto();
        _relogio.Start();
    }

    /// <summary>
    /// Recarregar com o Panel fechado gastaria a tabela TCP inteira para
    /// ninguém ver.
    /// </summary>
    private void PararAoFechar()
    {
        context.Archetypes.Panel.Dismissed -= PararAoFechar;
        _auto.Stop();
        _relogio.Stop();
    }

    private void ReiniciarAuto()
    {
        _auto.Stop();

        var segundos = SegundosAteRecarregar;
        if (segundos <= 0)
        {
            return;
        }

        _auto.Interval = TimeSpan.FromSeconds(segundos);
        _auto.Start();
    }

    private async void Carregar()
    {
        _lendo = true;
        Rodape();

        // A mensagem no meio só quando não há lista para mostrar: com linhas na
        // tela, a releitura automática faria o aviso piscar em cima delas a
        // cada ciclo. O rodapé já diz que está lendo.
        if (_todas.Count == 0)
        {
            _estado.Text = "Lendo a tabela TCP…";
            _estado.Visibility = Visibility.Visible;
        }

        IReadOnlyList<TcpListener> portas;

        try
        {
            portas = await Task.Run(TcpListeners.Listening);
        }
        catch (Exception e)
        {
            _lendo = false;
            _falhou = true;
            _estado.Text = $"Não deu para ler a tabela TCP: {e.Message}";
            _estado.Visibility = Visibility.Visible;
            Rodape();
            return;
        }

        // Uma porta em escuta nas duas pilhas aparece duas vezes na tabela do
        // Windows — 0.0.0.0 e ::. São a mesma porta do mesmo processo, e listar
        // as duas só faz a lista parecer o dobro do tamanho.
        _todas = portas
            .GroupBy(p => (p.Port, p.ProcessId))
            .Select(g =>
            {
                var p = g.First();
                var (nome, desconhecido) = NomeDoProcesso(p.ProcessId);
                var enderecos = string.Join(", ", g.Select(x => Onde(x.Address)).Distinct(StringComparer.Ordinal));
                return new Linha(p, nome, desconhecido, enderecos);
            })
            .OrderBy(l => l.Porta.Port)
            .ToList();

        _lendo = false;
        _falhou = false;
        _lidoEm = DateTime.Now;

        // A leitura volta depois do Panel ter ido para outro módulo: a contagem
        // é desta lista, e escrevê-la na barra do vizinho seria mentir.
        var panel = context.Archetypes.Panel;
        if (panel.IsShowingFor(Id))
        {
            panel.ShowChip($"{_todas.Count} em escuta");
        }

        Render();
        Rodape();
    }

    private void Render()
    {
        _linhas.Children.Clear();

        var q = _filtro.Text.Trim();
        var escondendo = EsconderSistema;
        var visiveis = _todas.Where(l =>
            (!escondendo || l.Porta.Port >= PrimeiraPortaDeUsuario)
            && (q.Length == 0
                || l.Porta.Port.ToString().Contains(q, StringComparison.Ordinal)
                || l.Processo.Contains(q, StringComparison.OrdinalIgnoreCase))).ToList();

        // Sem linha, sem cabeçalho: as colunas automáticas não têm o que medir,
        // e os títulos encolhidos se amontoavam no canto em cima do aviso.
        _cabecalho.Visibility = visiveis.Count == 0 ? Visibility.Collapsed : Visibility.Visible;

        if (visiveis.Count == 0)
        {
            // Ainda lendo pela primeira vez: o aviso de leitura fica.
            if (_lendo && _todas.Count == 0)
            {
                return;
            }

            _estado.Text = _todas.Count == 0 ? "Nenhuma porta TCP em escuta."
                : q.Length == 0 ? "Só portas de sistema em escuta. Desmarque a opção em Ajustar para vê-las."
                : $"Nada com \"{q}\". Filtra por número da porta ou nome do processo.";
            _estado.Visibility = Visibility.Visible;
            return;
        }

        _estado.Visibility = Visibility.Collapsed;

        foreach (var l in visiveis)
        {
            _linhas.Children.Add(BuildLinha(l));
        }
    }

    // ---- Tabela ---------------------------------------------------------------

    /// <summary>
    /// As cinco colunas, iguais no cabeçalho e em cada linha: porta, processo
    /// (a que estica), pid, onde escuta e a ação.
    /// </summary>
    private static Grid Colunas()
    {
        var grade = new Grid();
        grade.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grade.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grade.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto, SharedSizeGroup = ColunaPid });
        grade.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto, SharedSizeGroup = ColunaOnde });
        grade.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto, SharedSizeGroup = ColunaAcao });
        return grade;
    }

    private static void Por(Grid grade, UIElement filho, int coluna)
    {
        Grid.SetColumn(filho, coluna);
        grade.Children.Add(filho);
    }

    private static FrameworkElement Cabecalho()
    {
        var grade = Colunas();

        Por(grade, Titulo("PORTA", "size.port"), 0);
        Por(grade, Titulo("PROCESSO"), 1);
        Por(grade, Titulo("PID", margem: "inset.column"), 2);
        Por(grade, Titulo("ONDE", margem: "inset.column"), 3);

        // Mesmo recuo da linha, mais a altura de uma: o cabeçalho é a régua
        // que as linhas de baixo seguem.
        var faixa = new Border { Child = grade };
        faixa.SetResourceReference(Border.PaddingProperty, "inset.8.h");
        faixa.SetResourceReference(FrameworkElement.MinHeightProperty, "size.row");
        faixa.SetResourceReference(Border.BorderBrushProperty, "border.subtle");
        faixa.SetResourceReference(Border.BorderThicknessProperty, "border.width.bottom");
        faixa.SetResourceReference(FrameworkElement.MarginProperty, "inset.bottom.8");
        return faixa;
    }

    private static TextBlock Titulo(string texto, string? largura = null, string? margem = null)
    {
        var t = new TextBlock { Text = texto, VerticalAlignment = VerticalAlignment.Center };
        t.SetResourceReference(FrameworkElement.StyleProperty, "style.section");

        if (largura is not null)
        {
            t.SetResourceReference(FrameworkElement.WidthProperty, largura);
        }

        if (margem is not null)
        {
            t.SetResourceReference(FrameworkElement.MarginProperty, margem);
        }

        return t;
    }

    private FrameworkElement BuildLinha(Linha l)
    {
        var porta = new TextBlock { Text = l.Porta.Port.ToString(), VerticalAlignment = VerticalAlignment.Center };
        porta.SetResourceReference(FrameworkElement.WidthProperty, "size.port");
        porta.SetResourceReference(TextBlock.FontFamilyProperty, "font.mono");
        porta.SetResourceReference(TextBlock.FontWeightProperty, "weight.semibold");

        var processo = new TextBlock
        {
            Text = l.Processo,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        if (l.Desconhecido)
        {
            processo.SetResourceReference(TextBlock.ForegroundProperty, "text.muted");
        }

        // O pid em mono e atenuado: é número de consulta, não o que se lê
        // primeiro. Sem pid quando é o próprio sistema, que tem pid 0.
        var pid = new TextBlock
        {
            Text = l.Porta.ProcessId == 0 ? "—" : l.Porta.ProcessId.ToString(),
            VerticalAlignment = VerticalAlignment.Center,
        };
        pid.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        pid.SetResourceReference(TextBlock.FontFamilyProperty, "font.mono");
        pid.SetResourceReference(FrameworkElement.MarginProperty, "inset.column");

        var endereco = new TextBlock { Text = l.Enderecos, VerticalAlignment = VerticalAlignment.Center };
        endereco.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        endereco.SetResourceReference(FrameworkElement.MarginProperty, "inset.column");

        var encerrar = new Button { Content = "Encerrar", IsEnabled = !l.Desconhecido };
        encerrar.SetResourceReference(FrameworkElement.HeightProperty, "size.button.compact");
        encerrar.SetResourceReference(Control.PaddingProperty, "inset.button.compact");
        encerrar.SetResourceReference(Control.FontSizeProperty, "type.caption");
        encerrar.SetResourceReference(FrameworkElement.MarginProperty, "inset.column");
        encerrar.VerticalAlignment = VerticalAlignment.Center;

        if (l.Desconhecido)
        {
            encerrar.ToolTip = "Sem elevação não dá para encerrar este processo daqui.";
        }

        var grade = Colunas();
        Por(grade, porta, 0);
        Por(grade, processo, 1);
        Por(grade, pid, 2);
        Por(grade, endereco, 3);
        Por(grade, encerrar, 4);

        var linha = new Border { Child = grade, Background = System.Windows.Media.Brushes.Transparent };
        linha.SetResourceReference(FrameworkElement.MinHeightProperty, "size.row");
        linha.SetResourceReference(Border.PaddingProperty, "inset.8.h");
        linha.SetResourceReference(Border.CornerRadiusProperty, "radius.control");

        var confirmando = false;

        // Fantasma parado, perigo quando a linha está na mira — mouse em cima
        // ou foco de teclado nela. Uma lista inteira de botões vermelhos
        // gritaria "perigo" em cada linha; o vermelho só aparece onde a pessoa
        // está prestes a agir.
        void Pintar()
        {
            var naMira = linha.IsMouseOver || linha.IsKeyboardFocusWithin;

            if (naMira)
            {
                linha.SetResourceReference(Border.BackgroundProperty, "bg.hover");
            }
            else
            {
                linha.Background = System.Windows.Media.Brushes.Transparent;
            }

            var perigo = (naMira || confirmando) && encerrar.IsEnabled;
            encerrar.SetResourceReference(FrameworkElement.StyleProperty, perigo ? "style.button.danger" : "style.button.ghost");

            // Parado, o texto do fantasma vai em secundário: em text.primary a
            // coluna de "Encerrar" pesava mais que a de processos. O valor local
            // ganharia do vermelho do perigo e do atenuado do desabilitado, então
            // só vale no fantasma habilitado.
            if (!perigo && encerrar.IsEnabled)
            {
                encerrar.SetResourceReference(Control.ForegroundProperty, "text.secondary");
            }
            else
            {
                encerrar.ClearValue(Control.ForegroundProperty);
            }

            // Pedindo confirmação, o véu de perigo fica parado, sem depender do
            // hover: é o que diz que a segunda pressão vai matar o processo.
            if (confirmando)
            {
                encerrar.SetResourceReference(Control.BackgroundProperty, "danger.veil");
            }
            else
            {
                encerrar.ClearValue(Control.BackgroundProperty);
            }
        }

        linha.MouseEnter += (_, _) => Pintar();
        linha.MouseLeave += (_, _) => Pintar();
        linha.IsKeyboardFocusWithinChanged += (_, _) => Pintar();

        var volta = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
        volta.Tick += (_, _) =>
        {
            volta.Stop();
            confirmando = false;
            encerrar.Content = "Encerrar";
            Pintar();
        };
        encerrar.Click += (_, _) =>
        {
            if (!confirmando)
            {
                confirmando = true;
                encerrar.Content = "Confirmar";
                Pintar();
                volta.Start();
                return;
            }

            volta.Stop();
            Encerrar(l);
        };

        Pintar();
        return linha;
    }

    // ---- Rodapé ---------------------------------------------------------------

    private Border MontarRodape()
    {
        _ponto.SetResourceReference(FrameworkElement.StyleProperty, "style.dot.muted");
        _ponto.SetResourceReference(FrameworkElement.MarginProperty, "inset.end.8");

        _atualizado.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        _atualizado.VerticalAlignment = VerticalAlignment.Center;
        _atualizado.TextTrimming = TextTrimming.CharacterEllipsis;
        _atualizado.TextWrapping = TextWrapping.NoWrap;

        var dica = new TextBlock { Text = "F5 atualiza", VerticalAlignment = VerticalAlignment.Center };
        dica.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        dica.SetResourceReference(FrameworkElement.MarginProperty, "inset.start.8");

        var conteudo = new DockPanel();
        DockPanel.SetDock(_ponto, Dock.Left);
        DockPanel.SetDock(dica, Dock.Right);
        conteudo.Children.Add(_ponto);
        conteudo.Children.Add(dica);
        conteudo.Children.Add(_atualizado);

        var rodape = new Border { Child = conteudo };
        rodape.SetResourceReference(FrameworkElement.StyleProperty, "style.panel.footer");
        return rodape;
    }

    /// <summary>
    /// O ponto e a frase do rodapé: verde com a idade da última leitura,
    /// neutro enquanto lê, vermelho quando a leitura falhou.
    /// </summary>
    private void Rodape()
    {
        string texto;
        string ponto;

        if (_lendo)
        {
            texto = "Lendo a tabela TCP…";
            ponto = "style.dot.muted";
        }
        else if (_falhou)
        {
            texto = "A última leitura falhou";
            ponto = "style.dot.danger";
        }
        else if (_lidoEm is { } quando)
        {
            texto = $"Atualizado {Elapsed.Since(DateTime.Now - quando)}";
            ponto = "style.dot.success";
        }
        else
        {
            texto = string.Empty;
            ponto = "style.dot.muted";
        }

        var segundos = SegundosAteRecarregar;
        if (segundos > 0 && texto.Length > 0)
        {
            texto += $" · recarrega a cada {segundos} s";
        }

        _atualizado.Text = texto;
        _ponto.SetResourceReference(FrameworkElement.StyleProperty, ponto);
    }

    private void Encerrar(Linha l)
    {
        try
        {
            Process.GetProcessById((int)l.Porta.ProcessId).Kill();
            context.Archetypes.Hud.Flash(
                $"{l.Processo} encerrado",
                $"A porta {l.Porta.Port} está livre.",
                HudTone.Sucesso);
        }
        catch (Exception e)
        {
            _estado.Text = $"Não deu para encerrar {l.Processo}: {e.Message}";
            _estado.Visibility = Visibility.Visible;
            return;
        }

        // A tabela demora um instante para refletir.
        var depois = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(400) };
        depois.Tick += (_, _) => { depois.Stop(); Carregar(); };
        depois.Start();
    }

    private static (string Nome, bool Desconhecido) NomeDoProcesso(uint pid)
    {
        if (pid == 0)
        {
            return ("sistema", true);
        }

        // Sem nome quer dizer serviço do sistema, que sem elevação não dá para
        // ler. Dito na interface, não escondido.
        var nome = Processes.NameOf(pid);
        return nome is null ? ("requer elevação", true) : (nome, false);
    }

    // ---- Configuração ---------------------------------------------------------

    private static int Segundos(int valor) => Math.Clamp(valor, 0, SegundosMaximo);

    public UserControl? BuildSettings()
    {
        var corpo = new StackPanel();

        var esconder = new CheckBox
        {
            Content = "Esconder portas de sistema, abaixo de 1024",
            IsChecked = EsconderSistema,
        };
        esconder.SetResourceReference(FrameworkElement.MarginProperty, "inset.4");
        esconder.Checked += (_, _) => { Gravar(ChaveEsconderSistema, true); Render(); };
        esconder.Unchecked += (_, _) => { Gravar(ChaveEsconderSistema, false); Render(); };
        corpo.Children.Add(esconder);

        corpo.Children.Add(SettingsUI.Note("São as que aparecem como \"requer elevação\" e sobre as quais não dá para agir daqui."));

        corpo.Children.Add(Campo("Recarregar a cada", "segundos; 0 recarrega só no F5", ChaveRecarregar));

        corpo.Children.Add(SettingsUI.Note("A releitura só acontece com a lista aberta."));

        return new UserControl { Content = corpo };
    }

    private FrameworkElement Campo(string rotulo, string dica, string chave)
    {
        var caixa = SettingsUI.NumberBox(SegundosAteRecarregar.ToString());

        // Grava no que sair do campo, não a cada tecla: "1" a caminho de "10"
        // não pode virar uma releitura por segundo.
        caixa.LostFocus += (_, _) =>
        {
            var valor = int.TryParse(caixa.Text, out var n) ? Segundos(n) : SegundosPadrao;
            caixa.Text = valor.ToString();
            Gravar(chave, valor);
            ReiniciarAuto();
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
