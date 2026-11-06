/* Adapter só comentário: a barra em cima de QUALQUER app que já está de pé, sem mexer nele.
 *
 * O PROBLEMA QUE ELE RESOLVE
 *
 * Os outros adapters precisam saber onde a copy mora (JSON, next-intl, i18n), porque eles
 * gravam texto. Um painel interno em Vite + React com o texto no JSX não tem nada disso, e
 * mesmo assim o que se quer ali é o ciclo designer ↔ agente: pin, rabisco, thread, feito.
 *
 * COMO FUNCIONA
 *
 * Este servidor fica NA FRENTE do app (proxy reverso em 127.0.0.1): tudo que não é /__copy
 * vai pro `alvo`, e o HTML que volta ganha as duas tags da barra antes do </body>. O
 * websocket do HMR (Vite, Next) passa direto pelo `upgrade`. O app não ganha dependência,
 * script, nem flag: abrir o endereço deste servidor em vez do app é o que liga a barra.
 *
 * Texto, token e estilo respondem "modo só comentário"; a barra, avisada pelo modo, nem
 * mostra esses botões.
 *
 * O QUE É DO REPO (copy-edit.config.mjs)
 *
 *   alvo     endereço do app                 ('http://127.0.0.1:4317')
 *   porta    porta deste servidor            (0 = uma livre)
 *   rota     rota que o terminal sugere abrir ('/')
 *   app      comando que sobe o app se ele não responder ('npm run dev'); cai junto no Ctrl+C
 */
import { request } from 'node:http';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';

const TAGS =
  '<link rel="stylesheet" href="/__copy/editor.css">\n<script src="/__copy/editor.js" defer></script>\n';

const SO_COMENTARIO = { erro: 'modo só comentário: este repo não grava texto pelo editor. Comente (C) ou rabisque (R).' };

export function injetar(html) {
  if (html.includes('/__copy/editor.js')) return html;
  return html.includes('</body>') ? html.replace('</body>', TAGS + '</body>') : html + TAGS;
}

export function criar(root, op = {}) {
  if (!op.alvo) throw new Error('so-comentario: falta `alvo` na config (o endereço do app, ex. http://127.0.0.1:4317)');
  const alvo = new URL(op.alvo);

  /* Proxy de uma requisição. HTML é bufferizado pra injetar a barra; o resto passa em
     stream (vídeo com Range incluso, que é o que o player do app pede). */
  function servir(req, res, url) {
    return new Promise((pronto) => {
      const headers = { ...req.headers, host: alvo.host };
      /* Sem compressão: o HTML precisa chegar em texto pra receber as tags. */
      delete headers['accept-encoding'];
      const sai = request(
        { hostname: alvo.hostname, port: alvo.port, path: url, method: req.method, headers },
        (r) => {
          const tipo = String(r.headers['content-type'] || '');
          /* `ce=preview` é a régua de celular: a mesma página, sem a barra dentro. */
          if (!tipo.includes('text/html') || url.includes('ce=preview')) {
            res.writeHead(r.statusCode || 502, r.headers);
            r.pipe(res);
            r.on('end', () => pronto(true));
            return;
          }
          const pedacos = [];
          r.on('data', (c) => pedacos.push(c));
          r.on('end', () => {
            const corpo = injetar(Buffer.concat(pedacos).toString('utf8'));
            const h = { ...r.headers, 'cache-control': 'no-store' };
            delete h['content-length'];
            delete h['content-encoding'];
            res.writeHead(r.statusCode || 200, h);
            res.end(corpo);
            pronto(true);
          });
        }
      );
      sai.on('error', () => {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`copy-edit: o app não respondeu em ${alvo.origin}. Ele está de pé?`);
        pronto(true);
      });
      req.pipe(sai);
    });
  }

  /* Websocket (HMR): repassa o handshake cru e liga os dois sockets. */
  function aoUpgrade(req, socket, head) {
    const up = connect(Number(alvo.port) || 80, alvo.hostname, () => {
      const linhas = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const [k, v] = [req.rawHeaders[i], req.rawHeaders[i + 1]];
        linhas.push(`${k}: ${k.toLowerCase() === 'host' ? alvo.host : v}`);
      }
      up.write(linhas.join('\r\n') + '\r\n\r\n');
      if (head && head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    const fim = () => {
      up.destroy();
      socket.destroy();
    };
    up.on('error', fim);
    socket.on('error', fim);
  }

  /* O app já de pé é o caso comum (o hub sobe ele). Parado, e com `app` na config, sobe
     aqui e cai junto no Ctrl+C. */
  function subirApp(sair) {
    let filho = null;
    fetch(alvo.origin, { method: 'HEAD' }).catch(() => {
      if (!op.app) return console.log(`  O app não respondeu em ${alvo.origin}. Suba ele (ou ponha \`app\` na config).`);
      console.log(`  App parado: subindo \`${op.app}\`…`);
      filho = spawn(op.app, { cwd: root, shell: true, stdio: 'inherit' });
      if (sair) filho.on('exit', sair);
    });
    return () => filho && filho.kill();
  }

  function aoSubir(porta, sair) {
    console.log('');
    console.log(`  Comentários no ar: http://127.0.0.1:${porta}${op.rota || '/'}   (app em ${alvo.origin})`);
    console.log('');
    console.log('  C comenta um elemento, R rabisca na tela, F abre a fila.');
    console.log('  Tudo vai pra docs/COMENTARIOS-IA.md (rabisco em docs/comentarios/<n>.png).');
    console.log('  Ctrl+C encerra.');
    console.log('');
    return subirApp(sair);
  }

  return {
    nome: 'so-comentario',
    modo: 'comentario',
    porta: op.porta ?? 0,
    dicaComentarios: op.dicaComentarios ?? '',
    servir,
    aoUpgrade,
    chaves: () => ({ status: 200, corpo: { arquivo: '', chaves: {} } }),
    salvar: () => ({ status: 409, corpo: SO_COMENTARIO }),
    tokens: () => [],
    token: () => SO_COMENTARIO,
    estilo: () => SO_COMENTARIO,
    aoSubir,
    portaOcupada: (p) => `A porta ${p} já está ocupada. Troque a \`porta\` no copy-edit.config.mjs ou use 0.`,
  };
}
