require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CHAT_DAILY_LIMIT = 3;

// TODO: replace Map with Redis or SQLite for persistence across restarts
const rateLimitStore = new Map();

function getRateLimitEntry(deviceId) {
    const now = Date.now();
    const entry = rateLimitStore.get(deviceId);

    if (!entry || now >= entry.resetAt) {
        const tomorrow = new Date();
        tomorrow.setUTCHours(24, 0, 0, 0);
        const fresh = { count: 0, resetAt: tomorrow.getTime() };
        rateLimitStore.set(deviceId, fresh);
        return fresh;
    }

    return entry;
}

async function callOpenAI(body) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }

    return res.json();
}

app.post("/api/summarize", async (req, res) => {
    const { pageContent, pageTitle, pageUrl } = req.body;

    if (!pageContent || !pageTitle || !pageUrl) {
        return res.status(400).json({ success: false, error: "Missing required fields." });
    }

    try {
        const data = await callOpenAI({
            model: "gpt-4o",
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: `You are a helpful assistant that analyzes web page content.
Return ONLY valid JSON with this exact shape:
{ "summary": "<2-3 sentence summary>", "suggestedQuestions": ["q1", "q2", "q3", "q4"] }
The questions should be natural, curiosity-driven things a reader might ask about this content.`
                },
                {
                    role: "user",
                    content: `Page Title: ${pageTitle}\nPage URL: ${pageUrl}\n\nPage Content:\n${pageContent}`
                }
            ],
            max_tokens: 500,
            temperature: 0.3
        });

        const parsed = JSON.parse(data.choices[0].message.content);
        res.json({ success: true, summary: parsed.summary, suggestedQuestions: parsed.suggestedQuestions });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post("/api/chat", async (req, res) => {
    const { deviceId, history, pageContent, pageTitle, pageUrl } = req.body;

    if (!deviceId) {
        return res.status(400).json({ success: false, error: "Missing required field: deviceId" });
    }
    if (!history || !pageContent || !pageTitle || !pageUrl) {
        return res.status(400).json({ success: false, error: "Missing required fields." });
    }

    const entry = getRateLimitEntry(deviceId);

    if (entry.count >= CHAT_DAILY_LIMIT) {
        return res.json({ success: false, error: "RATE_LIMIT", remaining: 0 });
    }

    entry.count++;

    try {
        const data = await callOpenAI({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: `You are a helpful assistant answering questions about a specific web page.
Answer concisely and accurately based on the page content below.
If the answer cannot be determined from the content, say so clearly.

Page Title: ${pageTitle}
Page URL: ${pageUrl}

Page Content:
${pageContent}`
                },
                ...history
            ],
            max_tokens: 1000,
            temperature: 0.7
        });

        const remaining = CHAT_DAILY_LIMIT - entry.count;
        res.json({ success: true, reply: data.choices[0].message.content, remaining });
    } catch (e) {
        entry.count--;
        res.json({ success: false, error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`BriefChat proxy listening on port ${PORT}`);
});
