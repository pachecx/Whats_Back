const express = require("express");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/* CORS GLOBAL */

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-extension-key, x-user-id",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  next();
});

/* TESTE */

app.get("/", (req, res) => {
  res.send("Backend rodando 🚀");
});

/* IA */

app.post("/ia", async (req, res) => {
  const { texto } = req.body;

  if (!texto) {
    return res.json({ erro: "Texto vazio" });
  }

  res.json({
    texto: "Resposta teste: " + texto,
  });
});

app.listen(PORT, () => {
  console.log("Servidor rodando porta", PORT);
});
