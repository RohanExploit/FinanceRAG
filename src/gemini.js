import { GoogleGenerativeAI } from "@google/generative-ai";

const FALLBACK_KEYS = [
    import.meta.env.VITE_GEMINI_API_KEY,
    "AIzaSyADs38Bb0c9B5mOXsUDnP2tsMZNbzNEL1w",
    "AIzaSyB2phEbtGDUKQyUBpEOmPJU_-N0yyLOtwo",
    "AIzaSyC0GKCb9W-i-eoWlxfbiWxHARTohuGwi2Y"
].filter(Boolean);

const API_KEYS = [...new Set(FALLBACK_KEYS)];
let currentKeyIndex = 0;

/**
 * Execute an AI action, automatically falling back to the next API key
 * if one hits a quota limit or fails.
 */
async function withFallback(actionFn) {
    let attempts = 0;
    while (attempts < API_KEYS.length) {
        try {
            const apiKey = API_KEYS[currentKeyIndex];
            const genAI = new GoogleGenerativeAI(apiKey);
            return await actionFn(genAI);
        } catch (err) {
            console.warn(`[Fallback] Gemini API Key index ${currentKeyIndex} failed: ${err.message}. Switching to next key...`);
            currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
            attempts++;
            if (attempts >= API_KEYS.length) {
                throw new Error(`All available Gemini API keys failed or rate-limited. Last error: ${err.message}`);
            }
        }
    }
}

/**
 * Generate embedding vector for a piece of text.
 * Uses text-embedding-004 (768-dim, free tier: 1500 req/day)
 */
export async function getEmbedding(text) {
    return await withFallback(async (genAI) => {
        // Fallback to the stable V1 embedding model: embedding-001
        const model = genAI.getGenerativeModel({ model: "embedding-001" });
        const result = await model.embedContent(text);
        return result.embedding.values;
    });
}

/**
 * Stream a financial answer from Gemini 1.5 Flash.
 * Free tier: 15 RPM, 1M TPM, 1500 req/day
 * @param {string} prompt - Full RAG prompt with context
 * @param {function} onChunk - Called with (newText, fullText) on each chunk
 */
export async function streamAnswer(prompt, onChunk) {
    return await withFallback(async (genAI) => {
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            systemInstruction: `You are AlphaInsight Pro, an expert financial analyst AI.
You answer questions strictly based on the provided financial document context.
Be precise, cite numbers and figures, and use professional financial language.
If the context doesn't contain the answer, say so honestly — do NOT hallucinate.
Format numbers clearly (e.g. $1.2M, 15.3%, Q3 FY2024).`,
        });

        const result = await model.generateContentStream(prompt);
        let fullText = "";

        for await (const chunk of result.stream) {
            const text = chunk.text();
            fullText += text;
            if (onChunk) onChunk(text, fullText);
        }

        return fullText;
    });
}
