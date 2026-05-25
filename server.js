const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
require("dotenv").config();

const app = express();

/* ---------------- CONFIGURAÇÕES GERAIS ---------------- */
const PORT = process.env.PORT || 3000;
const LIMITE_DIARIO = 50;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/* ====================================================================
   ROTA DO WEBHOOK DO STRIPE (TEM QUE VIR ANTES DO EXPRESS.JSON)
==================================================================== */
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      // Valida se a mensagem realmente veio do Stripe
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (err) {
      console.error("⚠️ Erro na assinatura do Webhook:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Se o pagamento foi processado com sucesso
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const emailPagador = session.customer_email;

      console.log(`💰 Pagamento recebido de: ${emailPagador}`);

      // Atualiza o banco de dados: is_pro = true
      const { error } = await supabase
        .from("controle_uso")
        .update({ is_pro: true })
        .eq("email", emailPagador);

      if (error) {
        console.error("Erro ao atualizar Supabase no Webhook:", error);
        return res.status(500).send("Erro no banco de dados.");
      }

      console.log(`✅ Usuário ${emailPagador} promovido para PRO com sucesso!`);
    }

    // Responde 200 pro Stripe parar de tentar enviar o aviso
    res.json({ received: true });
  },
);

/* ---------------- MIDDLEWARES NORMAIS (JSON E CORS) ---------------- */
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

/* ---------------- ROTA TESTE (HEALTH CHECK) ---------------- */
app.get("/", (req, res) => {
  res.send("API rodando com Stripe Webhooks e Banco de Dados! 🚀");
});

/* ---------------- ROTA IA (CORAÇÃO DA APLICAÇÃO) ---------------- */
app.post("/ia", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader ? authHeader.split("Bearer ")[1] : null;

    if (!token) return res.status(401).json({ erro: "Acesso negado." });

    const googleVerify = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${token}`,
    );
    const googleData = await googleVerify.json();

    if (googleData.error)
      return res.status(401).json({ erro: "Sessão expirada." });

    const userId = googleData.email;
    const hojeStr = new Date().toISOString().split("T")[0];

    let { data: registo, error: erroConsulta } = await supabase
      .from("controle_uso")
      .select("*")
      .eq("email", userId)
      .single();

    if (erroConsulta && erroConsulta.code !== "PGRST116") {
      return res.status(500).json({ erro: "Erro no banco." });
    }

    if (!registo) {
      await supabase
        .from("controle_uso")
        .insert([
          { email: userId, contador: 1, ultima_data: hojeStr, is_pro: false },
        ]);
    } else {
      if (!registo.is_pro) {
        if (registo.ultima_data !== hojeStr) {
          await supabase
            .from("controle_uso")
            .update({ contador: 1, ultima_data: hojeStr })
            .eq("email", userId);
        } else {
          if (registo.contador >= LIMITE_DIARIO) {
            return res
              .status(429)
              .json({ erro: "Limite diário atingido.", precisa_upgrade: true });
          }
          await supabase
            .from("controle_uso")
            .update({ contador: registo.contador + 1 })
            .eq("email", userId);
        }
      }
    }

    const { texto, prompt } = req.body;
    if (!texto || !prompt)
      return res.status(400).json({ erro: "Faltam dados." });
    if (texto.length > 4000)
      return res.status(400).json({ erro: "Texto muito longo." });

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
              content: `Você é um reescritor de mensagens para WhatsApp. Sua ÚNICA função é adaptar o texto recebido para o tom solicitado.
              REGRAS ABSOLUTAS:
              1. NUNCA aja como um assistente virtual. Nunca converse com o usuário.
              2. NUNCA adicione introduções ou explicações (ex: NUNCA diga "Desculpe", "Aqui está o texto", "Claro").
              3. Se o texto original for muito curto (ex: "não sei", "ok", "sim"), apenas eleve a frase para o tom solicitado (ex: "não sei" no tom formal vira "Ainda não possuo essa informação no momento.").
              4. Retorne EXATAMENTE E APENAS a mensagem final reescrita, sem aspas em volta.`,
            },
            {
              role: "user",
              content: `Reescreva a mensagem abaixo adotando um tom [${prompt}].\n\nMensagem original: "${texto}"`,
            },
          ],
        }),
      },
    );

    const dataGroq = await respostaGroq.json();
    res.json({ texto: dataGroq?.choices?.[0]?.message?.content?.trim() });
  } catch (erro) {
    res.status(500).json({ erro: "Erro interno no servidor." });
  }
});

/* ---------------- ROTA CHECKOUT ---------------- */
app.post("/checkout", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader ? authHeader.split("Bearer ")[1] : null;

    if (!token) return res.status(401).json({ erro: "Acesso negado." });

    const googleVerify = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${token}`,
    );
    const googleData = await googleVerify.json();

    if (googleData.error)
      return res.status(401).json({ erro: "Sessão expirada." });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      mode: "subscription",
      customer_email: googleData.email,
      success_url: "https://web.whatsapp.com/",
      cancel_url: "https://web.whatsapp.com/",
    });

    res.json({ url: session.url });
  } catch (erro) {
    res.status(500).json({ erro: "Erro ao gerar checkout." });
  }
});

/* ---------------- ROTA STATUS (ALIMENTA O PAINEL REACT) ---------------- */
app.get("/status", async (req, res) => {
  try {
    // 1. Valida o Token do usuário
    const authHeader = req.headers["authorization"];
    const token = authHeader ? authHeader.split("Bearer ")[1] : null;

    if (!token) return res.status(401).json({ erro: "Acesso negado." });

    const googleVerify = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${token}`,
    );
    const googleData = await googleVerify.json();

    if (googleData.error)
      return res.status(401).json({ erro: "Sessão expirada." });

    const userId = googleData.email;
    const hojeStr = new Date().toISOString().split("T")[0];

    // 2. Busca os dados no Supabase
    let { data: registo, error: erroConsulta } = await supabase
      .from("controle_uso")
      .select("*")
      .eq("email", userId)
      .single();

    if (erroConsulta && erroConsulta.code !== "PGRST116") {
      return res.status(500).json({ erro: "Erro ao consultar banco." });
    }

    // 3. Regras de negócio para a interface
    if (!registo) {
      // Se não achou registro, o usuário é novo e tem 0 usos
      return res.json({ isPro: false, mensagensUsadas: 0 });
    }

    // Se o dia virou no calendário, o usuário tem 0 usos hoje (mesmo que o banco ainda tenha o número de ontem)
    let usoHoje = registo.contador;
    if (registo.ultima_data !== hojeStr) {
      usoHoje = 0;
    }

    // 4. Devolve o pacote perfeito para o React
    res.json({
      isPro: registo.is_pro || false,
      mensagensUsadas: usoHoje,
    });
  } catch (erro) {
    console.error("Erro na rota de status:", erro);
    res.status(500).json({ erro: "Erro interno do servidor." });
  }
});

/* ---------------- START SERVER ---------------- */
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => console.log("Servidor rodando na porta", PORT));
}

module.exports = app;
