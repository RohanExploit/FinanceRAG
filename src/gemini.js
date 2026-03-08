const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : '';

/**
 * Generate embedding vector for a piece of text via backend.
 */
export async function getEmbedding(text) {
    try {
        const response = await fetch(`${API_BASE}/api/embed`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ text }),
        });

        if (!response.ok) {
            throw new Error(`Embedding failed: ${response.status}`);
        }

        const data = await response.json();
        return data.embedding;
    } catch (err) {
        console.error("Embedding error:", err);
        throw new Error(`Failed to generate embedding: ${err.message}`);
    }
}

/**
 * Stream a financial answer from Claude via backend.
 * @param {string} prompt - Full RAG prompt with context
 * @param {function} onChunk - Called with (newText, fullText) on each chunk
 */
export async function streamAnswer(prompt, onChunk) {
    try {
        const response = await fetch(`${API_BASE}/api/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ prompt }),
        });

        if (!response.ok) {
            throw new Error(`Chat API failed: ${response.status}`);
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
                        const text = parsed.text || "";
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
