// server.js — SAM.gov CORS proxy + prime research + dashboard for TriPointe BD
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

// SAM.gov opportunity search
app.get("/opportunities", async (req, res) => {
  try {
    const today = new Date();
    const fmt = d => {
      const dd = new Date(d);
      return (dd.getMonth()+1).toString().padStart(2,"0") + "/" +
             dd.getDate().toString().padStart(2,"0") + "/" +
             dd.getFullYear();
    };
    const postedFrom     = req.query.postedFrom     || fmt(today - 30 * 86400000);
    const postedTo       = req.query.postedTo       || fmt(today);
    const naicsCode      = req.query.naicsCode      || "541512,541519,541330,541690";
    const limit          = req.query.limit          || "25";
    const offset         = req.query.offset         || "0";
    const keyword        = req.query.q              || "";
    const typeOfSetAside = req.query.typeOfSetAside || "";

    const paramObj = { api_key: SAM_API_KEY, postedFrom, postedTo, naicsCode, limit, offset };
    if (keyword) paramObj.q = keyword;
    if (typeOfSetAside) paramObj.typeOfSetAside = typeOfSetAside;
    const params = new URLSearchParams(paramObj);
    const url = "https://api.sam.gov/opportunities/v2/search?" + params.toString();
    console.log("Fetching opportunities:", url);

    const samRes = await fetch(url);
    const text = await samRes.text();
    if (!samRes.ok) {
      return res.status(samRes.status).json({ error: "SAM.gov error " + samRes.status, detail: text.slice(0,300) });
    }
    res.json(JSON.parse(text));
  } catch (err) {
    console.error("Opportunities error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Prime contractor research via SAM.gov awards data
app.get("/primes", async (req, res) => {
  try {
    const today = new Date();
    const fmt = d => {
      const dd = new Date(d);
      return (dd.getMonth()+1).toString().padStart(2,"0") + "/" +
             dd.getDate().toString().padStart(2,"0") + "/" +
             dd.getFullYear();
    };

    // Search SAM.gov for recent award notices in TriPointe's NAICS codes
    // These are companies that won defense/intel IT contracts = prime candidates for teaming
    const naicsCodes = ["541512","541519","541330","541690"];
    const postedFrom = fmt(today - 90 * 86400000);
    const postedTo = fmt(today);

    const params = new URLSearchParams({
      api_key: SAM_API_KEY,
      postedFrom,
      postedTo,
      naicsCode: naicsCodes.join(","),
      limit: "25",
      offset: "0",
      ptype: "a" // awards only
    });

    const url = "https://api.sam.gov/opportunities/v2/search?" + params.toString();
    console.log("Fetching primes (awards):", url);

    const samRes = await fetch(url);
    const text = await samRes.text();
    if (!samRes.ok) {
      return res.status(samRes.status).json({ error: "SAM.gov awards error " + samRes.status, detail: text.slice(0,300) });
    }

    const data = JSON.parse(text);
    const awards = data.opportunitiesData || [];

    // Extract unique awardees with defense/intel agency awards
    const defenseAgencies = ["DEFENSE","ARMY","NAVY","AIR FORCE","INTELLIGENCE","DIA","NSA","NGA","DARPA","SOCOM","DISA","CYBERCOM"];
    const seen = {};
    const primes = [];

    for (const award of awards) {
      if (primes.length >= 3) break;
      const awardee = award.award && award.award.awardee;
      if (!awardee || !awardee.name) continue;
      const name = awardee.name.trim();
      if (seen[name]) continue;
      seen[name] = true;

      const agency = (award.fullParentPathName || "").toUpperCase();
      const isDefense = defenseAgencies.some(d => agency.includes(d));
      const signals = [];
      if (isDefense) signals.push("defense award");
      signals.push(award.naicsCode ? "NAICS " + award.naicsCode : "IT services");

      primes.push({
        id: "p" + Date.now() + primes.length,
        name: name,
        reason: "Recently awarded " + (award.title || "IT contract") + " with " + (award.fullParentPathName || "federal agency").split(".")[0],
        signals: signals.slice(0,3),
        url: null,
        agency: award.fullParentPathName || "",
        naicsCode: award.naicsCode || "",
        awardDate: award.postedDate || ""
      });
    }

    // If fewer than 3 from defense, fill with any IT awardees
    if (primes.length < 3) {
      for (const award of awards) {
        if (primes.length >= 3) break;
        const awardee = award.award && award.award.awardee;
        if (!awardee || !awardee.name) continue;
        const name = awardee.name.trim();
        if (seen[name]) continue;
        seen[name] = true;
        primes.push({
          id: "p" + Date.now() + primes.length,
          name: name,
          reason: "Recently awarded " + (award.title || "IT contract") + " — potential teaming partner",
          signals: ["recent award", award.naicsCode ? "NAICS " + award.naicsCode : "IT services"],
          url: null,
          agency: award.fullParentPathName || "",
          naicsCode: award.naicsCode || "",
          awardDate: award.postedDate || ""
        });
      }
    }

    res.json(primes);
  } catch (err) {
    console.error("Primes error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log("Server running on port " + PORT));
