import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// 🚦 Limite de requisições
const limiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 horas
  max: 50, // máximo de 50 requests
  message: {
    erro: "Limite diário atingido. Tente novamente amanhã."
  }
});

// aplica limite apenas na rota da IA
app.use("/ia", limiter);

app.post("/ia", async (req, res) => {

  const { texto, prompt } = req.body;

  try {

    const resposta = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            {
              role: "system",
              content: prompt
            },
            {
              role: "user",
              content: texto
            }
          ]
        })
      }
    );

    const data = await resposta.json();

    const novoTexto = data?.choices?.[0]?.message?.content;

    res.json({
      texto: novoTexto
    });

  } catch (erro) {

    console.error(erro);

    res.status(500).json({
      erro: "Erro ao chamar IA"
    });

  }

});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});