using System.Text.Json;
using Moductus.Core.Text;

namespace Moductus.Core.Tests;

public class ClipboardTransformsTests
{
    [Theory]
    [InlineData("Olá, Mundo!", "ola-mundo")]
    [InlineData("  Ação   Rápida  ", "acao-rapida")]
    [InlineData("C# é 10x melhor", "c-e-10x-melhor")]
    [InlineData("---", "")]
    public void Slug(string entrada, string esperado)
        => Assert.Equal(esperado, ClipboardTransforms.Slug(entrada));

    [Theory]
    [InlineData("nome do campo", "nomeDoCampo")]
    [InlineData("Nome_Do_Campo", "nomeDoCampo")]
    [InlineData("nomeDoCampo", "nomeDoCampo")]
    [InlineData("", "")]
    public void CamelCase(string entrada, string esperado)
        => Assert.Equal(esperado, ClipboardTransforms.CamelCase(entrada));

    [Theory]
    [InlineData("nome do campo", "nome_do_campo")]
    [InlineData("nomeDoCampo", "nome_do_campo")]
    [InlineData("Ação Rápida", "acao_rapida")]
    public void SnakeCase(string entrada, string esperado)
        => Assert.Equal(esperado, ClipboardTransforms.SnakeCase(entrada));

    [Fact]
    public void FormatJson_indenta()
    {
        var saida = ClipboardTransforms.FormatJson("""{"a":1,"b":[1,2]}""");

        Assert.Contains("\n", saida);
        Assert.Contains("\"a\": 1", saida);
    }

    [Fact]
    public void FormatJson_recusa_o_que_nao_e_json()
        => Assert.ThrowsAny<JsonException>(() => ClipboardTransforms.FormatJson("isto não é json"));

    [Theory]
    [InlineData("b2zDoQ==", "olá")]
    [InlineData("b2zDoQ", "olá")]
    [InlineData("YWI_Y2Q-", "ab?cd>")]
    public void DecodeBase64_aceita_padding_ausente_e_url_safe(string entrada, string esperado)
        => Assert.Equal(esperado, ClipboardTransforms.DecodeBase64(entrada));

    [Fact]
    public void DecodeJwt_devolve_header_e_payload_indentados()
    {
        // header {"alg":"HS256","typ":"JWT"} . payload {"sub":"123","name":"Gustavo"} . assinatura
        const string jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMiLCJuYW1lIjoiR3VzdGF2byJ9.assinatura";

        var saida = ClipboardTransforms.DecodeJwt(jwt);

        Assert.Contains("\"alg\": \"HS256\"", saida);
        Assert.Contains("\"name\": \"Gustavo\"", saida);
    }

    [Fact]
    public void DecodeJwt_recusa_sem_ponto()
        => Assert.Throws<FormatException>(() => ClipboardTransforms.DecodeJwt("semponto"));
}
