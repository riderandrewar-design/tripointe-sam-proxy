// server.js — SAM.gov CORS proxy + dashboard for TriPointe BD
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const SAM_API_KEY = process.env.SAM_API_KEY;

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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

    const params = new URLSearchParams({ api_key: SAM_API_KEY, postedFrom, postedTo, naicsCode, limit, offset });
    const url = "https://api.sam.gov/opportunities/v2/search?" + params.toString();
    console.log("Fetching:", url);

    const samRes = await fetch(url);
    const text = await samRes.text();
    if (!samRes.ok) {
      return res.status(samRes.status).json({ error: "SAM.gov error " + samRes.status, detail: text.slice(0,300) });
    }
    res.json(JSON.parse(text));
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/primes", async (req, res) => {
  try {
    const prompt = "You are a government contracting BD researcher. TriPointe Technologies is a 12-person small business offering cybersecurity, systems administration, application development, and data analytics, currently serving as a subcontractor on defense and intelligence programs. Identify exactly 3 prime contractors for teaming/subcontracting outreach. They must hold OASIS, STARS III, or CIO-SP3 vehicles OR have recent defense/intelligence awards OR be actively hiring cleared cybersecurity/IT/data SMEs. Return ONLY a JSON array with exactly 3 objects, each with: id (string), name (company name), reason (1 sentence), signals (array of 2-3 strings from: teaming page, OASIS, STARS III, CIO-SP3, defense award, cleared hiring), url (teaming or careers URL or null). No markdown, no preamble.";
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const data = await apiRes.json();
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const clean = text.replace(/```json|```/g, "").trim();
    res.json(JSON.parse(clean));
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log("Server running on port " + PORT));
