// server.js
const express = require("express");
const path = require("path");
require("dotenv").config();
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { GoogleGenAI } = require("@google/genai");

const app = express();

/* ---------------- SECURITY & MIDDLEWARE ---------------- */

// CORS (restrict in production)
app.use(cors({
    origin: "*", // change to your domain in production
}));

app.use(express.json({ limit: "2mb" }));

// Basic rate limiting
app.use(rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute per IP
}));

/* ---------------- ENV CHECK ---------------- */

const API_KEY = process.env.GOOGLE_AI_KEY;
if (!API_KEY) {
    console.error("FATAL: GOOGLE_AI_KEY not set.");
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });
const PORT = process.env.APP_PORT || 3000;

/* =========================================================
   TEXT GENERATION ENDPOINT
========================================================= */

app.post("/api/generate-text", async (req, res) => {
    try {
        const { contents, systemInstruction } = req.body;

        if (!contents || !Array.isArray(contents)) {
            return res.status(400).json({ error: "Invalid contents format." });
        }

        const systemText =
            systemInstruction?.parts?.[0]?.text || "";

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents,
            config: {
                systemInstruction: systemText,
                temperature: 0.7,
                topP: 0.9,
            },
        });

        const text =
            response?.candidates?.[0]?.content?.parts?.[0]?.text ||
            "No response generated.";

        return res.json({
            candidates: [{
                content: {
                    parts: [{ text }]
                }
            }]
        });

    } catch (error) {
        console.error("TEXT ERROR:", error);

        return res.status(500).json({
            error: "LLM processing failed.",
            details: error.message,
        });
    }
});

/* =========================================================
   IMAGE GENERATION ENDPOINT
========================================================= */

app.post("/api/generate-image", async (req, res) => {
    try {
        const { instances } = req.body;

        if (!instances || !instances[0]?.prompt) {
            return res.status(400).json({ error: "Invalid prompt." });
        }

        const prompt = instances[0].prompt;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-image",
            contents: [{ text: prompt }],
            config: {
                responseMimeTypes: ["image/jpeg"],
            }
        });

        const imagePart =
            response?.candidates?.[0]?.content?.parts?.find(
                p => p.inlineData?.mimeType?.startsWith("image/")
            );

        if (!imagePart) {
            return res.status(500).json({
                error: "Model returned no image data."
            });
        }

        const base64Image = imagePart.inlineData.data;

        return res.json(
