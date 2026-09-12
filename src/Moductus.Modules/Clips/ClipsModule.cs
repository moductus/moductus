using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Moductus.Core.Clipboard;
using Moductus.Core.Commands;
using Moductus.Core.Config;
using Moductus.Core.Modules;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;

namespace Moductus.Modules.Clips;

/// <summary>
/// Histórico de clipboard navegável por teclado, na Palette. Só texto.
/// </summary>
/// <remarks>
/// <para>
/// Gerenciadores de senha marcam o clipboard com formatos de exclusão, e
/// respeitá-los é obrigatório — ver <see cref="ClipboardPrivacy"/>. Sem
/// isso, o módulo vira algo que grava senha em disco.
/// </para>
/// <para>
/// O listener só existe enquanto o módulo está ativo, e a leitura acontece
/// só no aviso de mudança. Desligar o Clips desliga tudo.
/// </para>
/// </remarks>
public sealed class ClipsModule(ModuleContext context) : IModule
{
    private const int Preview = 70;
    private const int MaxRetries = 4;

    private const string ChaveMaxItens = "maxItems";
    private const string ChaveMaxKb = "maxItemKb";
    private const string ChaveSoMemoria = "memoryOnly";

    private const int MaxItensPadrao = 200;
    private const int MaxKbPadrao = 64;

    private ClipboardWatcher? _watcher;
    private ClipStore? _store;
    private DispatcherTimer? _retry;
    private int _retries;

    public string Id => "clips";

    public string Name => "Clips";

    public string Description => "Histórico do clipboard, só texto";

    public ModuleArchetype Archetype => ModuleArchetype.Palette;

    public char SuggestedLeaderKey => 'c';

    public bool HasSurface => true;

    private string Arquivo => Path.Combine(context.DataDirectory, "clips.json");

    private int MaxItens => Math.Clamp(context.ConfigScope(Id)[ChaveMaxItens]?.GetValue<int>() ?? MaxItensPadrao, 10, 1000);

    private int MaxBytesPorItem => Math.Clamp(context.ConfigScope(Id)[ChaveMaxKb]?.GetValue<int>() ?? MaxKbPadrao, 1, 1024) * 1024;

    private bool SoMemoria => context.ConfigScope(Id)[ChaveSoMemoria]?.GetValue<bool>() ?? false;

    public void Enable()
    {
        _store = ClipStore.Load(SoMemoria ? new SemDisco(Arquivo) : new PhysicalConfigFile(Arquivo));
        Aparar();
        _watcher = new ClipboardWatcher(context.Messages);
        _watcher.Changed += AgendarLeitura;

        context.Commands.Register(Id, new PaletteCommand(
            "clips:clear", "Limpar histórico do clipboard", $"Apaga os {_store.Count} itens guardados", null, Limpar));
    }

    public void Disable()
    {
        context.Commands.Unregister(Id);
        _retry?.Stop();

        if (_watcher is not null)
        {
            _watcher.Changed -= AgendarLeitura;
            _watcher.Dispose();
            _watcher = null;
        }

        _store?.Save();
        _store = null;
    }

    public void Invoke()
    {
        var palette = context.Archetypes.Palette;

        if (palette.IsVisible)
        {
            palette.Dismiss();
            return;
        }

        var agora = DateTimeOffset.Now;

        palette.Placeholder = "Buscar no histórico…";
        palette.EmptyText = _store is { Count: 0 }
            ? "Nada ainda. Copie algo e ele aparece aqui."
            : "Nada com esse texto.";
        palette.SetItems((_store?.All ?? []).Select(c => new PaletteItem(
            Resumo(c.Text),
            Detalhe(c, agora),
            null,
            () => Copiar(c.Text))));
        palette.Present();
    }

    // O clipboard pode estar trancado por quem acabou de escrever nele.
    // Tenta em seguida, e de novo algumas vezes com intervalo curto.
    private void AgendarLeitura()
    {
        _retries = 0;
        _retry ??= CriarTimer();
        _retry.Stop();
        _retry.Interval = TimeSpan.FromMilliseconds(60);
        _retry.Start();
    }

    private DispatcherTimer CriarTimer()
    {
        var t = new DispatcherTimer(DispatcherPriority.Background);
        t.Tick += (_, _) =>
        {
            t.Stop();

            if (TentarLer() || ++_retries >= MaxRetries)
            {
                return;
            }

            t.Interval = TimeSpan.FromMilliseconds(120 * _retries);
            t.Start();
        };
        return t;
    }

    private bool TentarLer()
    {
        if (_store is null)
        {
            return true;
        }

        try
        {
            var dados = System.Windows.Clipboard.GetDataObject();
            if (dados is null)
            {
                return true;
            }

            if (ClipboardPrivacy.IsExcluded(dados.GetDataPresent, f => LerBytes(dados, f)))
            {
                return true;
            }

            if (!dados.GetDataPresent(DataFormats.UnicodeText))
            {
                return true;
            }

            var texto = dados.GetData(DataFormats.UnicodeText) as string;

            // Colar um log inteiro engordava o histórico em megabytes e o
            // startup pagava a leitura do arquivo.
            if (texto is not null && Encoding.UTF8.GetByteCount(texto) > MaxBytesPorItem)
            {
                return true;
            }

            if (_store.Add(texto, DateTimeOffset.Now))
            {
                Aparar();
                _store.Save();
            }

            return true;
        }
        catch (System.Runtime.InteropServices.COMException)
        {
            // CLIPBRD_E_CANT_OPEN: alguém ainda segura o clipboard.
            return false;
        }
        catch (Exception)
        {
            return true;
        }
    }

    private static byte[]? LerBytes(IDataObject dados, string formato)
    {
        try
        {
            return dados.GetData(formato) switch
            {
                MemoryStream ms => ms.ToArray(),
                byte[] b => b,
                _ => null,
            };
        }
        catch
        {
            return null;
        }
    }

    private void Copiar(string texto)
    {
        try
        {
            System.Windows.Clipboard.SetText(texto);
            context.Archetypes.Hud.Flash("Copiado do histórico", Resumo(texto, 60), HudTone.Sucesso);
        }
        catch (Exception e)
        {
            context.Archetypes.Hud.Flash("Não consegui copiar", Resumo(e.Message, 80), HudTone.Alerta);
        }
    }

    /// <summary>Corta a cauda até o teto configurado. Mais recente primeiro.</summary>
    private void Aparar()
    {
        if (_store is null)
        {
            return;
        }

        var teto = MaxItens;
        while (_store.Count > teto)
        {
            _store.Remove(_store.All[^1].Text);
        }
    }

    private void Limpar()
    {
        _store?.Clear();
        _store?.Save();
        context.Archetypes.Hud.Flash(
            "Histórico apagado",
            "O que está no clipboard agora continua lá.",
            HudTone.Sucesso);
    }

    private static string Resumo(string texto, int max = Preview)
    {
        var linha = texto.ReplaceLineEndings(" ").Trim();
        while (linha.Contains("  "))
        {
            linha = linha.Replace("  ", " ");
        }

        return linha.Length > max ? linha[..max] + "…" : linha;
    }

    private static string Detalhe(Clip c, DateTimeOffset agora)
    {
        var d = agora - c.When;
        var quando = d.TotalMinutes < 1 ? "agora"
            : d.TotalHours < 1 ? $"há {(int)d.TotalMinutes} min"
            : d.TotalDays < 1 ? $"há {(int)d.TotalHours} h"
            : c.When.ToLocalTime().ToString("dd/MM HH:mm");

        var linhas = c.Text.Count(ch => ch == '\n') + 1;
        return linhas > 1 ? $"{quando} · {linhas} linhas" : $"{quando} · {c.Text.Length} caracteres";
    }

    // ---- Configuração ---------------------------------------------------------

    public UserControl? BuildSettings()
    {
        var corpo = new StackPanel();

        corpo.Children.Add(Campo("Máximo de itens", "de 10 a 1000", MaxItens, 10, 1000, MaxItensPadrao, valor =>
        {
            Gravar(ChaveMaxItens, valor);
            Aparar();
            _store?.Save();
        }));

        corpo.Children.Add(Nota("O histórico guarda no máximo 200 itens; número maior que isso fica gravado e vale quando o teto do armazenamento subir."));

        corpo.Children.Add(Campo("Teto por item", "em KB, de 1 a 1024", MaxBytesPorItem / 1024, 1, 1024, MaxKbPadrao, valor => Gravar(ChaveMaxKb, valor)));

        corpo.Children.Add(Nota("Texto maior que isso não entra no histórico. Continua no clipboard normalmente."));

        var memoria = new CheckBox { Content = "Guardar só em memória", IsChecked = SoMemoria };
        memoria.SetResourceReference(FrameworkElement.MarginProperty, "inset.4");
        memoria.Checked += (_, _) => Gravar(ChaveSoMemoria, true);
        memoria.Unchecked += (_, _) => Gravar(ChaveSoMemoria, false);
        corpo.Children.Add(memoria);

        corpo.Children.Add(Nota("Nada do clipboard vai para disco, e o histórico some ao fechar o Moductus. Vale a partir da próxima vez que o módulo ligar."));

        return new UserControl { Content = corpo };
    }

    private static FrameworkElement Campo(string rotulo, string dica, int atual, int minimo, int maximo, int padrao, Action<int> gravar)
    {
        var caixa = new TextBox
        {
            Text = atual.ToString(),
            Width = 80,
            HorizontalContentAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Grava no que sair do campo, não a cada tecla: "1" a caminho de "100"
        // não pode virar um histórico de um item.
        caixa.LostFocus += (_, _) =>
        {
            var valor = int.TryParse(caixa.Text, out var n) ? Math.Clamp(n, minimo, maximo) : padrao;
            caixa.Text = valor.ToString();
            gravar(valor);
        };

        var nome = new TextBlock { Text = rotulo, VerticalAlignment = VerticalAlignment.Center, MinWidth = 128 };
        var detalhe = new TextBlock { Text = dica, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap };
        detalhe.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        detalhe.SetResourceReference(FrameworkElement.MarginProperty, "inset.8");

        var linha = new DockPanel { LastChildFill = true };
        linha.SetResourceReference(FrameworkElement.MarginProperty, "inset.4");
        DockPanel.SetDock(nome, Dock.Left);
        DockPanel.SetDock(caixa, Dock.Left);
        linha.Children.Add(nome);
        linha.Children.Add(caixa);
        linha.Children.Add(detalhe);

        return linha;
    }

    private static TextBlock Nota(string texto)
    {
        var t = new TextBlock { Text = texto, TextWrapping = TextWrapping.Wrap };
        t.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        t.SetResourceReference(FrameworkElement.MarginProperty, "inset.4");
        return t;
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

    /// <summary>
    /// O histórico em "só em memória": cumpre o contrato do ClipStore sem
    /// nunca ler nem escrever o arquivo.
    /// </summary>
    private sealed class SemDisco(string caminho) : IConfigFile
    {
        public string Path => caminho;

        public bool Exists() => false;

        public string Read() => "[]";

        public void WriteAtomic(string content)
        {
            // De propósito: é o ponto inteiro da opção.
        }
    }
}
