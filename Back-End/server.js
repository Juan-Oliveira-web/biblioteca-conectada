'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { Writable } = require('node:stream');
const { DatabaseSync } = require('node:sqlite');

const PORTA = Number(process.env.PORT) || 3000;
const BANCO = process.env.BANCO || path.join(__dirname, 'biblioteca.db');
const PASTA_FRONT = path.join(__dirname, '..', 'Front-End');
const USUARIO = 'bibliotecaria';
const SENHA_MINIMA = 6;
const LIMITES = { titulo: 150, autor: 100, codigo: 30 };
const DURACAO_SESSAO = 8 * 60 * 60 * 1000;
const TAMANHO_MAXIMO_CORPO = 10 * 1024;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const db = new DatabaseSync(BANCO);
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS livros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    autor TEXT NOT NULL,
    codigo TEXT NOT NULL UNIQUE COLLATE NOCASE
  );
  CREATE TABLE IF NOT EXISTS leitores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    turma TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS emprestimos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    livro_id INTEGER NOT NULL REFERENCES livros(id),
    leitor_id INTEGER NOT NULL REFERENCES leitores(id),
    emprestado_em TEXT NOT NULL,
    prevista TEXT NOT NULL,
    devolvido_em TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS emprestimo_aberto_por_livro
    ON emprestimos(livro_id) WHERE devolvido_em IS NULL;
`);

const sessoes = new Map();

function gerarHash(senha) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, sal, 64);
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

function senhaConfere(senha, guardado) {
  const [tipo, sal, hash] = guardado.split('$');
  if (tipo !== 'scrypt' || !sal || !hash) return false;
  const esperado = Buffer.from(hash, 'hex');
  const calculado = crypto.scryptSync(senha, Buffer.from(sal, 'hex'), esperado.length);
  return crypto.timingSafeEqual(esperado, calculado);
}

function criarSessao() {
  const token = crypto.randomBytes(32).toString('hex');
  sessoes.set(token, Date.now() + DURACAO_SESSAO);
  return token;
}

function tokenDaRequisicao(req) {
  const cookies = req.headers.cookie || '';
  const achado = cookies.split(';').map((c) => c.trim()).find((c) => c.startsWith('sid='));
  return achado ? achado.slice(4) : null;
}

function estaLogada(req) {
  const token = tokenDaRequisicao(req);
  const validade = token && sessoes.get(token);
  if (!validade) return false;
  if (validade < Date.now()) {
    sessoes.delete(token);
    return false;
  }
  return true;
}

function responder(res, status, dados, cabecalhos = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...cabecalhos,
  });
  res.end(JSON.stringify(dados));
}

function erro(res, status, mensagem) {
  responder(res, status, { erro: mensagem });
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const partes = [];
    req.on('data', (parte) => {
      total += parte.length;
      if (total > TAMANHO_MAXIMO_CORPO) {
        partes.length = 0;
        if (total - parte.length <= TAMANHO_MAXIMO_CORPO) {
          reject(Object.assign(new Error('grande'), { grande: true }));
        }
        return;
      }
      partes.push(parte);
    });
    req.on('end', () => {
      try {
        const dados = JSON.parse(Buffer.concat(partes).toString('utf-8'));
        resolve(dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function texto(dados, campo) {
  return typeof dados[campo] === 'string' ? dados[campo].trim() : '';
}

function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dataValida(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [ano, mes, dia] = valor.split('-').map(Number);
  const data = new Date(ano, mes - 1, dia);
  return data.getFullYear() === ano && data.getMonth() === mes - 1 && data.getDate() === dia;
}

function listarLivros(filtro = '', parametros = []) {
  const linhas = db
    .prepare(
      `SELECT l.id, l.titulo, l.autor, l.codigo,
              e.id IS NOT NULL AS emprestado, e.prevista,
              r.nome || ' (' || r.turma || ')' AS leitor
       FROM livros l
       LEFT JOIN emprestimos e ON e.livro_id = l.id AND e.devolvido_em IS NULL
       LEFT JOIN leitores r ON r.id = e.leitor_id
       ${filtro}
       ORDER BY l.titulo COLLATE NOCASE`
    )
    .all(...parametros);
  return linhas.map((linha) => ({ ...linha, emprestado: Boolean(linha.emprestado) }));
}

function listarLeitores(filtro = '', parametros = []) {
  return db
    .prepare(`SELECT id, nome, turma FROM leitores ${filtro} ORDER BY nome COLLATE NOCASE`)
    .all(...parametros)
    .map((linha) => ({ ...linha }));
}

function listarEmprestimos(filtro = '', parametros = []) {
  return db
    .prepare(
      `SELECT e.id, e.livro_id AS livroId, e.leitor_id AS leitorId,
              l.codigo || ' - ' || l.titulo AS livro,
              r.nome || ' (' || r.turma || ')' AS leitor,
              e.emprestado_em AS emprestadoEm, e.prevista, e.devolvido_em AS devolvidoEm
       FROM emprestimos e
       JOIN livros l ON l.id = e.livro_id
       JOIN leitores r ON r.id = e.leitor_id
       ${filtro}
       ORDER BY e.id`
    )
    .all(...parametros)
    .map((linha) => ({ ...linha }));
}

function semDadosDeAlunos(req, livros) {
  return estaLogada(req) ? livros : livros.map(({ leitor, ...publico }) => publico);
}

function exigeLogin(req, res) {
  if (estaLogada(req)) return true;
  erro(res, 401, 'Esta ação é exclusiva da bibliotecária. Entre com a sua senha.');
  return false;
}

async function entrar(req, res) {
  const { senha } = await lerCorpo(req);
  const usuario = db.prepare('SELECT senha_hash FROM usuarios WHERE nome = ?').get(USUARIO);
  if (!usuario) {
    return erro(res, 503, 'Nenhuma senha foi criada ainda. Rode no terminal: node server.js criar-senha');
  }
  if (typeof senha !== 'string' || !senhaConfere(senha, usuario.senha_hash)) {
    return erro(res, 401, 'Senha incorreta.');
  }
  const token = criarSessao();
  responder(res, 200, { ok: true }, {
    'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DURACAO_SESSAO / 1000}`,
  });
}

function sair(req, res) {
  const token = tokenDaRequisicao(req);
  if (token) sessoes.delete(token);
  responder(res, 200, { ok: true }, {
    'Set-Cookie': 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
  });
}

async function cadastrarLivro(req, res) {
  if (!exigeLogin(req, res)) return;
  const dados = await lerCorpo(req);
  const campos = {};
  for (const nome of Object.keys(LIMITES)) campos[nome] = texto(dados, nome);
  if (!Object.values(campos).every(Boolean)) return erro(res, 400, 'Preencha título, autor e código.');
  if (Object.entries(LIMITES).some(([nome, limite]) => campos[nome].length > limite)) {
    return erro(res, 400, 'Algum campo ultrapassou o tamanho máximo permitido.');
  }
  try {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO livros (titulo, autor, codigo) VALUES (?, ?, ?)')
      .run(campos.titulo, campos.autor, campos.codigo);
    responder(res, 201, listarLivros('WHERE l.id = ?', [Number(lastInsertRowid)])[0]);
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) {
      return erro(res, 409, `Já existe um livro com o código "${campos.codigo}". Cada código deve ser único.`);
    }
    throw e;
  }
}

function removerLivro(req, res, id) {
  if (!exigeLogin(req, res)) return;
  const livro = listarLivros('WHERE l.id = ?', [id])[0];
  if (!livro) return erro(res, 404, 'Livro não encontrado.');
  if (livro.emprestado) return erro(res, 409, 'Esse livro está emprestado. Registre a devolução antes de remover.');
  try {
    db.prepare('DELETE FROM livros WHERE id = ?').run(id);
    responder(res, 200, { ok: true });
  } catch (e) {
    if (/FOREIGN KEY/i.test(e.message)) {
      return erro(res, 409, 'Esse livro tem histórico de empréstimos e não pode ser removido.');
    }
    throw e;
  }
}

async function cadastrarLeitor(req, res) {
  if (!exigeLogin(req, res)) return;
  const dados = await lerCorpo(req);
  const nome = texto(dados, 'nome');
  const turma = texto(dados, 'turma');
  if (!nome || !turma) return erro(res, 400, 'Preencha nome e turma.');
  if (nome.length > 100 || turma.length > 30) {
    return erro(res, 400, 'Algum campo ultrapassou o tamanho máximo permitido.');
  }
  const repetido = db
    .prepare('SELECT 1 FROM leitores WHERE nome = ? COLLATE NOCASE AND turma = ? COLLATE NOCASE')
    .get(nome, turma);
  if (repetido) return erro(res, 409, 'Esse leitor já está cadastrado nessa turma.');
  const { lastInsertRowid } = db.prepare('INSERT INTO leitores (nome, turma) VALUES (?, ?)').run(nome, turma);
  responder(res, 201, listarLeitores('WHERE id = ?', [Number(lastInsertRowid)])[0]);
}

function removerLeitor(req, res, id) {
  if (!exigeLogin(req, res)) return;
  if (!listarLeitores('WHERE id = ?', [id]).length) return erro(res, 404, 'Leitor não encontrado.');
  const aberto = db.prepare('SELECT 1 FROM emprestimos WHERE leitor_id = ? AND devolvido_em IS NULL').get(id);
  if (aberto) return erro(res, 409, 'Esse leitor está com livro emprestado. Registre a devolução antes de remover.');
  try {
    db.prepare('DELETE FROM leitores WHERE id = ?').run(id);
    responder(res, 200, { ok: true });
  } catch (e) {
    if (/FOREIGN KEY/i.test(e.message)) {
      return erro(res, 409, 'Esse leitor tem histórico de empréstimos e não pode ser removido.');
    }
    throw e;
  }
}

async function registrarEmprestimo(req, res) {
  if (!exigeLogin(req, res)) return;
  const { leitorId, livroId, prevista } = await lerCorpo(req);
  if (!Number.isInteger(leitorId) || !Number.isInteger(livroId) || !dataValida(prevista)) {
    return erro(res, 400, 'Escolha o leitor, o livro e a data de devolução.');
  }
  if (prevista < hoje()) return erro(res, 400, 'A data de devolução não pode ser anterior a hoje.');
  if (!listarLeitores('WHERE id = ?', [leitorId]).length) return erro(res, 404, 'Leitor não encontrado.');
  if (!listarLivros('WHERE l.id = ?', [livroId]).length) return erro(res, 404, 'Livro não encontrado.');
  try {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO emprestimos (livro_id, leitor_id, emprestado_em, prevista) VALUES (?, ?, ?, ?)')
      .run(livroId, leitorId, hoje(), prevista);
    responder(res, 201, listarEmprestimos('WHERE e.id = ?', [Number(lastInsertRowid)])[0]);
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) return erro(res, 409, 'Esse livro já está emprestado.');
    throw e;
  }
}

function registrarDevolucao(req, res, id) {
  if (!exigeLogin(req, res)) return;
  const emprestimo = listarEmprestimos('WHERE e.id = ?', [id])[0];
  if (!emprestimo) return erro(res, 404, 'Empréstimo não encontrado.');
  if (emprestimo.devolvidoEm) return erro(res, 409, 'Esse empréstimo já foi devolvido.');
  db.prepare('UPDATE emprestimos SET devolvido_em = ? WHERE id = ?').run(hoje(), id);
  responder(res, 200, listarEmprestimos('WHERE e.id = ?', [id])[0]);
}

async function alterarSenha(req, res) {
  if (!exigeLogin(req, res)) return;
  const { atual, nova } = await lerCorpo(req);
  const usuario = db.prepare('SELECT senha_hash FROM usuarios WHERE nome = ?').get(USUARIO);
  if (typeof atual !== 'string' || !usuario || !senhaConfere(atual, usuario.senha_hash)) {
    return erro(res, 403, 'A senha atual está incorreta.');
  }
  if (typeof nova !== 'string' || nova.length < SENHA_MINIMA) {
    return erro(res, 400, `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`);
  }
  if (nova.length > 200) return erro(res, 400, 'A senha ultrapassou o tamanho máximo permitido.');
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE nome = ?').run(gerarHash(nova), USUARIO);
  const atualToken = tokenDaRequisicao(req);
  for (const token of sessoes.keys()) if (token !== atualToken) sessoes.delete(token);
  responder(res, 200, { ok: true });
}

function entregarArquivo(req, res, caminho) {
  const nome = caminho === '/' ? '/index.html' : caminho;
  let decodificado;
  try {
    decodificado = decodeURIComponent(nome);
  } catch {
    return erro(res, 400, 'Endereço inválido.');
  }
  const arquivo = path.normalize(path.join(PASTA_FRONT, decodificado));
  if (arquivo !== PASTA_FRONT && !arquivo.startsWith(PASTA_FRONT + path.sep)) {
    return erro(res, 403, 'Acesso negado.');
  }
  fs.readFile(arquivo, (falha, conteudo) => {
    if (falha) return erro(res, 404, 'Página não encontrada.');
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(arquivo).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : conteudo);
  });
}

async function tratar(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  const metodo = req.method;
  const idLivro = pathname.match(/^\/api\/livros\/(\d+)$/);
  const idLeitor = pathname.match(/^\/api\/leitores\/(\d+)$/);
  const idDevolucao = pathname.match(/^\/api\/emprestimos\/(\d+)\/devolucao$/);

  if (pathname === '/api/sessao' && metodo === 'GET') return responder(res, 200, { logada: estaLogada(req) });
  if (pathname === '/api/login' && metodo === 'POST') return entrar(req, res);
  if (pathname === '/api/logout' && metodo === 'POST') return sair(req, res);
  if (pathname === '/api/senha' && metodo === 'POST') return alterarSenha(req, res);
  if (pathname === '/api/livros' && metodo === 'GET') return responder(res, 200, semDadosDeAlunos(req, listarLivros()));
  if (pathname === '/api/livros' && metodo === 'POST') return cadastrarLivro(req, res);
  if (idLivro && metodo === 'DELETE') return removerLivro(req, res, Number(idLivro[1]));
  if (pathname === '/api/leitores' && metodo === 'GET') {
    return exigeLogin(req, res) && responder(res, 200, listarLeitores());
  }
  if (pathname === '/api/leitores' && metodo === 'POST') return cadastrarLeitor(req, res);
  if (idLeitor && metodo === 'DELETE') return removerLeitor(req, res, Number(idLeitor[1]));
  if (pathname === '/api/emprestimos' && metodo === 'GET') {
    return exigeLogin(req, res) && responder(res, 200, listarEmprestimos());
  }
  if (pathname === '/api/emprestimos' && metodo === 'POST') return registrarEmprestimo(req, res);
  if (idDevolucao && metodo === 'POST') return registrarDevolucao(req, res, Number(idDevolucao[1]));
  if (pathname.startsWith('/api/')) return erro(res, 404, 'Rota não encontrada.');
  if (metodo === 'GET' || metodo === 'HEAD') return entregarArquivo(req, res, pathname);
  erro(res, 405, 'Método não permitido.');
}

const servidor = http.createServer((req, res) => {
  tratar(req, res).catch((e) => {
    if (e.grande) {
      return responder(res, 413, { erro: 'Conteúdo grande demais.' }, { Connection: 'close' });
    }
    console.error(e);
    if (!res.headersSent) erro(res, 500, 'Erro interno do servidor.');
  });
});

async function criarSenha() {
  let mudo = false;
  const saida = new Writable({
    write(parte, codificacao, pronto) {
      if (!mudo) process.stdout.write(parte, codificacao);
      pronto();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output: saida, terminal: true });
  const perguntar = (pergunta) =>
    new Promise((resolve) => {
      rl.question(pergunta, (resposta) => {
        mudo = false;
        process.stdout.write('\n');
        resolve(resposta);
      });
      mudo = true;
    });

  const senha = await perguntar('Nova senha da bibliotecária: ');
  if (senha.length < SENHA_MINIMA) {
    rl.close();
    console.error(`A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`);
    process.exit(1);
  }
  const repetida = await perguntar('Repita a senha: ');
  rl.close();
  if (senha !== repetida) {
    console.error('As duas senhas são diferentes.');
    process.exit(1);
  }
  db.prepare('INSERT OR REPLACE INTO usuarios (nome, senha_hash) VALUES (?, ?)').run(USUARIO, gerarHash(senha));
  console.log('Senha salva.');
}

if (process.argv[2] === 'criar-senha') {
  criarSenha();
} else {
  servidor.listen(PORTA, '127.0.0.1', () => {
    console.log(`Servidor no ar: http://localhost:${PORTA}`);
  });
}
