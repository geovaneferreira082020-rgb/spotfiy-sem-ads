// middleware.js
// Pequenos middlewares usados pelo servidor.

// O Express 4 não captura sozinho erros de funções async.
// Este wrapper repassa a rejeição para o errorHandler, evitando try/catch em toda rota.
const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

// Qualquer rota /api/... que não existe cai aqui, sempre com resposta em JSON.
const apiNotFound = (req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
};

// O Express só reconhece um error handler se a função tiver exatamente 4 parâmetros.
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'O corpo da requisição não é um JSON válido.' });
  }

  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor. Tente novamente em instantes.' });
};

module.exports = { asyncHandler, apiNotFound, errorHandler };
