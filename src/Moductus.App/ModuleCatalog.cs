using Moductus.Core.Modules;
using Moductus.Modules.Awake;
using Moductus.Modules.Palette;
using Moductus.Modules.Peek;
using Moductus.Modules.Ports;
using Moductus.Modules.Scratch;
using Moductus.UI.Modules;

namespace Moductus.App;

/// <summary>
/// A lista completa de módulos, manual e explícita. Sem varredura de
/// assembly, sem reflection, sem atributo mágico: cabe num arquivo que dá
/// para ler de uma vez, e não custa tempo dentro do orçamento de startup.
/// </summary>
internal static class ModuleCatalog
{
    public static IReadOnlyList<IModule> Create(ModuleContext context) =>
    [
        new AwakeModule(context),
        new PeekModule(context),
        new PortsModule(context),
        new ScratchModule(context),
        new PaletteModule(context),
    ];
}
