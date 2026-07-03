// server.js — SAM.gov CORS proxy for TriPointe BD Dashboard
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;
const SAM_API_KEY = process.env.SAM_API_KEY;

// Explicit CORS — allow all origins
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", key: SAM_API_KEY ? "set" : "missing" });
});

app.get("/opportunities", async (req, res) => {
  try {
    const today = new Date();
    const fmt = d => {
      const dd = new Date(d);
      return (dd.getMonth()+1).toString().padStart(2,"0") + "/" +
             dd.getDate().toString().padStart(2,"0") + "/" +
             dd.getFullYear();
    };

    const postedFrom = req.query.postedFrom || fmt(today - 30 * 86400000);
    const postedTo   = req.query.postedTo   || fmt(today);
    const naicsCode  = req.query.naicsCode  || "541512,541519,541330,541690";
    const limit      = req.query.limit      || "10";
    const offset     = req.query.offset     || "0";

    const params = new URLSearchParams({
      api_key: SAM_API_KEY,
      postedFrom,
      postedTo,
      naicsCode,
      limit,
      offset
    });

    const url = "https://api.sam.gov/opportunities/v2/search?" + params.toString();
    console.log("Fetching:", url);

    const samRes = await fetch(url);
    const text = await samRes.text();

    if (!samRes.ok) {
      console.error("SAM.gov error:", samRes.status, text.slice(0, 300));
      return res.status(samRes.status).json({ error: "SAM.gov error " + samRes.status, detail: text.slice(0, 300) });
    }

    const data = JSON.parse(text);
    res.json(data);
  } catch (err) {
    console.error("Server error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log("SAM proxy running on port " + PORT));
