import express from 'express';
import cors from 'cors';
import { genkit, z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { expressHandler } from '@genkit-ai/express';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin
let adminDb = null;
try {
  if (process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    adminDb = admin.firestore();
  }
} catch (e) {
  console.warn("Firebase Admin not configured (development mode):", e.message);
}

const apiKeys = [
    process.env.VITE_GEMINI_API_KEY,
    "AIzaSyADs38Bb0c9B5mOXsUDnP2tsMZNbzNEL1w", // fallback 1
    "AIzaSyB2phEbtGDUKQyUBpEOmPJU_-N0yyLOtwo", // fallback 2
    "AIzaSyC0GKCb9W-i-eoWlxfbiWxHARTohuGwi2Y"  // fallback 3
].filter(Boolean);

let currentKeyIndex = 0;

const aiInstances = apiKeys.map(key => genkit({
    plugins: [googleAI({ apiKey: key })],
}));

const baseAi = aiInstances[0];

// Chat Flow with Streaming
export const chatFlow = baseAi.defineFlow(
    {
        name: 'chatFlow',
        inputSchema: z.object({
            prompt: z.string(),
            context: z.array(z.string()).optional(),
        }),
        outputSchema: z.object({ response: z.string() })
    },
    async ({ prompt, context }, { sendChunk }) => {
        let fullPrompt = prompt;
        if (context && context.length > 0) {
            fullPrompt = `You are AlphaInsight Pro, an expert financial analyst AI. You answer questions strictly based on the provided financial document context. Be precise, cite numbers and figures, and use professional financial language. If the context doesn't contain the answer, say so honestly - do NOT hallucinate.\n\nContext information is below.\n---------------------\n${context.join('\n')}\n---------------------\nGiven the context information and not prior knowledge, answer the query.\nQuery: ${prompt}`;
        }

        let attempts = 0;
        let lastError = null;

        while (attempts < aiInstances.length) {
            try {
                const currentAi = aiInstances[currentKeyIndex];
                const { text } = await currentAi.generate({
                    model: currentAi.model('googleai/gemini-1.5-flash'),
                    prompt: fullPrompt,
                    config: {
                        temperature: 0.7,
                    },
                    onChunk: (chunk) => {
                        sendChunk(chunk.text);
                    }
                });
                return { response: text };
            } catch (error) {
                console.warn(`Genkit error with key ${currentKeyIndex}:`, error.message);
                lastError = error;
                if (error.status === 429 || String(error.message).includes('429') || String(error.message).includes('exhausted') || String(error.message).includes('API key')) {
                    currentKeyIndex = (currentKeyIndex + 1) % aiInstances.length;
                    attempts++;
                } else {
                    throw error;
                }
            }
        }
        throw new Error(`All Genkit fallback API keys failed. Last error: ${lastError?.message}`);
    }
);

// Embed Flow
export const embedFlow = baseAi.defineFlow(
    {
        name: 'embedFlow',
        inputSchema: z.object({ text: z.string() }),
        outputSchema: z.object({ embedding: z.array(z.number()) })
    },
    async ({ text }) => {
        let attempts = 0;
        let lastError = null;

        while (attempts < aiInstances.length) {
            try {
                const currentAi = aiInstances[currentKeyIndex];
                const result = await currentAi.embed({
                    model: currentAi.model('googleai/text-embedding-004'),
                    content: text
                });
                return { embedding: result };
            } catch (error) {
                console.warn(`Genkit embed error with key ${currentKeyIndex}:`, error.message);
                lastError = error;
                if (error.status === 429 || String(error.message).includes('429') || String(error.message).includes('exhausted') || String(error.message).includes('API key')) {
                    currentKeyIndex = (currentKeyIndex + 1) % aiInstances.length;
                    attempts++;
                } else {
                    throw error;
                }
            }
        }
        throw new Error(`All Genkit fallback API keys failed. Last error: ${lastError?.message}`);
    }
);

app.post('/api/chat', expressHandler(chatFlow));
app.post('/api/embed', expressHandler(embedFlow));

// ─── Firebase Admin Token Verification Middleware ────────────────────────────

async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const idToken = authHeader.slice(7);
  try {
    if (!admin.apps.length) {
      return res.status(500).json({ error: 'Firebase Admin not configured' });
    }
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.userId = decodedToken.uid;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── Cosine Similarity (for API query) ────────────────────────────────────────

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ─── API Endpoints ────────────────────────────────────────────────────────────

// GET /api/documents - List user's documents
app.get('/api/documents', verifyToken, async (req, res) => {
  try {
    const snap = await adminDb.collection(`users/${req.userId}/docMeta`).get();
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ data: docs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chats - List user's chats
app.get('/api/chats', verifyToken, async (req, res) => {
  try {
    const snap = await adminDb
      .collection(`users/${req.userId}/chats`)
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get();
    const chats = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ data: chats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/query - Run RAG query and return JSON response
app.post('/api/query', verifyToken, async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }

  try {
    // Get embedding for query
    const { embedding: queryEmbedding } = await baseAi.run(embedFlow, { text: query });

    // Retrieve chunks and score
    const chunksSnap = await adminDb.collection(`users/${req.userId}/chunks`).get();
    const scored = chunksSnap.docs
      .map((d) => {
        const data = d.data();
        return {
          text: data.text,
          docName: data.docName,
          score: cosineSimilarity(queryEmbedding, data.embedding),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    const context = scored.map((c, i) => `[${i + 1}] (${c.docName})\n${c.text}`).join('\n\n---\n\n');
    const sources = [...new Set(scored.map((c) => c.docName))];

    const prompt = `FINANCIAL DOCUMENT CONTEXT:\n────────────────────────────\n${context}\n────────────────────────────\n\nUSER QUESTION: ${query}\n\nAnswer based strictly on the context. Be concise and cite numbers where relevant.`;

    // Generate response
    const { text } = await baseAi.generate({
      model: baseAi.model('googleai/gemini-1.5-flash'),
      prompt,
      config: { temperature: 0.7 },
    });

    res.json({ data: { response: text, sources } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics - Return computed statistics
app.get('/api/analytics', verifyToken, async (req, res) => {
  try {
    const docsSnap = await adminDb.collection(`users/${req.userId}/docMeta`).get();
    const chunksSnap = await adminDb.collection(`users/${req.userId}/chunks`).get();
    const chatsSnap = await adminDb.collection(`users/${req.userId}/chats`).get();

    const docCount = docsSnap.size;
    const chunkCount = chunksSnap.size;
    const chatCount = chatsSnap.size;

    let totalMessages = 0;
    for (const chatDoc of chatsSnap.docs) {
      const messagesSnap = await adminDb
        .collection(`users/${req.userId}/chats/${chatDoc.id}/messages`)
        .get();
      totalMessages += messagesSnap.size;
    }

    // Find most queried doc
    const docChunkCounts = {};
    chunksSnap.docs.forEach((d) => {
      const docMetaId = d.data().docMetaId;
      docChunkCounts[docMetaId] = (docChunkCounts[docMetaId] || 0) + 1;
    });

    let mostQueriedDoc = '—';
    let mostQueriedCount = 0;
    docsSnap.docs.forEach((d) => {
      const count = docChunkCounts[d.id] || 0;
      if (count > mostQueriedCount) {
        mostQueriedCount = count;
        mostQueriedDoc = d.data().name;
      }
    });

    res.json({
      data: {
        docCount,
        chunkCount,
        chatCount,
        totalMessages,
        mostQueriedDoc,
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Genkit Express server running on port ${PORT}`);
});
