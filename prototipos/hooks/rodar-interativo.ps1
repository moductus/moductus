Set-Location C:\Desenvolvimento\moductus-testes\hooks\projeto
$env:MODUCTUS_TOKEN = 'tk-interativo'
$prompt = 'Use a ferramenta Bash duas vezes, um comando por chamada: primeiro rode exatamente mkdir pasta-permitido e depois rode exatamente mkdir pasta-proibido. Nao tente alternativas se algum for negado. Depois diga em uma linha o que aconteceu com cada um.'
claude $prompt --settings C:\Desenvolvimento\moductus-testes\hooks\settings.json --setting-sources local --permission-mode default --model haiku
