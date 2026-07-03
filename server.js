const express = require("express");
const fetch = require("node-fetch");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const SAM_API_KEY = process.env.SAM_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const pool = new Pool({
  connectionString: process.env.PG_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", function(_req, res) {
  res.json({ status: "ok", key: SAM_API_KEY ? "set" : "missing", anthropic: ANTHROPIC_API_KEY ? "set" : "missing" });
});

app.get("/statuses", async function(req, res) {
  try {
    var result = await pool.query("SELECT id, type, status FROM statuses");
    var statuses = {};
    result.rows.forEach(function(row) {
      statuses[row.id] = { status: row.status, type: row.type };
    });
    res.json(statuses);
  } catch(err) {
    console.error("Statuses error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/statuses", async function(req, res) {
  try {
    var id = req.body.id;
    var type = req.body.type;
    var status = req.body.status;
    await pool.query(
      "INSERT INTO statuses (id, type, status) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET status = $3, updated_at = NOW()",
      [id, type, status]
    );
    res.json({ ok: true });
  } catch(err) {
    console.error("Save status error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/opportunities", async function(req, res) {
  try {
    var today = new Date();
    function fmt(d) {
      var dd = new Date(d);
      return (dd.getMonth()+1).toString().padStart(2,"0") + "/" + dd.getDate().toString().padStart(2,"0") + "/" + dd.getFullYear();
    }
    var postedFrom     = decodeURIComponent(req.query.postedFrom || fmt(today - 30 * 86400000));
    var postedTo       = decodeURIComponent(req.query.postedTo   || fmt(today));
    var naicsCode      = req.query.naicsCode      || "541512,541519,541330,541690";
    var typeOfSetAside = req.query.typeOfSetAside || "";
    var keyword        = (req.query.q             || "").toLowerCase().trim();
    var pageLimit      = parseInt(req.query.limit) || 25;
    var pageOffset     = parseInt(req.query.offset) || 0;
    var fetchLimit     = keyword ? 250 : pageLimit;
    var fetchOffset    = keyword ? 0   : pageOffset;
    var paramObj = { api_key: SAM_API_KEY, postedFrom: postedFrom, postedTo: postedTo, naicsCode: naicsCode, limit: String(fetchLimit), offset: String(fetchOffset) };
    if (typeOfSetAside) paramObj.typeOfSetAside = typeOfSetAside;
    var url = "https://api.sam.gov/opportunities/v2/search?" + new URLSearchParams(paramObj).toString();
    console.log("Fetching opportunities:", url);
    var samRes = await fetch(url, { headers: { "Accept": "application/json", "Accept-Encoding": "identity" } });
    var text = await samRes.text();
    if (!samRes.ok) return res.status(samRes.status).json({ error: "SAM.gov error " + samRes.status, detail: text.slice(0,300) });
    var data = JSON.parse(text);
    var opportunities = data.opportunitiesData || [];
    if (keyword) {
      var terms = keyword.split(/\s+/).filter(Boolean);
      opportunities = opportunities.filter(function(o) {
        var haystack = [o.title||"", o.fullParentPathName||"", o.naicsCode||"", o.typeOfSetAsideDescription||""].join(" ").toLowerCase();
        return terms.every(function(term) { return haystack.includes(term); });
      });
    }
    var totalFiltered = keyword ? opportunities.length : (data.totalRecords || 0);
    var paginated = keyword ? opportunities.slice(pageOffset, pageOffset + pageLimit) : opportunities;
    res.json({ totalRecords: totalFiltered, opportunitiesData: paginated });
  } catch(err) {
    console.error("Opportunities error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/primes", async function(req, res) {
  try {
    console.log("Primes: calling Anthropic API with web search");
    var prompt = "You are a government contracting BD researcher. TriPointe Technologies is a 12-person small business specializing in cybersecurity, systems administration, application development, and data analytics. They serve as a subcontractor on defense and intelligence programs. Identify exactly 3 prime contractors for teaming outreach. They must hold OASIS, STARS III, or CIO-SP3 vehicles OR have recent defense/intelligence awards OR be hiring cleared TS/SCI cybersecurity or IT SMEs. YOU MUST RESPOND WITH ONLY A JSON ARRAY. NO OTHER TEXT. NO PREAMBLE. NO EXPLANATION. Start your response with [ and end with ]. Each object must have: id (string), name (string), reason (string), signals (array of strings), url (string or null), awardDate (string or null).";
    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, 120000);
    var apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "Accept": "application/json", "Accept-Encoding": "identity", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1500, tools: [{ type: "web_search_20250305", name: "web_search" }], messages: [{ role: "user", content: prompt }] })
    });
    clearTimeout(timeout);
    var responseData = await apiRes.json();
    console.log("Anthropic response type:", responseData.type, "error:", JSON.stringify(responseData.error));
    if (responseData.error) throw new Error(JSON.stringify(responseData.error));
    if (responseData.type === "error") throw new Error(JSON.stringify(responseData));
    var text = (responseData.content || []).filter(function(b) { return b.type === "text"; }).map(function(b) { return b.text; }).join("");
    if (!text) throw new Error("No text in response");
    var match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("No JSON array found in: " + text.slice(0, 200));
    var parsed = JSON.parse(match[0]);
    res.json(Array.isArray(parsed) ? parsed : []);
  } catch(err) {
    console.error("Primes error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

async function startServer() {
  console.log("DATABASE_URL present:", !!process.env.DATABASE_URL);
  console.log("PG_URL present:", !!process.env.PG_URL);
  try {
    await pool.query("SELECT 1");
    console.log("Database connection OK");
    await pool.query("CREATE TABLE IF NOT EXISTS statuses (id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, updated_at TIMESTAMP DEFAULT NOW())");
    console.log("Database ready");
  } catch(err) {
    console.error("Database init error:", err.message);
  }
  app.listen(PORT, function() { console.log("Server running on port " + PORT); });
}

startServer();
