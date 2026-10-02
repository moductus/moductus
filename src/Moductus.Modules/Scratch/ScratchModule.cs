using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Threading;
using Moductus.Core.Modules;
using Moductus.Core.Text;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;

namespace Moductus.Modules.Scratch;

/// <summary>
/// Bloco de notas que desliza do topo e salva sozinho. Um arquivo só, na
/// pasta de dados — em modo portable, ao lado do executável.
///
/// O que se vê é markdown realçado enquanto se digita; o que vai para o disco
/// é texto puro, com os asteriscos e as cerquilhas no lugar. Ver
/// <see cref="RealceMarkdown"/>.
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

    private readonly RichTextBox _texto = new();
    private readonly TextBlock _dica = new();
    private readonly TextBlock _arquivo = new();
    private readonly TextBlock _contagem = new();
    private readonly Grid _folha = new();
    private readonly DockPanel _corpo = new();
    private readonly DispatcherTimer _salvar = new() { Interval = Debounce };

    /// <summary>
    /// Guardado em campo porque Disable desassina e religar o módulo precisa
    /// reassinar. Lambda anônima não dá para remover, e o texto continuaria
    /// indo para o disco com o módulo desligado.
    /// </summary>
    private TextChangedEventHandler? _aoMudarTexto;

    /// <summary>
    /// O chip da barra de título: "Salvo", "Salvando…". Guardado aqui porque a
    /// barra é do Panel, que troca de dono — quem volta a ocupá-lo repõe o
    /// próprio estado, em vez de herdar o do vizinho ou ficar sem nenhum.
    /// </summary>
    private (string? Texto, PanelChip Tom) _chip;

    private bool _carregado;
    private bool _sujo;

    /// <summary>Repintar mexe no documento, e mexer no documento chama TextChanged de novo.</summary>
    private bool _pintando;

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
            if (_pintando)
            {
                return;
            }

            Pintar();

            if (!_carregado)
            {
                return;
            }

            // Só no primeiro toque depois de salvo: reescrever o chip a cada
            // tecla trocaria o estilo dele à toa enquanto se digita.
            if (!_sujo)
            {
                Estado("Salvando…", PanelChip.Neutro);
            }

            _sujo = true;
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

        _texto.AcceptsReturn = true;
        _texto.AcceptsTab = true;
        _texto.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _texto.Height = double.NaN;
        _texto.VerticalContentAlignment = VerticalAlignment.Top;
        _texto.BorderThickness = new Thickness(0);
        _texto.Background = null;

        // Sem borda não há o que afastar por dentro, e o recuo do campo faria a
        // dica, que fica por fora dele, cair 12px à esquerda do texto de verdade.
        _texto.Padding = default;
        _texto.SetResourceReference(Control.FontSizeProperty, "type.body");

        // 16 e não 8: o texto começa na mesma régua da keycap da barra de
        // título e do nome do arquivo no rodapé, em vez de 8px fora dela.
        _texto.SetResourceReference(FrameworkElement.MarginProperty, "inset.16");

        // O documento é o arquivo: sem recuo de página, sem margem de parágrafo.
        // Quem dá o respiro é a margem do campo, que vem do token.
        _texto.Document.PagePadding = default;

        // Colar de um navegador traz fonte, cor e tamanho embutidos, e isso
        // sobreviveria ao realce e iria parar no arquivo como texto certo com
        // aparência errada. Só o texto entra.
        DataObject.AddPastingHandler(_texto, SoTexto);
        _texto.PreviewKeyDown += QuebraSempreDivideParagrafo;

        // Uma dica dentro do campo, como no TextBox: cursor sozinho no vazio
        // parece campo quebrado. O rodapé fala de gravação, não repete isto.
        _dica.Text = "Escreva. Salva sozinho.";
        _dica.IsHitTestVisible = false;
        _dica.SetResourceReference(TextBlock.ForegroundProperty, "text.muted");
        _dica.SetResourceReference(TextBlock.FontSizeProperty, "type.body");
        _dica.SetResourceReference(FrameworkElement.MarginProperty, "inset.16");
        _dica.VerticalAlignment = VerticalAlignment.Top;

        _salvar.Tick += (_, _) =>
        {
            _salvar.Stop();
            Gravar();
        };

        // Rodapé: de que arquivo é este bloco, à esquerda, e quanto já se
        // escreveu nele, à direita. Ações não há o que pôr: o bloco salva
        // sozinho, e copiar ou limpar é o Ctrl+A de qualquer campo de texto.
        _arquivo.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        _arquivo.SetResourceReference(TextBlock.FontFamilyProperty, "font.mono");
        _arquivo.VerticalAlignment = VerticalAlignment.Center;
        _arquivo.TextTrimming = TextTrimming.CharacterEllipsis;
        _arquivo.TextWrapping = TextWrapping.NoWrap;

        _contagem.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        _contagem.SetResourceReference(FrameworkElement.MarginProperty, "inset.start.8");
        _contagem.VerticalAlignment = VerticalAlignment.Center;
        _contagem.TextWrapping = TextWrapping.NoWrap;

        var linhaRodape = new DockPanel();
        DockPanel.SetDock(_contagem, Dock.Right);
        linhaRodape.Children.Add(_contagem);
        linhaRodape.Children.Add(_arquivo);

        var rodape = new Border { Child = linhaRodape };
        rodape.SetResourceReference(FrameworkElement.StyleProperty, "style.panel.footer");

        // Construído uma vez. Um elemento só pode ter um pai lógico: montar
        // um painel novo a cada Invoke com os mesmos filhos derruba o app.
        _folha.Children.Add(_texto);
        _folha.Children.Add(_dica);

        DockPanel.SetDock(rodape, Dock.Bottom);
        _corpo.Children.Add(rodape);
        _corpo.Children.Add(_folha);
    }

    /// <summary>
    /// Escreve o chip na barra, se a barra ainda for deste módulo. A gravação
    /// do debounce e a do fechamento chegam com o Panel já de outro dono, ou
    /// escondido; aí o estado só fica guardado para a próxima abertura.
    /// </summary>
    private void Estado(string? texto, PanelChip tom = PanelChip.Neutro)
    {
        _chip = (texto, tom);

        var panel = context.Archetypes.Panel;
        if (panel.IsShowingFor(Id))
        {
            panel.ShowChip(texto, tom);
        }
    }

    /// <summary>O nome do arquivo no rodapé, com o caminho inteiro na dica.</summary>
    private void Rodape(string arquivo)
    {
        _arquivo.Text = Path.GetFileName(arquivo);
        _arquivo.ToolTip = arquivo;
        _arquivo.ClearValue(TextBlock.ForegroundProperty);
    }

    /// <summary>
    /// O erro inteiro no rodapé, em perigo: o chip só cabe "Não salvou", e a
    /// pessoa precisa do motivo — disco cheio, pasta sem permissão — para
    /// resolver.
    /// </summary>
    private void Erro(string chip, string mensagem)
    {
        Estado(chip, PanelChip.Perigo);
        _arquivo.Text = mensagem;
        _arquivo.ToolTip = mensagem;
        _arquivo.SetResourceReference(TextBlock.ForegroundProperty, "danger");
    }

    /// <summary>
    /// Cola texto puro ou não cola: formatação de fora não entra no bloco. De
    /// quebra normaliza o fim de linha, senão um texto com \n solto entra como
    /// quebra dentro de um parágrafo só, e o realce enxergaria tudo como uma
    /// linha.
    /// </summary>
    private static void SoTexto(object sender, DataObjectPastingEventArgs e)
    {
        if (e.SourceDataObject.GetData(DataFormats.UnicodeText) is not string texto)
        {
            e.CancelCommand();
            return;
        }

        var limpo = new DataObject();
        limpo.SetData(DataFormats.UnicodeText, texto.ReplaceLineEndings("\r\n"));

        e.DataObject = limpo;
        e.FormatToApply = DataFormats.UnicodeText;
    }

    /// <summary>
    /// Shift+Enter no RichTextBox quebra a linha dentro do parágrafo. Aqui um
    /// parágrafo é uma linha do arquivo, e duas linhas num parágrafo só sairiam
    /// realçadas como uma. As duas quebras fazem a mesma coisa.
    /// </summary>
    private void QuebraSempreDivideParagrafo(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Return || (Keyboard.Modifiers & ModifierKeys.Shift) == 0)
        {
            return;
        }

        e.Handled = true;

        // Enter com texto selecionado troca a seleção pela quebra. Sem isto, o
        // Shift+Enter deixaria a seleção no lugar e ainda quebraria a linha.
        if (!_texto.Selection.IsEmpty)
        {
            _texto.Selection.Text = string.Empty;
        }

        _texto.CaretPosition = _texto.CaretPosition.InsertParagraphBreak();
    }

    public void Disable()
    {
        // Grava antes de fechar: o Panel some, mas o que foi digitado fica.
        _salvar.Stop();
        Gravar();

        var panel = context.Archetypes.Panel;
        if (panel.IsShowingFor(Id))
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

        if (panel.DismissIfShowing(Id))
        {
            return;
        }

        _salvar.Interval = TimeSpan.FromMilliseconds(Atraso);

        panel.Dismissed += GravarAoFechar;
        panel.Occupy(Id, "Scratch", PanelPlacement.Top, _corpo);
        panel.ShowChip(_chip.Texto, _chip.Tom);
        panel.TakeFocus(_texto);

        if (_carregado)
        {
            AoFim();
            return;
        }

        // Ler o arquivo e montar o FlowDocument realçado custa o tamanho do
        // bloco de notas — o tokenizador roda por linha —, e dentro do Invoke
        // isso apareceria como a tecla líder demorando a responder. A superfície
        // entra primeiro; o texto chega no passo seguinte do Dispatcher, que é
        // de prioridade mais alta que a do teclado e portanto acontece antes de
        // qualquer tecla ser processada.
        Estado("Lendo…");
        panel.Dispatcher.BeginInvoke(DispatcherPriority.Background, () =>
        {
            Carregar();
            AoFim();
        });
    }

    /// <summary>O cursor vai para o fim do que foi escrito, que é onde se continua.</summary>
    private void AoFim() => _texto.CaretPosition = _texto.Document.ContentEnd;

    /// <summary>
    /// Repinta o markdown e devolve o cursor onde estava. O realce troca os Runs
    /// do parágrafo, e trocar Run debaixo do cursor o jogaria para o começo.
    /// </summary>
    private void Pintar()
    {
        _pintando = true;

        try
        {
            var cursor = _texto.CaretPosition;
            var paragrafo = cursor.Paragraph;
            var coluna = paragrafo is null ? -1 : RealceMarkdown.Coluna(paragrafo, cursor);

            RealceMarkdown.Reformatar(_texto.Document);

            // Se o parágrafo do cursor foi partido em vários, ele já não existe.
            // Aí o cursor fica onde o WPF o deixou, que é perto o bastante.
            if (paragrafo is not null && RealceMarkdown.Vive(paragrafo, _texto.Document))
            {
                _texto.CaretPosition = RealceMarkdown.Ponto(paragrafo, coluna);
            }

            _dica.Visibility = EmBranco() ? Visibility.Visible : Visibility.Collapsed;
        }
        finally
        {
            _pintando = false;
        }
    }

    /// <summary>Documento sem uma letra sequer — é o que faz a dica aparecer.</summary>
    private bool EmBranco()
        => _texto.Document.Blocks.Count == 0
        || (_texto.Document.Blocks.Count == 1
            && _texto.Document.Blocks.FirstBlock is Paragraph unico
            && unico.Inlines.OfType<Run>().All(corrido => corrido.Text.Length == 0));

    private void Carregar()
    {
        var arquivo = Arquivo;

        _pintando = true;

        try
        {
            var conteudo = File.Exists(arquivo) ? File.ReadAllText(arquivo, Encoding.UTF8) : string.Empty;
            RealceMarkdown.Escrever(_texto.Document, conteudo);
            Rodape(arquivo);
            _contagem.Text = TextStats.Label(conteudo);

            // Arquivo vazio não tem o que estar salvo: o chip só aparece quando
            // há texto que a pessoa poderia ter medo de perder.
            Estado(conteudo.Length == 0 ? null : "Salvo", PanelChip.Sucesso);
        }
        catch (Exception e)
        {
            Erro("Não abriu", $"Não deu para ler {arquivo}: {e.Message}");
        }
        finally
        {
            _pintando = false;
        }

        _dica.Visibility = EmBranco() ? Visibility.Visible : Visibility.Collapsed;
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
            var texto = RealceMarkdown.Ler(_texto.Document);
            File.WriteAllText(temp, texto, Utf8);
            if (File.Exists(arquivo))
            {
                File.Replace(temp, arquivo, null);
            }
            else
            {
                File.Move(temp, arquivo);
            }

            _sujo = false;
            Rodape(arquivo);

            // Conta no salvar, não a cada tecla: o texto já foi lido do
            // documento para ir ao disco, e contar de novo a cada letra seria
            // percorrer o bloco inteiro por nada. O debounce é curto o bastante
            // para o número acompanhar quem escreve.
            _contagem.Text = TextStats.Label(texto);
            Estado("Salvo", PanelChip.Sucesso);
        }
        catch (Exception e)
        {
            Erro("Não salvou", $"Não salvou: {e.Message}");
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
        corpo.Children.Add(SettingsUI.Note("Vazio usa o arquivo padrão, na pasta de dados. Aponte para uma pasta sincronizada se quiser o bloco em mais de uma máquina."));

        corpo.Children.Add(CampoAtraso());
        corpo.Children.Add(SettingsUI.Note("Quanto tempo sem digitar antes de gravar, de 200 a 5000 milissegundos."));

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

        return SettingsUI.Row("Arquivo", caixa, esticar: true);
    }

    private FrameworkElement CampoAtraso()
    {
        var caixa = SettingsUI.NumberBox(Atraso.ToString());

        // Grava no que sair do campo, não a cada tecla: "2" a caminho de "200"
        // não pode virar dois milissegundos gravados.
        caixa.LostFocus += (_, _) =>
        {
            var valor = int.TryParse(caixa.Text, out var n) ? Milissegundos(n) : AtrasoPadrao;
            caixa.Text = valor.ToString();
            Gravar(ChaveAtraso, valor);
            _salvar.Interval = TimeSpan.FromMilliseconds(valor);
        };

        return SettingsUI.Row("Atraso", caixa, esticar: false);
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
