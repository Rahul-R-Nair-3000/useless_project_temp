// server.js
require("dotenv").config();
const express = require("express");
const path = require("path");
const { SYSTEM_PROMPT, ANALYZER_PROMPT, containsDistressSignal, SAFE_FALLBACK_REPLY } = require("./persona");
const fs = require("fs");
const CHATS_FILE = path.join(__dirname, "chats.json");

if (!fs.existsSync(CHATS_FILE)) {
  fs.writeFileSync(CHATS_FILE, JSON.stringify([]));
}
const app = express();
const PORT = process.env.PORT || 3000;
const AI_API_KEY = process.env.AI_API_KEY;
const AI_API_KEY_ANALYZER = process.env.AI_API_KEY_ANALYZER || AI_API_KEY;
const AI_API_KEY_GENERATOR = process.env.AI_API_KEY_GENERATOR || AI_API_KEY;
const AI_API_BASE_URL = process.env.AI_API_BASE_URL || "https://api.openai.com/v1/chat/completions";
const AI_MODEL = process.env.AI_MODEL || "gpt-4o-mini"; 

if (!AI_API_KEY) {
  console.warn("WARNING: AI_API_KEY is not set. Add it to a .env file before running for real.");
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res, path) => {
    if (path.endsWith('.html') || path.endsWith('.js') || path.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// --- Chat History API ---
app.get("/api/sessions", (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(CHATS_FILE, "utf8"));
    res.json(data);
  } catch (e) {
    res.json([]);
  }
});

app.post("/api/sessions", (req, res) => {
  try {
    const { id, title, date, messages } = req.body;
    const data = JSON.parse(fs.readFileSync(CHATS_FILE, "utf8"));
    const existingIndex = data.findIndex(s => s.id === id);
    if (existingIndex > -1) {
      data[existingIndex] = { id, title, date, messages };
    } else {
      data.unshift({ id, title, date, messages });
    }
    fs.writeFileSync(CHATS_FILE, JSON.stringify(data, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to save session" });
  }
});

app.delete("/api/sessions/:id", (req, res) => {
  try {
    const id = req.params.id;
    let data = JSON.parse(fs.readFileSync(CHATS_FILE, "utf8"));
    data = data.filter(s => s.id !== id);
    fs.writeFileSync(CHATS_FILE, JSON.stringify(data, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to delete session" });
  }
});

// --- very simple in-memory rate limiter (per IP) ---
// Good enough for a one-day event demo. Not meant to survive a real deployment.
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 15; // per window
const requestLog = new Map(); // ip -> [timestamps]

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX_REQUESTS;
}

app.post("/api/troll", async (req, res) => {
  try {
    const ip = req.ip;
    if (isRateLimited(ip)) {
      return res.status(429).json({ reply: "Pulu ku vishakunnu, onnu nirthittu varu... (slow down, too many messages)" });
    }

    const userMessage = (req.body?.message || "").toString().trim();
    const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
    const formattedHistory = rawHistory.map(msg => ({
      role: msg.role === 'pulu' ? 'assistant' : 'user',
      content: msg.content
    }));
    if (!userMessage) {
      return res.status(400).json({ error: "message is required" });
    }
    if (userMessage.length > 500) {
      return res.status(400).json({ error: "message too long" });
    }

    // Safety circuit breaker: never troll someone who might be in real distress.
    if (containsDistressSignal(userMessage)) {
      return res.json({ reply: SAFE_FALLBACK_REPLY, safeMode: true });
    }

    if (!AI_API_KEY) {
      return res.status(500).json({ error: "Server is missing AI_API_KEY" });
    }

    // --- Step 1: Analyze Length ---
    const analyzerResponse = await fetch(AI_API_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_API_KEY_ANALYZER}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: ANALYZER_PROMPT },
          ...formattedHistory,
          { role: "user", content: userMessage },
        ],
        temperature: 0.1, // low temp for strict classification
      }),
    });

    if (!analyzerResponse.ok) {
      console.error("AI API error (Analyzer):", analyzerResponse.status, await analyzerResponse.text());
      return res.status(502).json({ error: "Enikk ippo uthram parayan thalparyam illa (upstream API error)" });
    }

    const analyzerData = await analyzerResponse.json();
    let rawOutput = analyzerData?.choices?.[0]?.message?.content?.trim() || "{}";
    // Strip markdown formatting if the model accidentally included it
    rawOutput = rawOutput.replace(/```json/gi, "").replace(/```/g, "").trim();
    
    let parsedAnalyzer;
    try {
      parsedAnalyzer = JSON.parse(rawOutput);
    } catch (e) {
      console.error("Failed to parse analyzer JSON:", rawOutput);
      parsedAnalyzer = { length: "MEDIUM", type: "Roast them sarcastically." };
    }

    let lengthCategory = (parsedAnalyzer.length || "MEDIUM").toUpperCase();
    let typeInstruction = parsedAnalyzer.type || "Roast them sarcastically.";

    // --- Step 2: Generate Final Roast ---
    let lengthRule = "";
    if (lengthCategory.includes("SHORT")) {
      lengthRule = "\n\nFORMAT RULE: Reply with a SHORT, punchy 1-line roast.";
    } else if (lengthCategory.includes("LONG")) {
      lengthRule = "\n\nFORMAT RULE: Structure your response exactly like ChatGPT would, using **bold headings**, bullet points, numbered steps, and a formal conclusion. Make it look like a comprehensive, massive essay.";
    } else {
      lengthRule = "\n\nFORMAT RULE: Reply with a MEDIUM length response (2-4 sentences). Give a punchy, direct roast without using headings or complex steps.";
    }

    const finalSystemPrompt = SYSTEM_PROMPT + lengthRule + `\n\nTHEMATIC INSTRUCTION: ${typeInstruction}`;

    const aiResponse = await fetch(AI_API_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_API_KEY_GENERATOR}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: finalSystemPrompt },
          ...formattedHistory,
          { role: "user", content: userMessage },
        ],
        temperature: 0.9,
      }),
    });

    if (!aiResponse.ok) {
      console.error("AI API error (Generator):", aiResponse.status, await aiResponse.text());
      return res.status(502).json({ error: "Enikk ippo uthram parayan thalparyam illa (upstream API error)" });
    }

    const data = await aiResponse.json();
    console.log(`[Router] Classified as ${lengthCategory}`);
    console.log("Full AI response choices:", JSON.stringify(data?.choices, null, 2));
    const reply = data?.choices?.[0]?.message?.content?.trim() || "Pulu has no reply for that, try again.";

    // Belt-and-braces: also screen the model's own output before it goes out.
    if (containsDistressSignal(reply)) {
      return res.json({ reply: SAFE_FALLBACK_REPLY, safeMode: true });
    }

    res.json({ reply });
  } catch (err) {
    console.error("Unexpected error in /api/troll:", err);
    res.status(500).json({ error: "Something broke on Pulu's end" });
  }
});

app.listen(PORT, () => {
  console.log(`Pulu is running on http://localhost:${PORT}`);
});
