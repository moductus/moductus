# Como escrever um módulo

Este documento é o contrato. Se o seu módulo o respeita, ele vai parecer parte da suíte sem que você precise decidir nada de visual.

## O princípio

**Um módulo novo não desenha UI nova.** Ele escolhe um dos quatro arquétipos de janela e preenche o conteúdo.

Isso é o que torna a suíte viável: não existem dezoito interfaces para desenhar, existem quatro, e cada módulo passa a ser um problema de lógica em vez de um problema de design. É também o que faz tudo parecer da mesma família.

## Os quatro arquétipos

| Arquétipo | Onde aparece | Rouba foco | Quando usar |
|---|---|---|---|
| **Palette** | Centro, terço superior, 640px | Sim | Busca com lista de resultados |
| **HUD** | Pílula pequena, ancorada | Não | Feedback transitório, some sozinho em ~1,5s |
| **Panel** | Flutuante, redimensionável | Não | Conteúdo que fica aberto durante o trabalho |
| **Canvas** | Tela cheia, topmost | Sim | Operação sobre o desktop congelado |

HUD e Panel usam `WS_EX_NOACTIVATE` e nunca roubam foco. Palette guarda o `HWND` anterior e devolve o foco ao fechar.

As janelas dos arquétipos são **singletons criadas e escondidas no startup**, não construídas sob demanda. Isso não é otimização: é o que impede que a primeira invocação de cada módulo pague a construção da árvore visual do WPF, que custa os mesmos ~300ms que o produto inteiro promete não gastar.

## A interface

```csharp
public interface IModule
{
    string Id { get; }                  // "ports"
    string Name { get; }                // "Ports"
    string Description { get; }
    ModuleArchetype Archetype { get; }

    char SuggestedLeaderKey { get; }    // letra padrão; o usuário pode trocar
    bool HasSurface { get; }            // false em módulo puro de estado (Awake)

    void Enable();                      // barato: registra letra e hotkey. Startup.
    void Disable();
    void Invoke();                      // mostra ou alterna a superfície. Atalho.

    UserControl? BuildSettings();       // painel de config, ou null
}
```

### `Enable` não é `Invoke`

Essa separação é a regra mais fácil de violar por engano, e a mais cara.

`Enable` roda **para todo módulo ativo, no startup**. Ele registra a letra e a hotkey, e nada mais. Ele não pode tocar em UI, não pode ler arquivo grande, não pode consultar o sistema.

`Invoke` roda **quando o usuário aperta o atalho**. É o único lugar onde a superfície aparece.

Se você fizer trabalho de `Invoke` dentro de `Enable`, o startup do Moductus passa a carregar a UI de todos os módulos ativos — e é assim que um app de bandeja começa a demorar três segundos para subir.

### O que o módulo recebe

O construtor recebe um `ModuleContext`, e é tudo que ele tem:

| | Para quê |
|---|---|
| `Archetypes` | Os quatro singletons. `Archetypes.Hud.Flash("texto")` é o feedback mais barato que existe. |
| `ConfigScope(id)` | O `JsonObject` sob `modules.<id>`. O módulo não enxerga a raiz. |
| `SaveConfig()` | Grava tudo, atomicamente. |
| `Theme` | Modo atual e evento de mudança. |

**O módulo não registra letra nem hotkey.** O host faz isso a partir de `SuggestedLeaderKey`, respeitando o que o usuário configurou, e mostra colisão na tela de configurações. O módulo só implementa `Invoke`.

O `AwakeModule` em `src/Moductus.Modules/Awake/` é o exemplo mínimo: dez linhas de lógica, um `Flash` no HUD, e nada no `Enable`.

### Usando o Panel

O Panel é um singleton compartilhado. O padrão que Peek, Ports e Scratch seguem:

```csharp
var panel = context.Archetypes.Panel;

// Toggle: só fecha se for nosso e não estiver fixado.
if (panel.IsVisible && panel.Owner == Id && !panel.IsPinned) { panel.Dismiss(); return; }

panel.Owner = Id;
panel.Heading = "Ports";
panel.Placement = PanelPlacement.Center;   // ou Top, para deslizar de cima
panel.SlotContent = corpo;
panel.Dismissed += Soltar;                 // miniatura, timer, arquivo
panel.Present();
panel.TakeFocus(_filtro);                  // só se o módulo tem digitação
```

`Present` nunca rouba foco. `TakeFocus` é opt-in e deliberado: o usuário pediu esta superfície, então focar o campo dela não é interrupção. Peek não chama; Ports e Scratch chamam.

**Trabalho lento não entra no `Invoke`.** O Ports mostra o Panel com "lendo…" e lê a tabela TCP em `Task.Run`. A superfície aparece antes do dado, sempre.

## Nomeação

Substantivo curto, um só, em inglês. Lê bem como `Moductus · Ports` e é digitável na paleta.

A letra do líder **não é derivada da inicial** — três módulos disputam o `p`. Ela é dado explícito, registrado centralmente e configurável pelo usuário, e a colisão é detectada no startup.

## Interop

Use o [CsWin32](https://github.com/microsoft/CsWin32). Adicione o nome exato da função ao `NativeMethods.txt` e deixe o gerador escrever a assinatura P/Invoke.

Nunca escreva `[DllImport]` à mão. Assinatura de struct errada compila, roda, e corrompe memória em silêncio numa versão específica do Windows — é o bug mais caro de achar neste tipo de projeto.

## Prompt base para geração assistida

Cole no topo de todo prompt de módulo novo. É isso que mantém o código gerado dentro do sistema.

```
Contexto: projeto Moductus, C# .NET 10, WPF, processo único.
WPF puro — não use WinForms, nem para o ícone de bandeja.
Usar CsWin32 para todo P/Invoke — cite a API do Windows pelo nome exato.

Regras obrigatórias:
- Implementar IModule (Id, Name, Description, Archetype, SuggestedLeaderKey,
  HasSurface, Enable, Disable, Invoke, BuildSettings)
- Enable é barato e roda no startup; Invoke é quem mostra a superfície
- Usar EXCLUSIVAMENTE um dos quatro arquétipos: Palette, HUD, Panel, Canvas
- Nenhuma cor, tamanho, raio ou duração literal no código — só chaves do Tokens.xaml
- Esc fecha; Enter é a ação primária; a hotkey é toggle
- HUD e Panel usam WS_EX_NOACTIVATE e não roubam foco
- Nenhuma chamada de rede
- Nenhum MessageBox: erro vai inline no overlay
- Estado vazio precisa de texto explicativo
- Nenhuma dependência NuGet nova sem eu aprovar

Módulo a construir: <nome>
Arquétipo: <um dos quatro>
API principal: <nome exato da função Win32>
Comportamento: <descrição>
```

**Nomeie a API pelo nome exato.** A diferença de acerto entre pedir `DwmRegisterThumbnail` e pedir "uma miniatura ao vivo da janela" é grande.

## Armadilhas conhecidas

Anotações que economizam dias de depuração, por módulo:

- **Clips** — gerenciadores de senha marcam o clipboard com `ExcludeClipboardContentFromMonitorProcessing` e `CanIncludeInClipboardHistory`. Respeitar isso é obrigatório, ou o módulo vira algo que grava senha em disco.
- **Links** — symlink exige admin ou Modo Desenvolvedor, mas **junction de pasta não exige nada**. Como quase todo uso real é mover pasta pesada de disco, use junction por padrão e deixe symlink como opção avançada. Isso tira o UAC do caminho.
- **Ports** — ver o processo dono de portas de serviço do sistema exige elevação. Sem admin, alguns aparecem como desconhecidos: mostre isso na interface em vez de esconder.
- **Timer** — a bandeja pede o ícone em 16, 20, 24 ou 32px conforme o scaling do monitor. Gere o bitmap no tamanho solicitado, nunca fixo em 16.
- **Freeze** — capture o desktop como bitmap, jogue numa janela fullscreen borderless topmost, e opere régua, lupa e conta-gotas sobre esse bitmap em memória. Fica preciso e independe do que estava se movendo na tela.
- **Kill** — pode ser marcado por anti-cheat de jogo. Fica desligado por padrão e documentado no README.
- **Todo módulo com Panel** — um elemento do WPF só pode ter um pai lógico. Construir um `DockPanel` novo a cada `Invoke` e adicionar nele o mesmo `TextBox` de sempre derruba o app com "já é o filho lógico de outro elemento" — e só na **segunda** abertura, que é quando ninguém está testando. Construa o conteúdo uma vez, no `Enable`, e reutilize.
