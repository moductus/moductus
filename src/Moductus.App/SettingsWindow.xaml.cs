using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using Moductus.Core.Hotkeys;
using Moductus.Core.Startup;
using Moductus.Core.Theme;
using Moductus.UI;

// O WPF do .NET 9+ trouxe System.Windows.ThemeMode, e dentro de uma Window o
// nome ainda colide com a propriedade Window.ThemeMode. O nosso é o do Core.
using ModoEmVigor = Moductus.Core.Theme.ThemeMode;

namespace Moductus.App;

/// <summary>
/// As configurações: barra lateral com as seções e o conteúdo da escolhida.
/// Tudo vale na hora — não existe "Salvar", porque cada controle grava no
/// momento em que muda, como o resto do app sempre fez.
/// </summary>
public partial class SettingsWindow : Window
{
    /// <summary>
    /// Onde moram os XAML dos temas. É a mesma convenção que o
    /// <see cref="Theme"/> usa para carregar a paleta em vigor; aqui ela serve
    /// para ler as cores de TODOS os temas e desenhar a miniatura de cada um
    /// sem copiar valor nenhum para cá.
    /// </summary>
    private const string PastaTemas = "pack://application:,,,/Moductus.UI;component/Themes/";

    private readonly SettingsModel _model;
    private readonly Dictionary<string, UserControl?> _paineis = [];
    private readonly Dictionary<string, ModuleSettingsWindow> _janelas = [];
    private readonly Dictionary<RadioButton, FrameworkElement> _secoes;
    private readonly Dictionary<RadioButton, ThemeModePreference> _modos;

    /// <summary>
    /// Verdadeiro enquanto o código, e não a pessoa, mexe na seleção de tema
    /// ou de modo. Sem isto, mostrar o estado atual gravaria o estado atual.
    /// </summary>
    private bool _preenchendo;

    /// <summary>O modo em que as miniaturas foram desenhadas da última vez.</summary>
    private bool? _amostraClara;

    internal SettingsWindow(SettingsModel model)
    {
        InitializeComponent();
        _model = model;

        _secoes = new()
        {
            [NavGeral] = SecaoGeral,
            [NavLider] = SecaoLider,
            [NavModulos] = SecaoModulos,
            [NavAparencia] = SecaoAparencia,
            [NavAtalhos] = SecaoAtalhos,
            [NavSobre] = SecaoSobre,
        };

        _modos = new()
        {
            [ModoSistema] = ThemeModePreference.System,
            [ModoClaro] = ThemeModePreference.Light,
            [ModoEscuro] = ThemeModePreference.Dark,
        };

        SourceInitialized += (_, _) => TitleBar.Sync(this, model.Theme);

        // Trocar de modo troca as cores das miniaturas; a troca pode vir
        // daqui ou do Windows (o "Sistema" acompanha o claro e escuro dele).
        model.Theme.Changed += OnTemaMudou;
        Closed += (_, _) => model.Theme.Changed -= OnTemaMudou;

        if (model.ConfigWarning is not null)
        {
            Aviso.Text = model.ConfigWarning;
            AvisoBorda.Visibility = Visibility.Visible;
        }

        Rodape.Text = model.Location.Portable
            ? $"Modo portable — configuração em {model.Location.Path}"
            : $"Configuração em {model.Location.Path}";

        LiderDetalhe.Text = "Clique no campo, ou chegue nele com Tab, e pressione a combinação nova.";
        AtualizarEstadoLider(ouvindo: false);

        NavGeral.IsChecked = true;
        Refresh();
        OnTemaMudou();

        // A barra lateral já nasce com foco: as setas andam pelas seções sem
        // a pessoa precisar clicar em nada antes.
        Loaded += (_, _) => NavGeral.Focus();
    }

    private sealed record AtalhoItem(string[] Teclas, string Detalhe, bool Conflito);

    private sealed record ModuloItem(string Id, string Nome, bool Ativo, string Letra, string Detalhe, bool Conflito, bool TemAjuste);

    /// <summary>
    /// Um cartão da grade de temas. Os pincéis são do tema do cartão, não do
    /// tema em vigor — é o que deixa a pessoa comparar antes de escolher.
    /// </summary>
    private sealed record TemaItem(
        string Id,
        string Nome,
        string Descricao,
        Brush Base,
        Brush Elevado,
        Brush Borda,
        Brush Texto,
        Brush Mudo,
        Brush Destaque,
        Brush Sucesso,
        Brush Perigo);

    private void Refresh()
    {
        var lider = _model.Leader();
        LiderTeclas.ItemsSource = Teclas(lider.Binding);
        NavLiderAlerta.Visibility = lider.Active ? Visibility.Collapsed : Visibility.Visible;
        MostrarErroLider(lider.Active
            ? null
            : $"Em conflito: {lider.ConflictDetail}. Pressione outra combinação no campo.");

        OpacidadeCampo.Text = _model.Opacidade().ToString();
        OpacidadeDetalhe.Text =
            $"De {Opacidade.Minimo} a {Opacidade.Maximo}. Vale para a pastilha e para o Panel, e só onde o Windows aceita pintar material atrás da janela.";

        var estado = _model.Autostart.State;

        IniciarComWindows.IsChecked = estado is AutostartState.On or AutostartState.DisabledByUser;

        AutostartDetalhe.Text = estado switch
        {
            AutostartState.On => "Sobe junto com o Windows.",
            AutostartState.Off => "Não sobe com o Windows.",
            AutostartState.DisabledByUser =>
                "Está desativado na aba Inicializar do Gerenciador de Tarefas. Desligue e ligue de novo para reativar.",
            AutostartState.PointsElsewhere => "Sobe junto com o Windows, mas não esta cópia.",
            _ => string.Empty,
        };

        AutostartErro.Text = estado == AutostartState.PointsElsewhere
            ? "A entrada de inicialização aponta para outra cópia do Moductus. Desligue e ligue de novo para corrigir."
            : string.Empty;
        AutostartErroBorda.Visibility = estado == AutostartState.PointsElsewhere ? Visibility.Visible : Visibility.Collapsed;

        var letras = _model.Letters.All.ToDictionary(r => r.ModuleId);

        var modulos = _model.Modules
            .Select(m =>
            {
                var ativo = _model.IsModuleEnabled(m.Id);
                letras.TryGetValue(m.Id, out var letra);

                // Desligado não está no registro, mas a letra dele é conhecida:
                // é a que o overlay mostra atenuada, e a linha a mostra igual.
                var tecla = ativo ? letra?.Key : _model.ConfiguredLetter(m.Id);

                return new ModuloItem(
                    m.Id,
                    m.Name,
                    ativo,
                    tecla is { } t ? char.ToUpperInvariant(t).ToString() : "—",
                    letra is { Active: false } ? $"em conflito: {letra.ConflictDetail}" : m.Description,
                    letra is { Active: false },
                    ativo && Painel(m.Id) is not null);
            })
            .ToList();

        Modulos.ItemsSource = modulos;
        NavModulosContagem.Text = modulos.Count.ToString();
        NavModulosAlerta.Visibility = modulos.Any(m => m.Conflito) ? Visibility.Visible : Visibility.Collapsed;
        ModulosResumo.Text = Resumo(modulos.Count(m => m.Ativo), modulos.Count(m => !m.Ativo));

        var atalhos = _model.Hotkeys.All
            .Select(r => new AtalhoItem(
                Teclas(r.Binding),
                r.Active ? Dono(r.Owner, lider.Owner) : $"{Dono(r.Owner, lider.Owner)} — em conflito: {r.ConflictDetail}",
                !r.Active))
            .ToList();

        Atalhos.ItemsSource = atalhos;
        AtalhosVazio.Visibility = atalhos.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        NavAtalhosAlerta.Visibility = atalhos.Any(a => a.Conflito) ? Visibility.Visible : Visibility.Collapsed;
    }

    /// <summary>
    /// O nome de quem é dono do atalho, como a pessoa o conhece. O registro
    /// guarda o id interno — "leader", "clips" —, que é chave de código e não
    /// palavra que se mostre: a tecla líder ganha o nome da própria seção, e
    /// módulo ganha o nome do catálogo. Id que ninguém reconhece sai como
    /// está, para que um dono novo apareça em vez de sumir.
    /// </summary>
    private string Dono(string owner, string donoDaLider) =>
        owner == donoDaLider
            ? "Tecla líder"
            : _model.Modules.FirstOrDefault(m => m.Id == owner)?.Name ?? owner;

    /// <summary>"Ctrl+Alt+M" vira três keycaps. Nome de tecla nunca traz "+".</summary>
    private static string[] Teclas(HotkeyBinding binding) => binding.ToString().Split('+');

    private static string Resumo(int ligados, int desligados)
    {
        var parte = ligados == 1 ? "1 ligado" : $"{ligados} ligados";
        return desligados switch
        {
            0 => parte,
            1 => $"{parte} · 1 desligado",
            _ => $"{parte} · {desligados} desligados",
        };
    }

    // ---- Barra lateral e grupos de escolha ---------------------------------

    private void OnSecaoChecked(object sender, RoutedEventArgs e)
    {
        if (sender is not RadioButton item || !_secoes.TryGetValue(item, out var escolhida))
        {
            return;
        }

        foreach (var secao in _secoes.Values)
        {
            secao.Visibility = secao == escolhida ? Visibility.Visible : Visibility.Collapsed;
        }

        Rolagem.ScrollToTop();
    }

    /// <summary>
    /// Setas dentro de um grupo de escolha — a barra lateral e o modo. Andar
    /// é escolher, como no rádio do Windows: só o marcado é parada de Tab,
    /// então a seta precisa levar a marca junto com o foco, senão o foco
    /// chegaria a um item que o Tab nunca alcança.
    /// </summary>
    private void OnGrupoKeyDown(object sender, KeyEventArgs e)
    {
        var passo = e.Key switch
        {
            Key.Up or Key.Left => -1,
            Key.Down or Key.Right => 1,
            _ => 0,
        };

        if (passo == 0 || sender is not Panel grupo)
        {
            return;
        }

        var itens = grupo.Children.OfType<RadioButton>().ToList();
        if (itens.Count == 0)
        {
            return;
        }

        var atual = itens.FindIndex(r => r.IsChecked == true);

        // Na ponta, para: dar a volta da última seção para a primeira
        // desorienta mais do que ajuda numa lista de seis.
        var proximo = Math.Clamp(atual + passo, 0, itens.Count - 1);

        if (proximo != atual)
        {
            itens[proximo].IsChecked = true;
            itens[proximo].Focus();
        }

        e.Handled = true;
    }

    // ---- Aparência ---------------------------------------------------------

    /// <summary>
    /// O tema, o modo ou o sistema mudaram. As miniaturas só são refeitas
    /// quando o modo da amostra muda: refazê-las a cada troca de tema
    /// recriaria os cartões e tiraria o foco de quem está escolhendo com as
    /// setas.
    /// </summary>
    private void OnTemaMudou()
    {
        var clara = AmostraClara();

        _preenchendo = true;
        try
        {
            if (clara != _amostraClara)
            {
                Temas.ItemsSource = ThemeCatalog.Todos.Select(t => Item(t, clara)).ToList();
                _amostraClara = clara;
            }

            Temas.SelectedValue = _model.ThemeId();

            var modo = _model.ThemeMode();
            foreach (var (botao, preferencia) in _modos)
            {
                botao.IsChecked = preferencia == modo;
            }
        }
        finally
        {
            _preenchendo = false;
        }

        AltoContrasteAviso.Visibility = _model.Theme.Mode == ModoEmVigor.HighContrast
            ? Visibility.Visible
            : Visibility.Collapsed;
    }

    /// <summary>
    /// Em que modo desenhar as miniaturas: o em vigor. No alto contraste,
    /// que não é claro nem escuro, vale a preferência — e "Sistema" cai no
    /// escuro, o padrão do app.
    /// </summary>
    private bool AmostraClara() => _model.Theme.Mode switch
    {
        ModoEmVigor.Light => true,
        ModoEmVigor.Dark => false,
        _ => _model.ThemeMode() == ThemeModePreference.Light,
    };

    private static TemaItem Item(ThemeDefinition tema, bool clara)
    {
        var paleta = new ResourceDictionary
        {
            Source = new Uri($"{PastaTemas}{tema.Arquivo}.{(clara ? "Light" : "Dark")}.xaml"),
        };

        return new TemaItem(
            tema.Id,
            tema.Nome,
            tema.Descricao,
            Pincel(paleta, "bg.base"),
            Pincel(paleta, "bg.raised"),
            Pincel(paleta, "border.subtle"),
            Pincel(paleta, "text.primary"),
            Pincel(paleta, "text.muted"),
            Pincel(paleta, "accent"),
            Pincel(paleta, "success"),
            Pincel(paleta, "danger"));
    }

    /// <summary>
    /// O tema declara só <c>X.color</c>; o pincel é montado aqui como o
    /// <see cref="Theme"/> monta o dele, e congelado pelo mesmo motivo.
    /// </summary>
    private static SolidColorBrush Pincel(ResourceDictionary paleta, string token)
    {
        var pincel = new SolidColorBrush((Color)paleta[token + ".color"]);
        pincel.Freeze();
        return pincel;
    }

    private void OnTemaSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_preenchendo || Temas.SelectedValue is not string id || id == _model.ThemeId())
        {
            return;
        }

        _model.SetTheme(id);
    }

    /// <summary>
    /// Setas na grade de temas andam pela grade, e andar é escolher. A
    /// ListBox sabe andar numa lista, não numa grade: sem isto ←/→ moviam só
    /// o foco, sem trocar o tema, e ↑/↓ pulavam para o item seguinte em vez
    /// do de cima.
    /// </summary>
    private void OnTemasKeyDown(object sender, KeyEventArgs e)
    {
        var colunas = Temas.ItemContainerGenerator.ContainerFromIndex(0) is DependencyObject primeiro &&
                      VisualTreeHelper.GetParent(primeiro) is UniformGrid grade
            ? grade.Columns
            : 1;

        var passo = e.Key switch
        {
            Key.Left => -1,
            Key.Right => 1,
            Key.Up => -colunas,
            Key.Down => colunas,
            _ => 0,
        };

        if (passo == 0)
        {
            return;
        }

        var alvo = Temas.SelectedIndex + passo;

        if (alvo >= 0 && alvo < Temas.Items.Count)
        {
            Temas.SelectedIndex = alvo;
            (Temas.ItemContainerGenerator.ContainerFromIndex(alvo) as UIElement)?.Focus();
        }

        e.Handled = true;
    }

    private void OnModoChecked(object sender, RoutedEventArgs e)
    {
        if (_preenchendo || sender is not RadioButton botao || !_modos.TryGetValue(botao, out var preferencia))
        {
            return;
        }

        if (preferencia != _model.ThemeMode())
        {
            _model.SetThemeMode(preferencia);
        }
    }

    private void OnOpacidadeLostFocus(object sender, RoutedEventArgs e) => GravarOpacidade();

    // Enter aplica sem obrigar a sair do campo; Esc continua fechando a janela.
    private void OnOpacidadeKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            e.Handled = true;
            GravarOpacidade();
        }
    }

    /// <summary>
    /// Grava no que sair do campo, não a cada tecla: "2" a caminho de "20" não
    /// pode virar opacidade gravada. O que não for número volta ao valor em
    /// vigor, e o <see cref="Refresh"/> devolve o valor já preso à faixa.
    /// </summary>
    private void GravarOpacidade()
    {
        _model.SetOpacidade(int.TryParse(OpacidadeCampo.Text, out var n) ? n : _model.Opacidade());
        Refresh();
    }

    // ---- Módulos -----------------------------------------------------------

    private void OnModuloClick(object sender, RoutedEventArgs e)
    {
        if (sender is CheckBox { Tag: string id } caixa)
        {
            _model.SetModuleEnabled(id, caixa.IsChecked == true);

            // Módulo desligado não mostra painel: o que ele configura não roda.
            if (caixa.IsChecked != true && _janelas.TryGetValue(id, out var aberta))
            {
                aberta.Close();
            }

            Refresh();
        }
    }

    /// <summary>
    /// O painel de cada módulo, construído uma vez e reaproveitado. Reconstruir
    /// a cada abertura jogaria fora o que o usuário digitou e não gravou ainda.
    /// </summary>
    private UserControl? Painel(string id)
    {
        if (_paineis.TryGetValue(id, out var pronto))
        {
            return pronto;
        }

        var modulo = _model.Modules.FirstOrDefault(m => m.Id == id);
        var painel = modulo?.BuildSettings();
        _paineis[id] = painel;
        return painel;
    }

    /// <summary>
    /// Abre o ajuste do módulo em janela própria, como a janela principal
    /// faz. Inline, abaixo da lista, ele empurrava os módulos para baixo e
    /// obrigava a rolar para ver o que se estava ajustando.
    /// </summary>
    private void OnAjustarClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: string id })
        {
            return;
        }

        // Já aberta para este módulo: traz para frente em vez de abrir outra.
        if (_janelas.TryGetValue(id, out var existente) && existente.IsLoaded)
        {
            existente.Activate();
            return;
        }

        var painel = Painel(id);
        if (painel is null)
        {
            return;
        }

        var modulo = _model.Modules.First(m => m.Id == id);

        var janela = new ModuleSettingsWindow(_model.Theme, modulo.Name, modulo.Description, painel)
        {
            Owner = this,
        };

        janela.Closed += (_, _) => _janelas.Remove(id);
        _janelas[id] = janela;
        janela.Show();
    }

    // ---- Tecla líder -------------------------------------------------------

    private void OnLiderMouseDown(object sender, MouseButtonEventArgs e)
    {
        LiderCampo.Focus();
        e.Handled = true;
    }

    private void OnLiderFoco(object sender, KeyboardFocusChangedEventArgs e) =>
        AtualizarEstadoLider(ouvindo: ReferenceEquals(e.NewFocus, LiderCampo));

    /// <summary>
    /// O chip à direita do campo diz se ele está ouvindo. Sem isso, o campo
    /// focado parece igual ao parado, e a pessoa aperta a combinação no
    /// vazio.
    /// </summary>
    private void AtualizarEstadoLider(bool ouvindo)
    {
        LiderEstado.SetResourceReference(StyleProperty, ouvindo ? "style.chip.accent" : "style.chip");
        LiderEstadoTexto.Text = ouvindo ? "Ouvindo tecla…" : "Clique para trocar";
    }

    private void MostrarErroLider(string? texto)
    {
        LiderErro.Text = texto ?? string.Empty;
        LiderErroBorda.Visibility = texto is null ? Visibility.Collapsed : Visibility.Visible;
    }

    private void OnLiderKeyDown(object sender, KeyEventArgs e)
    {
        // Alt chega como Key.System com a tecla real em SystemKey.
        var key = e.Key == Key.System ? e.SystemKey : e.Key;

        // Esc fecha a janela, sempre. Tab sozinho, ou com Shift, sai do campo:
        // capturá-lo prenderia o foco aqui para quem só usa teclado.
        if (key == Key.Escape ||
            (key == Key.Tab && (Keyboard.Modifiers & ~ModifierKeys.Shift) == ModifierKeys.None))
        {
            return;
        }

        e.Handled = true;

        if (EhModificador(key))
        {
            return;
        }

        var mods = HotkeyModifiers.None;
        if (Keyboard.Modifiers.HasFlag(ModifierKeys.Control)) mods |= HotkeyModifiers.Control;
        if (Keyboard.Modifiers.HasFlag(ModifierKeys.Alt)) mods |= HotkeyModifiers.Alt;
        if (Keyboard.Modifiers.HasFlag(ModifierKeys.Shift)) mods |= HotkeyModifiers.Shift;
        if (Keyboard.Modifiers.HasFlag(ModifierKeys.Windows)) mods |= HotkeyModifiers.Windows;

        var binding = new HotkeyBinding(mods, (uint)KeyInterop.VirtualKeyFromKey(key));

        if (!binding.HasModifier)
        {
            MostrarErroLider("Precisa de pelo menos um modificador: Ctrl, Alt, Shift ou Win.");
            return;
        }

        var resultado = _model.RebindLeader(binding);
        Refresh();

        if (!resultado.Active)
        {
            MostrarErroLider($"{binding} está em conflito: {resultado.ConflictDetail}. A anterior foi mantida.");
        }
    }

    private static bool EhModificador(Key key) => key is
        Key.LeftCtrl or Key.RightCtrl or
        Key.LeftAlt or Key.RightAlt or
        Key.LeftShift or Key.RightShift or
        Key.LWin or Key.RWin;

    // ---- Geral -------------------------------------------------------------

    private void OnAutostartClick(object sender, RoutedEventArgs e)
    {
        if (IniciarComWindows.IsChecked == true)
        {
            _model.Autostart.Enable();
        }
        else
        {
            _model.Autostart.Disable();
        }

        Refresh();
    }

    // Esc fecha, sempre, sem confirmar nada.
    private void OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            Close();
        }
    }
}
