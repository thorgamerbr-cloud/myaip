const express = require('express');
const axios = require('axios');
const app = express();

// =============================================
// CONFIGURAÇÕES — edite conforme seu ambiente
// =============================================
const CONFIG = {
  WAHA_BASE_URL: process.env.WAHA_URL || 'http://localhost:3000',   // URL do seu WAHA
  WAHA_SESSION:  process.env.WAHA_SESSION || 'default',             // Nome da sessão WAHA
  WAHA_API_KEY:  process.env.WAHA_API_KEY || '',                    // API key do WAHA (se configurado)
  API_KEY:       process.env.API_KEY || 'troque-esta-chave-secreta', // Sua chave pública da API
  PORT:          process.env.PORT || 3001,
};
// =============================================

/**
 * Formata número para o padrão do WAHA: 553791282091@c.us
 */
function formatarNumero(numero) {
  // Remove tudo que não for dígito
  const digits = numero.replace(/\D/g, '');
  return `${digits}@c.us`;
}

/**
 * Middleware de autenticação por API key
 */
function autenticar(req, res, next) {
  const key = req.query.key || req.headers['x-api-key'];
  if (!key || key !== CONFIG.API_KEY) {
    return res.status(401).json({ erro: 'API key inválida ou ausente' });
  }
  next();
}

/**
 * GET /foto/:numero?key=SUA_CHAVE
 * Retorna a imagem de perfil do WhatsApp diretamente (proxy)
 */
app.get('/foto/:numero', autenticar, async (req, res) => {
  const { numero } = req.params;
  const contactId = formatarNumero(numero);

  try {
    // 1) Busca a URL da foto no WAHA
    const wahaHeaders = {};
    if (CONFIG.WAHA_API_KEY) {
      wahaHeaders['X-Api-Key'] = CONFIG.WAHA_API_KEY;
    }

    const wahaRes = await axios.get(
      `${CONFIG.WAHA_BASE_URL}/api/${CONFIG.WAHA_SESSION}/contacts/profile-picture`,
      {
        params: { contactId },
        headers: wahaHeaders,
        timeout: 10000,
      }
    );

    const fotoUrl = wahaRes.data?.profilePictureURL || wahaRes.data?.url || wahaRes.data;

    if (!fotoUrl || typeof fotoUrl !== 'string') {
      return res.status(404).json({ erro: 'Foto de perfil não encontrada para este número' });
    }

    // 2) Baixa a imagem e faz proxy — sem expor a URL original
    const imgRes = await axios.get(fotoUrl, {
      responseType: 'stream',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    });

    const contentType = imgRes.headers['content-type'] || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=300'); // cache 5 min
    res.setHeader('X-Powered-By', 'waha-foto-api');

    imgRes.data.pipe(res);

  } catch (err) {
    const status = err.response?.status;

    if (status === 404) {
      return res.status(404).json({ erro: 'Número não encontrado ou sem foto de perfil' });
    }
    if (status === 401 || status === 403) {
      return res.status(502).json({ erro: 'Falha de autenticação no WAHA' });
    }

    console.error('[ERRO]', err.message);
    res.status(500).json({ erro: 'Erro interno ao buscar a foto', detalhe: err.message });
  }
});

/**
 * GET /info/:numero?key=SUA_CHAVE
 * Retorna JSON com a URL da foto (útil para debug)
 */
app.get('/info/:numero', autenticar, async (req, res) => {
  const { numero } = req.params;
  const contactId = formatarNumero(numero);

  try {
    const wahaHeaders = {};
    if (CONFIG.WAHA_API_KEY) {
      wahaHeaders['X-Api-Key'] = CONFIG.WAHA_API_KEY;
    }

    const wahaRes = await axios.get(
      `${CONFIG.WAHA_BASE_URL}/api/${CONFIG.WAHA_SESSION}/contacts/profile-picture`,
      {
        params: { contactId },
        headers: wahaHeaders,
        timeout: 10000,
      }
    );

    res.json({
      numero,
      contactId,
      fotoProxyUrl: `${req.protocol}://${req.get('host')}/foto/${numero}?key=${req.query.key}`,
      wahaResposta: wahaRes.data,
    });

  } catch (err) {
    res.status(err.response?.status || 500).json({
      erro: err.message,
      detalhes: err.response?.data,
    });
  }
});

/**
 * GET /health — verifica se a API está de pé
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', waha: CONFIG.WAHA_BASE_URL, sessao: CONFIG.WAHA_SESSION });
});

app.listen(CONFIG.PORT, () => {
  console.log(`\n✅ API rodando em http://localhost:${CONFIG.PORT}`);
  console.log(`📸 Exemplo: http://localhost:${CONFIG.PORT}/foto/5511999999999?key=${CONFIG.API_KEY}\n`);
});
