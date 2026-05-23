const express = require("express");
require("dotenv").config();

const app = express();

app.use(express.json());

/* ---------------- CORS MANUAL (VERCEL FIX) ---------------- */
app.use((req, res, next) => {
  // Permite o acesso do WhatsApp, Gmail ou qualquer outra origem
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  // CRUCIAL: Adicionado "Authorization" para permitir o envio do Token do Google
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Responde imediatamente às requisições de preflight (OPTIONS)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  next();
});

/* ---------------- CONFIG ---------------- */
const PORT = process.env.PORT || 3000;

/* Controlo de limites por e-mail */
const usoUsuarios = {};
const LIMITE_DIARIO = 50; 

/* ---------------- ROTA TESTE (HEALTH CHECK) ---------------- */
app.get("/", (req, res) => {
  res.send("WhatsApp & Gmail AI Backend rodando na Vercel com OAuth 2.0! 🚀");
});

/* ---------------- ROTA IA ---------------- */
app.post("/ia", async (req, res) => {
  try {
    // 1. Extrai o Token do cabeçalho Authorization (Formato: Bearer XXXXXXX)
    const authHeader = req.headers["authorization"];
    const token = authHeader ? authHeader.split("Bearer ")[1] : null;

    if (!token) {
      return res.status(401).json({ erro: "Acesso negado. Token não fornecido." });
    }

    // 2. Valida o Token criptográfico diretamente com a API do Google
    const googleVerify = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`);
    const googleData = await googleVerify.json();

    // Se o Google disser que o token é inválido ou expirou
    if (googleData.error) {
      return res.status(401).json({ erro: "Sessão expirada ou inválida. Faça login novamente na extensão." });
    }

    // 3. Sucesso! O ID do utilizador passa a ser o e-mail real e verificado
    const userId = googleData.email;
    console.log(`Requisição autorizada para o utilizador: ${userId}`);

    /* Cria o registo do utilizador no histórico diário se não existir */
    if (!usoUsuarios[userId]) {
      usoUsuarios[userId] = {
        contador: 0,
        data: new Date().toDateString(),
      };
    }

    const hoje = new Date().toDateString();

    /* Reinicia o contador se mudou o dia */
    if (usoUsuarios[userId].data !== hoje) {
      usoUsuarios[userId].contador = 0;
      usoUsuarios[userId].data = hoje;
    }

    /* Verifica se atingiu a cota de 50 mensagens */
    if (usoUsuarios[userId].contador >= LIMITE_DIARIO) {
      return res.status(429).json({
        erro: "Limite diário de 50 mensagens atingido. Atualize para o plano PRO.",
      });
    }

    const { texto, prompt } = req.body;

    if (!texto || !prompt) {
      return res.status(400).json({
        erro: "Texto ou prompt ausente.",
      });
    }

    /* Proteção contra abuso de tamanho de texto */
    if (texto.length > 4000) {
      return res.status(400).json({
        erro: "O texto excede o limite seguro de 4000 caracteres."
      });
    }

    // Incrementa o uso após passar todas as validações de segurança
    usoUsuarios[userId].contador++;

    /* Chamada ao motor Llama 3.3 70B na Groq */
    const resposta = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          temperature: 0.3,
          messages: [
            {
              role: "system",
              content: `Você é um reescritor de textos cirúrgico para WhatsApp e Gmail. Sua ÚNICA função é ajustar a gramática e a formalidade solicitada.

REGRAS ABSOLUTAS:
1. PRESERVAÇÃO ESTRITA DO SENTIDO: O texto final DEVE ter exatamente o mesmo significado, a mesma intenção e a mesma urgência do original. 
2. PROIBIDO INVENTAR (ALUCINAÇÃO ZERO): NÃO adicione justificativas, fatos, nomes, locais ou prazos que não existem no original. 
3. PROIBIDO CORTAR: Não omita nenhuma informação, pergunta ou dado do texto original.
4. SAÍDA DIRETA: Retorne APENAS a mensagem pronta para envio. NENHUMA introdução ("Aqui está"), NENHUMA conclusão, NENHUMA aspa envolvendo o texto.
5. NATURALIDADE E IDIOMA: Responda estritamente em Português do Brasil (PT-BR), soando fluido e humano, sem ser robótico.

EXEMPLOS DE COMPORTAMENTO IDEAL:
Original: "mano não vai dar pra entregar o relatorio hoje, o pc deu pau e perdi tudo, to tentando recuperar mas ta osso. avisa o cliente ai que amanha eu mando blz"
Tom: Formal
Resposta: "Infelizmente, não conseguirei entregar o relatório hoje devido a um problema no computador. Estou tentando recuperar os dados e enviarei amanhã. Por favor, avise o cliente."`,
            },
            {
              role: "user",
              content: `Reescreva o texto abaixo adotando um tom: [${prompt}].\n\nTexto original: ${texto}`,
            },
          ],
        }),
      },
    );

    const data = await resposta.json();
    const novoTexto = data?.choices?.[0]?.message?.content?.trim();

    if (!novoTexto) {
      return res.status(500).json({
        erro: "Falha ao processar a resposta da inteligência artificial.",
      });
    }

    res.json({
      texto: novoTexto,
    });

  } catch (erro) {
    console.error("Erro crítico no servidor:", erro);
    res.status(500).json({
      erro: "Erro interno no servidor de IA.",
    });
  }
});

/* ---------------- START SERVER / VERCEL EXPORT ---------------- */
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log("Servidor local rodando na porta", PORT);
  });
}

module.exports = app;