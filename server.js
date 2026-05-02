const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(express.json());

/* ---------------- CORS ---------------- */

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-extension-key", "x-user-id"],
  }),
);

/* ---------------- CONFIG ---------------- */

const PORT = process.env.PORT || 3000;
const EXTENSION_KEY = process.env.EXTENSION_KEY;

/* limite por usuario */

const usoUsuarios = {};
const LIMITE_DIARIO = 50;

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
        debug_recebido: key || "NADA",
        debug_esperado: EXTENSION_KEY || "UNDEFINED",
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

    /* reset diario */

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

    console.log("Usuario:", userId, "uso:", usoUsuarios[userId].contador);

    // No seu frontend, 'prompt' provavelmente é a instrução de tom (ex: "Torne formal")
    const { texto, prompt } = req.body;

    if (!texto || !prompt) {
      return res.status(400).json({
        erro: "Texto ou prompt ausente",
      });
    }

    /* --- NOVA TRAVA DE SEGURANÇA (O ESCUDO) --- */
    if (texto.length > 4000) {
      return res.status(400).json({
        erro: "O texto é muito longo. O limite é de 4000 caracteres.",
      });
    }

    /* chamada da IA - AGORA COM O PROMPT BLINDADO E TEMPERATURA */

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
          temperature: 0.3, // <-- ADICIONADO: Reduz a criatividade excessiva (alucinações)
          messages: [
            {
              role: "system",
              content: `Você é um reescritor de textos cirúrgico para WhatsApp. Sua ÚNICA função é ajustar a gramática e a formalidade solicitada.

              REGRAS ABSOLUTAS:
              1. PRESERVAÇÃO ESTRITA DO SENTIDO: O texto final DEVE ter exatamente o mesmo significado, a mesma intenção e a mesma urgência do original. 
              2. PROIBIDO INVENTAR (ALUCINAÇÃO ZERO): NÃO adicione justificativas, fatos, nomes, locais ou prazos que não existem no original. 
              3. PROIBIDO CORTAR: Não omita nenhuma informação, pergunta ou dado do texto original.
              4. SAÍDA DIRETA: Retorne APENAS a mensagem pronta para envio. NENHUMA introdução ("Aqui está"), NENHUMA conclusão, NENHUMA aspa envolvendo o texto.
              5. NATURALIDADE E IDIOMA: Responda estritamente em Português do Brasil (PT-BR), soando fluido e humano, sem ser robótico.

              EXEMPLOS DE COMPORTAMENTO IDEAL:
              Original: "mano não vai dar pra entregar o relatorio hoje, o pc deu pau e perdi tudo, to tentando recuperar mas ta osso. avisa o cliente ai que amanha eu mando blz"
              Tom: Formal
              Resposta: "Infelizmente, não conseguirei entregar o relatório hoje devido a um problema no computador. Estou tentando recuperar os dados e enviarei amanhã. Por favor, avise o cliente."

              Original: "chefe, o pneu furou aqui na marginal, to esperando o guincho, atraso de 2h."
              Tom: Profissional
              Resposta: "Bom dia. Tive um imprevisto com o pneu do carro e estou aguardando o guincho. Chegarei com cerca de duas horas de atraso."

              Original: "cara manda logo esse contrato assinado que o financeiro ta buzinando no meu ouvido."
              Tom: Educado
              Resposta: "Você poderia me enviar o contrato assinado assim que possível? O setor financeiro está me cobrando um posicionamento."`,
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

    const novoTexto = data?.choices?.[0]?.message?.content?.trim(); // O .trim() remove espaços em branco extras

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
      erro: "Erro interno",
    });
  }
});

/* ---------------- START SERVER / VERCEL EXPORT ---------------- */

// Se estiver rodando no seu computador (local), ele usa a porta normalmente
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log("Servidor rodando localmente na porta", PORT);
  });
}

// O Segredo da Vercel: Exportar o app como um módulo serverless
module.exports = app;
