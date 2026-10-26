'use strict';

const PRAZO_DIAS = 14;
const SENHA_MINIMA = 6;
const ABAS_RESTRITAS = ['livros', 'leitores', 'emprestimos', 'conta'];

let logada = false;
let carga = 'carregando';
let estado = { livros: [], leitores: [], emprestimos: [] };

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalizar = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const porTexto = (campo, opcoes) => (a, b) => a[campo].localeCompare(b[campo], 'pt-BR', opcoes);

const paraISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hoje = () => paraISO(new Date());
const somarDias = (iso, n) => { const [a, m, d] = iso.split('-').map(Number); return paraISO(new Date(a, m - 1, d + n)); };
const formatarData = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

const ativoDoLeitor = (id) => estado.emprestimos.some((e) => e.leitorId === id && !e.devolvidoEm);
const atrasado = (prevista) => prevista < hoje();

async function api(rota, metodo = 'GET', corpo) {
  let resposta;
  try {
    resposta = await fetch(`/api/${rota}`, {
      method: metodo,
      headers: corpo ? { 'Content-Type': 'application/json' } : {},
      body: corpo ? JSON.stringify(corpo) : undefined
    });
  } catch {
    throw Object.assign(new Error('Não foi possível falar com o servidor. Verifique se ele está ligado.'), { status: 0 });
  }
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    throw Object.assign(new Error(dados?.erro || 'Não foi possível concluir a ação.'), { status: resposta.status });
  }
  return dados;
}

async function carregar() {
  estado.livros = await api('livros');
  if (logada) [estado.leitores, estado.emprestimos] = await Promise.all([api('leitores'), api('emprestimos')]);
  else Object.assign(estado, { leitores: [], emprestimos: [] });
  carga = 'ok';
}

async function atualizar() {
  await carregar();
  renderTudo();
}

let temporizadorAviso;
function mostrarAviso(texto, tipo = 'ok') {
  const el = $('aviso');
  Object.assign(el, { textContent: texto, className: 'aviso ' + tipo, hidden: false });
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { el.hidden = true; }, 5000);
}

function expirarSessao() {
  logada = false;
  Object.assign(estado, { leitores: [], emprestimos: [] });
  renderSessao();
  renderTudo();
  abrirAba('login');
  mostrarAviso('Sua sessão expirou. Entre novamente.', 'erro');
}

const tentar = (acao) => async (...argumentos) => {
  try {
    await acao(...argumentos);
  } catch (erro) {
    if (erro.status === 401 && logada) expirarSessao();
    else mostrarAviso(erro.message, 'erro');
  }
};

function exigirLogin() {
  if (logada) return true;
  mostrarAviso('Esta ação é exclusiva da bibliotecária. Entre com a sua senha.', 'erro');
  abrirAba('login');
  return false;
}

function renderSessao() {
  document.querySelectorAll('.aba.restrita').forEach((b) => { b.hidden = !logada; });
  $('btn-entrar').hidden = logada;
  $('btn-sair').hidden = !logada;
  $('indicador-sessao').hidden = !logada;
}

const validarSenha = (senha, repeticao) =>
  senha.length < SENHA_MINIMA ? `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`
    : senha !== repeticao ? 'As duas senhas digitadas são diferentes.' : null;

function lerCampos(...ids) {
  return ids.map((id) => { const valor = $(id).value; $(id).value = ''; return valor; });
}

const aoEntrar = tentar(async (e) => {
  e.preventDefault();
  const [senha] = lerCampos('login-senha');
  await api('login', 'POST', { senha });
  logada = true;
  await atualizar();
  renderSessao();
  abrirAba('emprestimos');
  mostrarAviso('Acesso liberado.');
});

const aoAlterarSenha = tentar(async (e) => {
  e.preventDefault();
  if (!exigirLogin()) return;
  const [atual, nova, repeticao] = lerCampos('senha-atual', 'senha-nova', 'senha-nova2');
  const problema = validarSenha(nova, repeticao);
  if (problema) return mostrarAviso(problema, 'erro');
  await api('senha', 'POST', { atual, nova });
  mostrarAviso('Senha alterada com sucesso.');
});

const sair = tentar(async () => {
  await api('logout', 'POST');
  logada = false;
  await atualizar();
  renderSessao();
  abrirAba('acervo');
  mostrarAviso('Você saiu da área da bibliotecária.');
});

const selo = (classe, texto) => `<span class="selo ${classe}">${texto}</span>`;
const linha = (...celulas) => `<tr>${celulas.map((c) => `<td>${c}</td>`).join('')}</tr>`;
const lombada = (codigo) => `<span class="lombada">${esc(codigo)}</span>`;

const botaoRemover = (acao, id, bloqueado, dica) =>
  `<button type="button" class="perigo" data-acao="${acao}" data-id="${esc(id)}"${bloqueado ? ` disabled title="${dica}"` : ''}>Remover</button>`;

function tabela(corpo, vazio, linhas, mensagemVazio) {
  $(corpo).innerHTML = linhas.join('');
  Object.assign($(vazio), { textContent: mensagemVazio, hidden: linhas.length > 0 });
}

function linhaAcervo(livro, situacao, detalhes) {
  return `<tr>
    <td data-rotulo="Código">${lombada(livro.codigo)}</td>
    <td data-rotulo="Título">${esc(livro.titulo)}</td>
    <td data-rotulo="Autor">${esc(livro.autor)}</td>
    <td data-rotulo="Situação">${situacao}</td>
    <td data-rotulo="Detalhes">${detalhes}</td>
  </tr>`;
}

function mensagemAcervoVazio(total) {
  if (carga === 'carregando') return 'Carregando o acervo...';
  if (carga === 'falhou') return 'Não foi possível carregar o acervo. Verifique se o servidor está ligado.';
  if (total) return 'Nenhum livro encontrado com esse filtro ou busca.';
  return logada ? 'Nenhum livro cadastrado ainda. Use a aba Livros para começar.' : 'O acervo ainda não foi cadastrado.';
}

function renderAcervo() {
  const termo = normalizar($('busca').value.trim());
  const filtro = $('filtro').value;

  const linhas = [...estado.livros].sort(porTexto('titulo')).flatMap((livro) => {
    if ((filtro === 'disponivel' && livro.emprestado) || (filtro === 'emprestado' && !livro.emprestado)) return [];
    if (termo && !normalizar(`${livro.titulo} ${livro.autor} ${livro.codigo}`).includes(termo)) return [];
    if (!livro.emprestado) return [linhaAcervo(livro, selo('ok', 'Disponível'), '')];
    const situacao = logada && atrasado(livro.prevista) ? selo('atraso', 'Atrasado') : selo('alerta', 'Emprestado');
    const detalhes = logada
      ? `Com ${esc(livro.leitor)}, devolução até ${formatarData(livro.prevista)}`
      : `Devolução prevista para ${formatarData(livro.prevista)}`;
    return [linhaAcervo(livro, situacao, detalhes)];
  });

  const total = estado.livros.length;
  const emprestados = estado.livros.filter((l) => l.emprestado).length;
  $('resumo').textContent = carga === 'ok'
    ? `${total} livro(s) no acervo: ${total - emprestados} disponível(is) e ${emprestados} emprestado(s). Exibindo ${linhas.length}.`
    : '';
  tabela('corpo-acervo', 'vazio-acervo', linhas, mensagemAcervoVazio(total));
}

function renderLivros() {
  const linhas = [...estado.livros].sort(porTexto('codigo', { numeric: true })).map((l) =>
    linha(lombada(l.codigo), esc(l.titulo), esc(l.autor),
      botaoRemover('remover-livro', l.id, l.emprestado, 'Livro emprestado: registre a devolução antes de remover')));
  tabela('corpo-livros', 'vazio-livros', linhas, 'Nenhum livro cadastrado.');
}

function renderLeitores() {
  const linhas = [...estado.leitores].sort(porTexto('nome')).map((l) =>
    linha(esc(l.nome), esc(l.turma),
      botaoRemover('remover-leitor', l.id, ativoDoLeitor(l.id), 'Leitor com livro emprestado: registre a devolução antes de remover')));
  tabela('corpo-leitores', 'vazio-leitores', linhas, 'Nenhum leitor cadastrado.');
}

function preencherSelect(id, rotuloPadrao, itens) {
  const select = $(id);
  const atual = select.value;
  select.innerHTML = `<option value="">${rotuloPadrao}</option>` +
    itens.map(([valor, texto]) => `<option value="${esc(valor)}">${esc(texto)}</option>`).join('');
  select.value = atual;
  if (select.selectedIndex === -1) select.selectedIndex = 0;
}

function renderSelects() {
  const leitores = [...estado.leitores].sort(porTexto('nome')).map((l) => [l.id, `${l.nome} (${l.turma})`]);
  const livros = estado.livros.filter((l) => !l.emprestado).sort(porTexto('titulo')).map((l) => [l.id, `${l.codigo} - ${l.titulo}`]);
  preencherSelect('emp-leitor', 'Selecione o leitor', leitores);
  preencherSelect('emp-livro', 'Selecione o livro', livros);
}

function renderEmprestimos() {
  const abertos = estado.emprestimos.filter((e) => !e.devolvidoEm).sort((a, b) => a.prevista.localeCompare(b.prevista));
  const botaoDevolver = (id) => `<button type="button" class="pequeno" data-acao="devolver" data-id="${esc(id)}">Registrar devolução</button>`;
  tabela('corpo-abertos', 'vazio-abertos', abertos.map((e) =>
    linha(esc(e.livro), esc(e.leitor), formatarData(e.emprestadoEm), formatarData(e.prevista),
      atrasado(e.prevista) ? selo('atraso', 'Atrasado') : selo('alerta', 'No prazo'), botaoDevolver(e.id))), 'Nenhum empréstimo em aberto.');

  const devolvidos = estado.emprestimos.filter((e) => e.devolvidoEm).sort((a, b) => b.devolvidoEm.localeCompare(a.devolvidoEm));
  tabela('corpo-historico', 'vazio-historico', devolvidos.map((e) =>
    linha(esc(e.livro), esc(e.leitor), formatarData(e.emprestadoEm), formatarData(e.devolvidoEm))),
  'Nenhuma devolução registrada ainda.');
}

function renderTudo() {
  [renderAcervo, renderLivros, renderLeitores, renderSelects, renderEmprestimos].forEach((render) => render());
}

const restrita = (acao) => (argumento) => { if (exigirLogin()) tentar(acao)(argumento); };
const formulario = (acao) => (e) => { e.preventDefault(); restrita(acao)(e.target); };
const concluir = async (mensagem) => { await atualizar(); mostrarAviso(mensagem); };

const cadastrarLivro = formulario(async (form) => {
  const [titulo, autor, codigo] = ['livro-titulo', 'livro-autor', 'livro-codigo'].map((id) => $(id).value.trim());
  if (!titulo || !autor || !codigo) return mostrarAviso('Preencha título, autor e código.', 'erro');
  await api('livros', 'POST', { titulo, autor, codigo });
  form.reset();
  $('livro-titulo').focus();
  await concluir(`Livro "${titulo}" cadastrado.`);
});

const cadastrarLeitor = formulario(async (form) => {
  const [nome, turma] = ['leitor-nome', 'leitor-turma'].map((id) => $(id).value.trim());
  if (!nome || !turma) return mostrarAviso('Preencha nome e turma.', 'erro');
  await api('leitores', 'POST', { nome, turma });
  form.reset();
  $('leitor-nome').focus();
  await concluir(`Leitor "${nome}" cadastrado.`);
});

function dataPadrao() {
  const campo = $('emp-prevista');
  campo.min = hoje();
  campo.value = somarDias(hoje(), PRAZO_DIAS);
}

const registrarEmprestimo = formulario(async (form) => {
  const [leitorId, livroId] = ['emp-leitor', 'emp-livro'].map((id) => Number($(id).value));
  const prevista = $('emp-prevista').value;
  if (!leitorId || !livroId || !prevista) return mostrarAviso('Escolha o leitor, o livro e a data de devolução.', 'erro');
  if (prevista < hoje()) return mostrarAviso('A data de devolução não pode ser anterior a hoje.', 'erro');
  await api('emprestimos', 'POST', { leitorId, livroId, prevista });
  form.reset();
  dataPadrao();
  await concluir('Empréstimo registrado.');
});

const devolverLivro = restrita(async (id) => {
  await api(`emprestimos/${id}/devolucao`, 'POST');
  await concluir('Devolução registrada.');
});

const removerLivro = restrita(async (id) => {
  const livro = estado.livros.find((l) => l.id === id);
  if (!livro || !confirm(`Remover o livro "${livro.titulo}"?`)) return;
  await api(`livros/${id}`, 'DELETE');
  await concluir('Livro removido.');
});

const removerLeitor = restrita(async (id) => {
  const leitor = estado.leitores.find((l) => l.id === id);
  if (!leitor || !confirm(`Remover o leitor "${leitor.nome}"?`)) return;
  await api(`leitores/${id}`, 'DELETE');
  await concluir('Leitor removido.');
});

function abrirAba(nome) {
  if (ABAS_RESTRITAS.includes(nome) && !logada) nome = 'login';
  document.querySelectorAll('.aba').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === nome));
  document.querySelectorAll('.painel').forEach((p) => { p.hidden = p.id !== 'aba-' + nome; });
}

const acoes = { devolver: devolverLivro, 'remover-livro': removerLivro, 'remover-leitor': removerLeitor };

async function iniciar() {
  document.querySelectorAll('.aba').forEach((b) => b.addEventListener('click', () => abrirAba(b.dataset.aba)));
  [
    ['btn-entrar', 'click', () => abrirAba('login')],
    ['btn-sair', 'click', sair],
    ['form-login', 'submit', aoEntrar],
    ['form-alterar-senha', 'submit', aoAlterarSenha],
    ['form-livro', 'submit', cadastrarLivro],
    ['form-leitor', 'submit', cadastrarLeitor],
    ['form-emprestimo', 'submit', registrarEmprestimo],
    ['busca', 'input', renderAcervo],
    ['filtro', 'change', renderAcervo]
  ].forEach(([id, tipo, funcao]) => $(id).addEventListener(tipo, funcao));

  document.addEventListener('click', (e) => {
    const botao = e.target.closest('[data-acao]');
    if (botao && !botao.disabled) acoes[botao.dataset.acao]?.(Number(botao.dataset.id));
  });

  dataPadrao();
  renderSessao();
  renderTudo();

  try {
    logada = (await api('sessao')).logada;
    await carregar();
  } catch (erro) {
    carga = 'falhou';
    mostrarAviso(erro.message, 'erro');
  }
  renderSessao();
  renderTudo();
}

iniciar();
