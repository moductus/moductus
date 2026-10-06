import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
const LOG = 'C:/Desenvolvimento/moductus-testes/hooks/eventos.jsonl';
const TOKEN = process.env.MODUCTUS_TOKEN;
createServer((req, res) => {
  let corpo = '';
  req.on('data', c => corpo += c);
  req.on('end', async () => {
    const t = Date.now();
    const ev = JSON.parse(corpo || '{}');
    const autorizado = req.headers.authorization === 'Bearer ' + TOKEN;
    let resposta = {};
    const cmd0 = ev.tool_input?.command ?? '';
    if (process.env.MODO === 'pre' && ev.hook_event_name === 'PreToolUse' && cmd0.includes('pasta-')) {
      await new Promise(r => setTimeout(r, 3000));
      const permitir = cmd0.includes('permitido');
      resposta = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: permitir ? 'allow' : 'deny', permissionDecisionReason: permitir ? 'Aprovado no dock' : 'Negado pelo dock do Moductus' } };
    }
    if (ev.hook_event_name === 'PermissionRequest') {
      await new Promise(r => setTimeout(r, 3000)); // simula a pessoa decidindo no dock
      const cmd = ev.tool_input?.command ?? '';
      const permitir = cmd.includes('permitido');
      resposta = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: permitir ? { behavior: 'allow' } : { behavior: 'deny', message: 'Negado pelo dock do Moductus' } } };
    }
    appendFileSync(LOG, JSON.stringify({ quando: new Date(t).toISOString(), evento: ev.hook_event_name, autorizado, sessao: ev.session_id, cwd: ev.cwd, ferramenta: ev.tool_name, entrada: ev.tool_input, tipo: ev.notification_type, resposta, espera_ms: Date.now() - t }) + '\n');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(resposta));
  });
}).listen(47821, '127.0.0.1', () => console.log('pronto'));
