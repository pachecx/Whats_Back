const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY); // <-- Importação do Stripe
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

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/* ---------------- ROTA TESTE (HEALTH CHECK) ---------------- */
app.get("/", (req, res) => {
  res.send("API rodando com Stripe, OAuth 2.0 e Supabase! 🚀");
});

/* ---------------- ROTA IA (CORAÇÃO DA APLICAÇÃO) ---------------- */
app.post("/ia", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader ? authHeader.split("Bearer ")[1] : null;

    if (!token) {
      return res.status(401).json({ erro: "Acesso negado. Faça login na extensão." });
    }

    const googleVerify = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`);
    const googleData = await googleVerify.json();

    if (googleData.error) {
      return res.status(401).json({ erro: "Sessão expirada. Faça login novamente." });
    }

    const userId = googleData.email;
    const hojeStr = new Date().toISOString().split('T')[0];

    let { data: registo, error: erroConsulta } = await supabase
      .from("controle_uso")
      .select("*")
      .eq("email", userId)
      .single();

    if (erroConsulta && erroConsulta.code !== "PGRST116") {
      return res.status(500).json({ erro: "Erro interno ao validar cota de uso." });
    }

    if (!registo) {
      await supabase
        .from("controle_uso")
        .insert([{ email: userId, contador: 1, ultima_data: hojeStr, is_pro: false }]);
    } else {
      // REGRA NOVA: Se for PRO, ignora os limites e pula a contagem!
      if (!registo.is_pro) {
        if (registo.ultima_data !== hojeStr) {
          await supabase
            .from("controle_uso")
            .update({ contador: 1, ultima_data: hojeStr })
            .eq("email", userId);
        } else {
          if (registo.contador >= LIMITE_DIARIO) {
            // Mandamos um código específico (402 Payment Required) ou apenas 429
            return res.status(429).json({
              erro: "Limite diário atingido.",
              precisa_upgrade: true // <-- Front-end vai ler isso para mostrar o botão de compra
            });
          }
          await supabase
            .from("controle_uso")
            .update({ contador: registo.contador + 1 })
            .eq("email", userId);
        }
      }
    }

    const { texto, prompt } = req.body;

    if (!texto || !prompt) {
      return res.status(400).json({ erro: "Texto ou prompt ausente." });
    }

    if (texto.length > 4000) {
      return res.status(400).json({ erro: "O texto excede o limite seguro de 4000 caracteres." });
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
              content: `Você é um reescritor de textos cirúrgico para WhatsApp. Retorne APENAS a mensagem final.`,
            },
            {
              role: "user",
              content: `Reescreva o texto abaixo adotando um tom: [${prompt}].\n\nTexto original: ${texto}`,
            },
          ],
        }),
      }
    );

    const dataGroq = await respostaGroq.json();
    const novoTexto = dataGroq?.choices?.[0]?.message?.content?.trim();

    if (!novoTexto) {
      return res.status(500).json({ erro: "Falha ao processar a resposta da IA." });
    }

    res.json({ texto: novoTexto });

  } catch (erro) {
    console.error("Erro crítico no servidor:", erro);
    res.status(500).json({ erro: "Erro interno no servidor." });
  }
});

/* ---------------- ROTA CHECKOUT (GERA O LINK DE PAGAMENTO) ---------------- */
app.post("/checkout", async (req, res) => {
  try {
    // 1. Valida o Token do usuário exatamente como na rota /ia
    const authHeader = req.headers["authorization"];
    const token = authHeader ? authHeader.split("Bearer ")[1] : null;

    if (!token) {
      return res.status(401).json({ erro: "Acesso negado." });
    }

    const googleVerify = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`);
    const googleData = await googleVerify.json();

    if (googleData.error) {
      return res.status(401).json({ erro: "Sessão expirada." });
    }

    const userId = googleData.email;

    // 2. Cria a Sessão de Pagamento no Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      mode: "subscription",
      customer_email: userId, // Fundamental: Amarra o pagamento ao e-mail do Supabase
      success_url: "https://web.whatsapp.com/", // Retorna o usuário para o WhatsApp após pagar
      cancel_url: "https://web.whatsapp.com/",
    });

    // 3. Devolve a URL mágica para a extensão redirecionar o usuário
    res.json({ url: session.url });

  } catch (erro) {
    console.error("Erro ao gerar checkout:", erro);
    res.status(500).json({ erro: "Erro ao gerar link de pagamento." });
  }
});

/* ---------------- START SERVER ---------------- */
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log("Servidor local rodando na porta", PORT);
  });
}

module.exports = app;