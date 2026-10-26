# Biblioteca Conectada

Sistema web de gestão da biblioteca da Escola Humberto Lucena, desenvolvido como projeto de extensão do curso de Análise e Desenvolvimento de Sistemas. A bibliotecária cadastra livros e leitores e registra empréstimos e devoluções. Qualquer pessoa pode consultar o acervo e saber quais livros estão disponíveis ou emprestados.

## Funcionalidades

- Cadastro de livros (título, autor e código único).
- Cadastro de leitores (somente nome e turma, por respeito à privacidade dos alunos).
- Registro de empréstimos, com leitor, livro e data prevista de devolução.
- Registro de devoluções e histórico de empréstimos.
- Consulta pública ao acervo, com busca por título, autor ou código e filtro por situação (todos, disponíveis, emprestados).
- Área restrita à bibliotecária, protegida por senha.
- Alteração de senha pela própria bibliotecária.

## Tecnologias

- **Front-end:** HTML, CSS e JavaScript puro, sem frameworks.
- **Back-end:** Node.js, usando apenas módulos nativos (`http`, `crypto`, `node:sqlite`). Não há dependências externas e não é necessário executar `npm install`.
- **Banco de dados:** SQLite, em um único arquivo (`biblioteca.db`), criado automaticamente.

## Requisitos

- Node.js na versão **22.5 ou superior**, por causa do módulo `node:sqlite`. Verifique com `node -v`. O módulo pode exibir um aviso de recurso experimental ao iniciar; isso é esperado. Consulte a documentação oficial do Node.js para a situação atual do módulo.
- Git, para clonar o repositório.

## Como executar

1. Clone o repositório e entre na pasta do back-end:

   ```
   git clone URL-DO-REPOSITORIO
   cd biblioteca-conectada/Back-End
   ```

2. Crie a senha da bibliotecária (mínimo de 6 caracteres; ela não aparece na tela ao ser digitada):

   ```
   node server.js criar-senha
   ```

3. Inicie o servidor:

   ```
   node server.js
   ```

4. Acesse **http://localhost:3000** no navegador.

O mesmo servidor entrega as telas da pasta `Front-End` e a API. Abra sempre pelo endereço acima: abrir o `index.html` diretamente ou por extensões como o Live Server não funciona, pois a página não encontra a API.

Para trocar a senha esquecida, execute novamente `node server.js criar-senha`; a senha anterior é substituída.

### Variáveis de ambiente (opcionais)

| Variável | Função | Padrão |
| --- | --- | --- |
| `PORT` | Porta do servidor | `3000` |
| `BANCO` | Caminho do arquivo do banco de dados | `Back-End/biblioteca.db` |

## Estrutura do projeto

```
Biblioteca/
  Back-End/
    server.js        servidor, rotas da API e acesso ao banco
    package.json
  Front-End/
    index.html       estrutura das telas
    style.css        aparência
    app.js           lógica da interface e chamadas à API
  .gitignore
  README.md
```

## API

Todas as respostas são JSON. Em caso de erro, o corpo tem o formato `{ "erro": "mensagem" }`. As rotas marcadas como restritas exigem login e respondem `401` sem sessão válida.

| Método e rota | Acesso | Descrição |
| --- | --- | --- |
| `GET /api/sessao` | público | Informa se há sessão ativa |
| `POST /api/login` | público | Entra com a senha |
| `POST /api/logout` | público | Encerra a sessão |
| `POST /api/senha` | restrito | Altera a senha |
| `GET /api/livros` | público | Lista o acervo (o nome do leitor só é enviado se logada) |
| `POST /api/livros` | restrito | Cadastra livro |
| `DELETE /api/livros/:id` | restrito | Remove livro |
| `GET /api/leitores` | restrito | Lista leitores |
| `POST /api/leitores` | restrito | Cadastra leitor |
| `DELETE /api/leitores/:id` | restrito | Remove leitor |
| `GET /api/emprestimos` | restrito | Lista empréstimos e histórico |
| `POST /api/emprestimos` | restrito | Registra empréstimo |
| `POST /api/emprestimos/:id/devolucao` | restrito | Registra devolução |

## Regras de negócio

- O código do livro é único, sem diferenciar maiúsculas de minúsculas.
- Um livro não pode ter dois empréstimos abertos ao mesmo tempo; o próprio banco de dados garante essa regra.
- A data prevista de devolução não pode ser anterior à data atual.
- Livro emprestado e leitor com empréstimo aberto não podem ser removidos.
- Leitor ou livro com histórico de empréstimos não pode ser removido, para preservar a integridade do histórico.
- Para o público, o acervo mostra apenas a situação do livro e a data prevista de devolução. Nome e turma do aluno são visíveis somente à bibliotecária.

## Segurança e privacidade

- A senha nunca é armazenada: o banco guarda apenas um hash gerado com `scrypt` e um valor aleatório (sal).
- A sessão usa um cookie `HttpOnly` e `SameSite=Lax`, inacessível ao JavaScript da página.
- Toda validação é refeita no servidor, independentemente do que o formulário já verificou.
- Todo texto exibido na interface passa por escape de HTML, o que previne a execução de scripts injetados em títulos ou nomes (XSS).
- O arquivo do banco de dados e o arquivo `.env` estão no `.gitignore` e **não devem ser enviados ao repositório**, pois podem conter dados pessoais de menores.

## Limitações conhecidas

- As sessões ficam na memória do servidor; reiniciar o servidor encerra a sessão da bibliotecária.
- Não há limite de tentativas de senha nem HTTPS. O sistema escuta apenas em `127.0.0.1` e foi pensado para uso local. Antes de publicá-lo na internet, essas lacunas precisam ser tratadas.
- A data de referência ("hoje") é a do relógio do computador onde o servidor executa.
- Todos os dados ficam em um único arquivo. Faça cópias periódicas de `biblioteca.db`.
- Não há ainda testes automatizados no repositório.
- Os dados dos alunos são pessoais e, no caso de menores, exigem atenção à LGPD. A política de retenção e de exclusão deve ser definida em conjunto com a escola.

## Próximos passos possíveis

- Renovação de empréstimo.
- Testes automatizados.
- Limite de tentativas de login e uso de HTTPS.
- Anonimização de leitores com histórico, em vez de bloquear a remoção.
- Publicação em ambiente com armazenamento permanente.

## Autoria

Projeto de extensão em grupo, curso de Análise e Desenvolvimento de Sistemas.

Autores: (Juan Pablo Oliveira Figueiredo , Andre Luiz Dias Lima Vidal,Carlos Eduardo dos Santos Sousa,Isaque José de Sousa Arcenio,Nathan Leal)
