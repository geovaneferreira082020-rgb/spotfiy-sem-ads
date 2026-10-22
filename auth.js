// auth.js
// Regras de autenticação: cadastro, login, token JWT e o middleware que protege as rotas.

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./database');
const { asyncHandler } = require('./middleware');

const SALT_ROUNDS = 10;
const TOKEN_TTL = '2h';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72; // o bcrypt ignora tudo que passa de 72 bytes

const JWT_SECRET = loadSecret();

// A chave vem do ambiente (.env). Em desenvolvimento usamos uma chave fixa só para facilitar,
// mas avisamos; em produção o servidor se recusa a subir sem uma chave de verdade.
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Defina a variável JWT_SECRET antes de iniciar em produção.');
  }

  console.warn('[auth] JWT_SECRET não definida: usando uma chave de desenvolvimento. Configure o .env antes de publicar.');
  return 'chave-apenas-para-desenvolvimento';
}

const asText = (value) => (typeof value === 'string' ? value.trim() : '');

// Devolve a mensagem do primeiro problema encontrado, ou null se os dados estão ok.
function validateRegistration({ username, email, password }) {
  if (username.length < 3 || username.length > 30) {
    return 'O nome de usuário deve ter entre 3 e 30 caracteres.';
  }
  if (!EMAIL_PATTERN.test(email)) {
    return 'Informe um e-mail válido.';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `A senha pode ter no máximo ${MAX_PASSWORD_LENGTH} caracteres.`;
  }
  return null;
}

// Resposta padrão de cadastro e login: o token e os dados públicos do usuário.
function issueSession(user) {
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: TOKEN_TTL,
  });

  return { token, user: { id: user.id, username: user.username, email: user.email } };
}

// Middleware: exige o header "Authorization: Bearer <token>" e deixa o usuário em req.user.
function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Faça login para continuar.' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    next();
  } catch {
    res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' });
  }
}

const authRouter = express.Router();

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const username = asText(body.username);
    const email = asText(body.email).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';

    const problem = validateRegistration({ username, email, password });
    if (problem) return res.status(400).json({ error: problem });

    try {
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      const id = await db.createUser({ username, email, passwordHash });
      // Já devolve a sessão: quem acabou de criar a conta entra direto no app.
      res.status(201).json(issueSession({ id, username, email }));
    } catch (err) {
      if (db.isUniqueViolation(err)) {
        return res.status(409).json({ error: 'Esse e-mail ou nome de usuário já está em uso.' });
      }
      throw err;
    }
  })
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const email = asText(body.email).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';

    const user = email ? await db.findUserByEmail(email) : null;
    const passwordMatches = user ? await bcrypt.compare(password, user.password) : false;

    // Mesma mensagem para "e-mail não existe" e "senha errada",
    // assim ninguém descobre quais e-mails têm conta.
    if (!passwordMatches) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    res.json(issueSession(user));
  })
);

// Usado pelo frontend ao abrir a página: confirma que o token ainda vale e traz os dados do usuário.
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await db.findUserById(req.user.id);
    if (!user) return res.status(401).json({ error: 'Sua sessão não é mais válida. Entre novamente.' });

    res.json({ user });
  })
);

module.exports = { authRouter, requireAuth };
