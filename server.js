// server.js (Running on your protected backend)
const express = require('express');
const path = require('path');
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const app = express();

const cors = require('cors'); 
app.use(cors());

app.use(express.json());


// NOTE: Make sure to set the GOOGLE_AI_KEY environment variable when running the server!
const API_KEY = process.env.GOOGLE_AI_KEY; 
if (!API_KEY) {
    console.error("FATAL: GOOGLE_AI_KEY environment variable not set.");
    process.exit(1);
}
const ai = new GoogleGenAI({ apiKey: API_KEY }); 
const PORT = process.env.APP_PORT || 3000;

// --- 2. NEW: Text Generation Endpoint ---
app.post('/api/generate-text', async (req, res) => {
    const { contents, systemInstruction } = req.body;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash", // Using a powerful and fast model
            contents: contents,
            config: {
                systemInstruction: systemInstruction.parts[0].text,
                // Add any other configuration you need here (temperature, topP, etc.)
            }
        });
        
        // Respond with a structure the frontend expects (mimicking the original API)
        res.json({
            candidates: [{
                content: {
                    parts: [{ text: response.text }]
                }
            }]
        });

    } catch (error) {
        console.error("Text generation failed on backend:", error);
        // Send a 500 status and an error message to the client
        res.status(500).json({ error: "Server-side LLM processing failed." });
    }
});

// --- 3. CORRECTED Image Proxy Endpoint ---
app.post('/api/generate-image', async (req, res) => {
    // Extract the prompt from the frontend structure
    const { instances } = req.body;
    const prompt = instances[0].prompt; 
    
    try {
        // Step 1: Call the Multimodal Model
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-image",
            contents: [{ text: prompt }], // Pass the prompt as a Part object
            config: { 
                // Set the expected response format
                responseMimeTypes: ["image/jpeg"],
            }
        });

        // 🛑 DEBUG LINE ADDED HERE 🛑
        console.log("--- DEBUG: Full API Image Response ---");
        console.log(JSON.stringify(response, null, 2));
        console.log("---------------------------------------");
        // 🛑 END DEBUG LINE 🛑

        // Step 2: Extract the Base64 Image Data (CORRECT PARSING for generateContent)
        // The image data is nested deep within the response structure (candidates -> content -> parts)
        const imagePart = response.candidates[0]?.content?.parts?.find(
            p => p.inlineData && p.inlineData.mimeType.startsWith('image/')
        );
        
        if (imagePart) {
            const base64Image = imagePart.inlineData.data;
            // Step 3: Send the URL back to the client
            res.json({ 
                // Ensure the data URL matches the MIME type used
                imageUrl: `data:image/jpeg;base64,${base64Image}` 
            });
        } else {
            // Handle case where no image was successfully generated
            console.error("Image generation successful, but no image data found in response.");
            res.status(500).json({ error: "Model did not return image data. Check prompt or quota." });
        }

    } catch (error) {
        console.error("Image generation failed on backend:", error);
        // This is where 429 quota errors will be logged if you hit the limit
        res.status(500).json({ error: "Server-side visual render failed: " + error.message });
    }
});


// --- 4. Serve Static Files ---
// This serves all frontend files (index.html, index.js, etc.) from the 'public' folder.
app.use(express.static(path.join(__dirname, 'public')));


// --- 5. Start the Server ---
app.listen(PORT, () => {
    console.log(`Proxy and Web Server running on http://localhost:${PORT}`);
});