const OPEN_ROUTER_API_KEY = "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";
const OPEN_ROUTER_BASE = "https://openrouter.ai/api/v1";

/**
 * Generate embedding vector for a piece of text.
 * Uses Open Router's text-embedding model
 */
export async function getEmbedding(text) {
    try {
        const response = await fetch(`${OPEN_ROUTER_BASE}/embeddings`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPEN_ROUTER_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "openai/text-embedding-3-small",
                input: text,
            }),
        });

        if (!response.ok) {
            throw new Error(`OpenRouter embedding failed: ${response.status}`);
        }

        const data = await response.json();
        return data.data[0].embedding;
    } catch (err) {
        console.error("Embedding error:", err);
        throw new Error(`Failed to generate embedding: ${err.message}`);
    }
}

/**
 * Stream a financial answer from Claude via Open Router.
 * @param {string} prompt - Full RAG prompt with context
 * @param {function} onChunk - Called with (newText, fullText) on each chunk
 */
export async function streamAnswer(prompt, onChunk) {
    try {
        const response = await fetch(`${OPEN_ROUTER_BASE}/chat/completions`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPEN_ROUTER_API_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": window.location.href,
            },
            body: JSON.stringify({
                model: "claude-3.5-sonnet",
                messages: [
                    {
                        role: "system",
                        content: `You are AlphaInsight Pro, an expert financial analyst AI.
You answer questions strictly based on the provided financial document context.
Be precise, cite numbers and figures, and use professional financial language.
If the context doesn't contain the answer, say so honestly — do NOT hallucinate.
Format numbers clearly (e.g. $1.2M, 15.3%, Q3 FY2024).`,
                    },
                    { role: "user", content: prompt },
                ],
                stream: true,
                temperature: 0.7,
            }),
        });

        if (!response.ok) {
            throw new Error(`Open Router API failed: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split("\n");

            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const data = line.slice(6);
                    if (data === "[DONE]") continue;

                    try {
                        const parsed = JSON.parse(data);
                        const text = parsed.choices[0]?.delta?.content || "";
                        if (text) {
                            fullText += text;
                            if (onChunk) onChunk(text, fullText);
                        }
                    } catch (e) {
                        // Skip parsing errors
                    }
                }
            }
        }

        return fullText;
    } catch (err) {
        console.error("Stream error:", err);
        throw new Error(`Failed to stream answer: ${err.message}`);
    }
}
