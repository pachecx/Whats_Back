const express = require("express");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------------- MIDDLEWARE ---------------- */

app.use(express.json());

/* CORS MANUAL (resolve problema com extensão) */

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, x-extension-key, x-user-id",
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

/* ---------------- CONFIG ---------------- */

const EXTENSION_KEY = process.env.EXTENSION_KEY;

/* limite por usuário */

const usoUsuarios = {};
const LIMITE_DIARIO = 20;

/* ---------------- ROTA TESTE ---------------- */

app.get("/", (req, res) => {
  res.send("WhatsApp AI Backend rodando 🚀");
});

/* ---------------- ROTA IA ---------------- */

app.post("/ia", async (req, res) => {
  try {
    const key = req.headers["x-extension-key"];

    if (key !== EXTENSION_KEY) {
      return res.status(403).json({
        erro: "Acesso não autorizado",
      });
    }

    const userId = req.headers["x-user-id"];

    if (!userId) {
      return res.status(400).json({
        erro: "Usuário não identificado",
      });
    }

    /* cria registro se não existir */

    if (!usoUsuarios[userId]) {
      usoUsuarios[userId] = {
        contador: 0,
        data: new Date().toDateString(),
      };
    }

    const hoje = new Date().toDateString();

    /* reset diário */

    if (usoUsuarios[userId].data !== hoje) {
      usoUsuarios[userId].contador = 0;
      usoUsuarios[userId].data = hoje;
    }

    /* verifica limite */

    if (usoUsuarios[userId].contador >= LIMITE_DIARIO) {
      return res.json({
        erro: "Limite diário de IA atingido",
      });
    }

    usoUsuarios[userId].contador++;

    console.log("Usuário:", userId, "uso:", usoUsuarios[userId].contador);

    const { texto, prompt } = req.body;

    if (!texto || !prompt) {
      return res.status(400).json({
        erro: "Texto ou prompt ausente",
      });
    }

    /* chamada da IA */

    const resposta = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            {
              role: "system",
              content: prompt,
            },
            {
              role: "user",
              content: texto,
            },
          ],
        }),
      },
    );

    const data = await resposta.json();

    const novoTexto = data?.choices?.[0]?.message?.content;

    if (!novoTexto) {
      return res.status(500).json({
        erro: "Erro ao gerar texto",
      });
    }

    res.json({
      texto: novoTexto,
    });
  } catch (erro) {
    console.error("Erro servidor:", erro);

    res.status(500).json({
      erro: "Erro interno do servidor",
    });
  }
});

/* ---------------- START SERVER ---------------- */

app.listen(PORT, () => {
  console.log("Servidor rodando na porta", PORT);
});
