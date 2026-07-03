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

    const postedFrom     = req.query.postedFrom     || fmt(today - 30 * 86400000);
    const postedTo       = req.query.postedTo       || fmt(today);
    const naicsCode      = req.query.naicsCode      || "541512,541519,541330,541690";
    const typeOfSetAside = req.query.typeOfSetAside || "";
    const keyword        = (req.query.q             || "").toLowerCase().trim();
    const pageLimit      = parseInt(req.query.limit) || 25;
    const pageOffset     = parseInt(req.query.offset) || 0;

    // When keyword filtering, fetch a large batch server-side
    const fetchLimit  = keyword ? 250 : pageLimit;
    const fetchOffset = keyword ? 0   : pageOffset;

    const paramObj = {
      api_key:   SAM_API_KEY,
      postedFrom,
      postedTo,
      naicsCode,
      limit:     String(fetchLimit),
      offset:    String(fetchOffset)
    };
    if (typeOfSetAside) paramObj.typeOfSetAside = typeOfSetAside;

    const url = "https://api.sam.gov/opportunities/v2/search?" + new URLSearchParams(paramObj).toString();
    console.log("Fetching opportunities:", url);

    const samRes = await fetch(url);
    const text   = await samRes.text();

    if (!samRes.ok) {
      return res.status(samRes.status).json({
        error:  "SAM.gov error " + samRes.status,
        detail: text.slice(0, 300)
      });
    }

    const data = JSON.parse(text);
    let opportunities = data.opportunitiesData || [];

    // Server-side keyword filtering across title and agency
    if (keyword) {
      const terms = keyword.split(/\s+/).filter(Boolean);
      opportunities = opportunities.filter(o => {
        const haystack = [
          o.title                      || "",
          o.fullParentPathName         || "",
          o.naicsCode                  || "",
          o.typeOfSetAsideDescription  || ""
        ].join(" ").toLowerCase();
        return terms.every(term => haystack.includes(term));
      });
    }

    const totalFiltered = keyword ? opportunities.length : (data.totalRecords || 0);
    const paginated     = keyword ? opportunities.slice(pageOffset, pageOffset + pageLimit) : opportunities;

    res.json({
      totalRecords:      totalFiltered,
      opportunitiesData: paginated
    });

  } catch (err) {
    console.error("Opportunities error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/primes", async (req, res) => {
  try {
    const today = new Date();
    const fmt = d => {
      const dd = new Date(d);
      return (dd.getMonth()+1).toString().padStart(2,"0") + "/" +
             dd.getDate().toString().padStart(2,"0") + "/" +
             dd.getFullYear();
    };

    const params = new URLSearchParams({
      api_key:    SAM_API_KEY,
      postedFrom: fmt(today - 90 * 86400000),
      postedTo:   fmt(today),
      naicsCode:  "541512,541519,541330,541690",
      limit:      "25",
      offset:     "0",
      ptype:      "a"
    });

    const url = "https://api.sam.gov/opportunities/v2/search?" + params.toString();
    console.log("Fetching primes (awards):", url);

    const samRes = await fetch(url);
    const text   = await samRes.text();

    if (!samRes.ok) {
      return res.status(samRes.status).json({
        error:  "SAM.gov awards error " + samRes.status,
        detail: text.slice(0, 300)
      });
    }

    const data   = JSON.parse(text);
    const awards = data.opportunitiesData || [];

    const defenseAgencies = ["DEFENSE","ARMY","NAVY","AIR FORCE","INTELLIGENCE","DIA","NSA","NGA","DARPA","SOCOM","DISA","CYBERCOM"];
    const seen   = {};
    const primes = [];

    for (const award of awards) {
      if (primes.length >= 3) break;
      const awardee = award.award && award.award.awardee;
      if (!awardee || !awardee.name) continue;
      const name = awardee.name.trim();
      if (seen[name]) continue;
      seen[name] = true;

      const agency    = (award.fullParentPathName || "").toUpperCase();
      const isDefense = defenseAgencies.some(d => agency.includes(d));
      const signals   = isDefense ? ["defense award"] : ["federal award"];
      if (award.naicsCode) signals.push("NAICS " + award.naicsCode);

      primes.push({
        id:        "p" + Date.now() + primes.length,
        name,
        reason:    "Recently awarded \"" + (award.title || "IT contract") + "\" with " + (award.fullParentPathName || "federal agency").split(".")[0],
        signals:   signals.slice(0, 3),
        url:       null,
        awardDate: award.postedDate || ""
      });
    }

    // Fill remaining slots from any awardee if fewer than 3 defense hits
    for (const award of awards) {
      if (primes.length >= 3) break;
      const awardee = award.award && award.award.awardee;
      if (!awardee || !awardee.name) continue;
      const name = awardee.name.trim();
      if (seen[name]) continue;
      seen[name] = true;
      primes.push({
        id:        "p" + Date.now() + primes.length,
        name,
        reason:    "Recently awarded \"" + (award.title || "IT contract") + "\" — potential teaming partner",
        signals:   ["recent award", award.naicsCode ? "NAICS " + award.naicsCode : "IT services"],
        url:       null,
        awardDate: award.postedDate || ""
      });
    }

    res.json(primes);

  } catch (err) {
    console.error("Primes error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log("Server running on port " + PORT));
