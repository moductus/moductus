# Contribuindo com o Moductus

Obrigado pelo interesse. As regras abaixo são curtas de propósito, e existem para que a suíte continue parecendo uma coisa só à medida que cresce.

## Antes de escrever código

**Proposta de módulo vai como issue primeiro**, usando o template [Proposta de módulo](.github/ISSUE_TEMPLATE/module.yml). Um módulo que não passa pelos três filtros da tese — nasce de tecla, aparece e some, cabe no processo único — não entra na suíte, e é melhor descobrir isso antes de você escrever qualquer linha.

Vale ler [docs/PRODUCT.md](docs/PRODUCT.md#46-não-objetivos) antes de propor. A lista de não-objetivos e a de módulos cortados existem justamente para poupar seu tempo.

## Regras não negociáveis

- **Um módulo por PR.** PR que toca dois módulos vira dois PRs.
- **Todo módulo usa um dos quatro arquétipos de janela**, sem exceção: Palette, HUD, Panel ou Canvas. Módulo novo não desenha UI nova — escolhe um arquétipo e preenche o conteúdo.
- **Nenhuma cor, tamanho, raio ou duração literal no código.** Tudo vem de chaves do `Tokens.xaml`. Se falta um token, o PR discute o token antes de usar um número solto.
- **Nenhuma dependência NuGet nova sem justificativa explícita no PR.** "Facilita" não é justificativa.
- **Nenhuma chamada de rede.** Não há exceção para isso, nem para checagem de atualização.
- **Nenhum `MessageBox`.** Erro aparece inline, dentro do próprio overlay.

## Contrato de interação

Vale para todo módulo:

- `Esc` fecha, sempre, sem confirmar nada
- `Enter` executa a ação primária
- Toda hotkey é toggle: apertar de novo fecha
- HUD e Panel nunca roubam foco
- Zero som por padrão
- Zero diálogo de confirmação, exceto ação irreversível de verdade
- Estado vazio sempre tem texto explicando o que fazer, nunca fica em branco
- Toda ação alcançável por teclado

## Interop com o Windows

**Use o [CsWin32](https://github.com/microsoft/CsWin32) para todo P/Invoke.** Adicione o nome exato da função ao `NativeMethods.txt` e deixe o gerador escrever a assinatura.

Assinatura de struct escrita à mão é a maior fonte de bug difícil deste tipo de projeto — o código compila, roda, e corrompe memória em silêncio numa versão específica do Windows. PR com `[DllImport]` manual será pedido para migrar.

## Testes

O escopo de teste é deliberadamente estreito, e isso é decisão registrada, não descuido:

- **Testado:** o que está em `Moductus.Core` — registro e conflito de hotkeys, registro e colisão de letras, config portable versus instalado, migração de schema.
- **Não testado:** UI e interop com o Windows. Ambos exigem sessão gráfica real e o custo de manutenção supera o retorno.

Se o seu módulo tem lógica que dá para separar da UI e da API do Windows, separe e teste essa parte.

### Smoke test manual: não confie em `HasExited`

Quando o app crasha, o diálogo do Windows Error Reporting **segura o processo vivo** até alguém fechá-lo. `Process.HasExited` diz `false`, o pid continua na lista, e um script que só olha isso conclui "subiu sem erro". Três smoke tests deste projeto passaram assim, com o app morto por baixo.

O que funciona: depois de subir, consultar o log de eventos do Windows (`Application`, provedor `.NET Runtime`) por entradas com `Moductus` desde o início do teste. É lá que a exceção e a stack aparecem.

Para exercitar a tecla líder sem tocar na sua configuração real, use o modo portable: um `portable.txt` e um `config.json` na pasta do executável em `bin/`, que já está no `.gitignore`.

## Estilo

Siga o código vizinho. Nomenclatura, injeção de dependência, separação de camadas e formato de teste devem ser indistinguíveis do que já está no repositório.

## Como escrever um módulo

O passo a passo, com a interface `IModule` e o prompt base, está em [docs/MODULES.md](docs/MODULES.md).
