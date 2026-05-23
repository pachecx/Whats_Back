const express = require("express");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
app.use(express.json());

/* ---------------- CORS MANUAL (VERCEL FIX) ---------------- */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

/* ---------------- CONFIGURAÇÕES GERAIS ---------------- */
const PORT = process.env.PORT || 3000;
const LIMITE_DIARIO = 50;

// Inicializa o cliente do Supabase
// (As chaves precisam estar no .env local e nas variáveis de ambiente da Vercel)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/* ---------------- ROTA TESTE (HEALTH CHECK) ---------------- */
app.get("/", (req, res) => {
  res.send("API rodando com OAuth 2.0 e Banco de Dados Supabase! 🚀");
});

/* ---------------- ROTA IA (CORAÇÃO DA APLICAÇÃO) ---------------- */
app.post("/ia", async (req, res) => {
  try {
    // ==========================================
    // 1. AUTENTICAÇÃO: Validação Zero Trust
    // ==========================================
    const authHeader = req.headers["authorization"];
    const token = authHeader ? authHeader.split("Bearer ")[1] : null;

    if (!token) {
      return res
        .status(401)
        .json({ erro: "Acesso negado. Faça login na extensão." });
    }

    const googleVerify = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${token}`,
    );
    const googleData = await googleVerify.json();

    if (googleData.error) {
      return res
        .status(401)
        .json({ erro: "Sessão expirada. Faça login novamente." });
    }

    const userId = googleData.email;
    const hojeStr = new Date().toISOString().split("T")[0]; // Formato YYYY-MM-DD

    // ==========================================
    // 2. BANCO DE DADOS: Consulta e Controle de Cotas
    // ==========================================
    let { data: registo, error: erroConsulta } = await supabase
      .from("controle_uso")
      .select("*")
      .eq("email", userId)
      .single();

    // O código PGRST116 apenas indica que não achou o usuário (normal no primeiro uso)
    if (erroConsulta && erroConsulta.code !== "PGRST116") {
      console.error("Erro no banco Supabase:", erroConsulta);
      return res
        .status(500)
        .json({ erro: "Erro interno ao validar cota de uso." });
    }

    if (!registo) {
      // Primeiro uso da vida do usuário
      await supabase
        .from("controle_uso")
        .insert([{ email: userId, contador: 1, ultima_data: hojeStr }]);
    } else {
      if (registo.ultima_data !== hojeStr) {
        // Virou o dia, reseta o contador
        await supabase
          .from("controle_uso")
          .update({ contador: 1, ultima_data: hojeStr })
          .eq("email", userId);
      } else {
        // Mesmo dia, verifica se bateu o limite
        if (registo.contador >= LIMITE_DIARIO) {
          return res.status(429).json({
            erro: "Limite diário de 50 mensagens atingido. Retorne amanhã ou faça o upgrade.",
          });
        }
        // Tem saldo, incrementa o uso no banco
        await supabase
          .from("controle_uso")
          .update({ contador: registo.contador + 1 })
          .eq("email", userId);
      }
    }

    // ==========================================
    // 3. INTEGRAÇÃO IA: Chamada para a Groq
    // ==========================================
    const { texto, prompt } = req.body;

    if (!texto || !prompt) {
      return res.status(400).json({ erro: "Texto ou prompt ausente." });
    }

    if (texto.length > 4000) {
      return res
        .status(400)
        .json({ erro: "O texto excede o limite seguro de 4000 caracteres." });
    }

    const respostaGroq = await fetch(
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
                4. SAÍDA DIRETA: Retorne APENAS a mensagem pronta para envio. NENHUMA introdução, NENHUMA conclusão, NENHUMA aspa envolvendo o texto.
                5. NATURALIDADE E IDIOMA: Responda estritamente em Português do Brasil (PT-BR), soando fluido e humano, sem ser robótico.`,
            },
            {
              role: "user",
              content: `Reescreva o texto abaixo adotando um tom: [${prompt}].\n\nTexto original: ${texto}`,
            },
          ],
        }),
      },
    );

    const dataGroq = await respostaGroq.json();
    const novoTexto = dataGroq?.choices?.[0]?.message?.content?.trim();

    if (!novoTexto) {
      return res
        .status(500)
        .json({ erro: "Falha ao processar a resposta da IA." });
    }

    res.json({ texto: novoTexto });
  } catch (erro) {
    console.error("Erro crítico no servidor:", erro);
    res.status(500).json({ erro: "Erro interno no servidor." });
  }
});

/* ---------------- START SERVER / VERCEL EXPORT ---------------- */
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log("Servidor local rodando na porta", PORT);
  });
}

module.exports = app;
