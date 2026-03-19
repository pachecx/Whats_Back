import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
const usoUsuarios = {};
const LIMITE_DIARIO = 20;

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// rate limit global
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
});

app.use("/ia", limiter);

// chave da extensão
const EXTENSION_KEY = "minha_chave_super_secreta_123";

// rota teste
app.get("/", (req, res) => {
  res.send("WhatsApp AI Backend rodando 🚀");
});

// endpoint IA
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

    // cria registro se não existir
    if (!usoUsuarios[userId]) {
      usoUsuarios[userId] = {
        contador: 0,
        data: new Date().toDateString(),
      };
    }

    const hoje = new Date().toDateString();

    // reset diário
    if (usoUsuarios[userId].data !== hoje) {
      usoUsuarios[userId].contador = 0;
      usoUsuarios[userId].data = hoje;
    }

    // verifica limite
    if (usoUsuarios[userId].contador >= LIMITE_DIARIO) {
      return res.json({
        erro: "Limite diário de IA atingido",
      });
    }

    // incrementa uso
    usoUsuarios[userId].contador++;

    console.log("Usuário:", userId, "uso:", usoUsuarios[userId].contador);

    const { texto, prompt } = req.body;

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

    res.json({
      texto: novoTexto,
    });
  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao gerar texto",
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor rodando");
});
