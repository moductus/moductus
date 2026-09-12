using System.IO;
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

    public void Enable()
    {
        _store = ClipStore.Load(new PhysicalConfigFile(Arquivo));
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

            if (_store.Add(texto, DateTimeOffset.Now))
            {
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

    public UserControl? BuildSettings() => null;
}
