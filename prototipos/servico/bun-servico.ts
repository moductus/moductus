import { Database } from 'bun:sqlite';
const t0 = performance.now();
const db = new Database(process.env.DB || 'bun.db');
db.exec('CREATE TABLE IF NOT EXISTS tarefas (id INTEGER PRIMARY KEY, nome TEXT, feita INTEGER)');
const ins = db.prepare('INSERT INTO tarefas (nome, feita) VALUES (?, 0)');
db.transaction(() => { for (let i = 0; i < 1000; i++) ins.run('tarefa ' + i); })();
const cont = db.prepare('SELECT count(*) AS n FROM tarefas');
const srv = Bun.serve({ hostname: '127.0.0.1', port: 0,
  fetch(req, s) { if (s.upgrade(req)) return; return Response.json(cont.get()); },
  websocket: { message(ws, m) { ws.send(m); } } });
console.log(JSON.stringify({ pronto_ms: +(performance.now() - t0).toFixed(1), porta: srv.port }));
