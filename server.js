// server.js — SAM.gov CORS proxy for TriPointe BD Dashboard
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;
const SAM_API_KEY = process.env.SAM_API_KEY;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.get("/opportunities", async (req, res) => {
  try {
    const today = new Date();
    const fmt = d => `${(d.getMonth()+1).toString().padStart(2,"0")}/${d.getDate().toString().padStart(2,"0")}/${d.getFullYear()}`;
    const postedFrom = req.query.postedFrom || fmt(new Date(today - 30 * 86400000));
    const postedTo   = req.query.postedTo   || fmt(today);
    const naicsCode  = req.query.naicsCode  || "541512,541519,541330,541690";
    const limit      = req.query.limit      || "10";
    const offset     = req.query.offset     || "0";

    const params = new URLSearchParams({ api_key: SAM_API_KEY, postedFrom, postedTo, naicsCode, limit, offset });
    const url = `https://api.sam.gov/opportunities/v2/search?${params}`;

    const samRes = await fetch(url);
    if (!samRes.ok) {
      const text = await samRes.text();
      return res.status(samRes.status).json({ error: `SAM.gov error ${samRes.status}`, detail: text.slice(0, 300) });
    }

    const data = await samRes.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`SAM proxy running on port ${PORT}`));
