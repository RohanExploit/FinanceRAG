import { db } from "./firebase.js";
import {
    collection, addDoc, getDocs, getDoc, query,
    where, doc, deleteDoc, serverTimestamp, orderBy, limit, updateDoc, increment,
} from "firebase/firestore";
import { getEmbedding } from "./gemini.js";

// ─── PDF Text Extraction ──────────────────────────────────────────────────────

export async function extractPdfText(file) {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        fullText += content.items.map((it) => it.str).join(" ") + "\n\n";
    }
    return { text: fullText.trim(), pages: pdf.numPages };
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

export function chunkText(text, wordCount = 800, overlapWords = 40) {
    const words = text.split(/\s+/).filter(Boolean);
    const chunks = [];
    let i = 0;
    while (i < words.length) {
        const chunk = words.slice(i, i + wordCount).join(" ");
        if (chunk.trim()) chunks.push(chunk);
        i += wordCount - overlapWords;
    }
    return chunks;
}

// ─── Cosine Similarity ────────────────────────────────────────────────────────

export function cosineSimilarity(a, b) {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ─── Document Ingestion ───────────────────────────────────────────────────────

/**
 * Full ingestion pipeline (Storage-free version):
 * 1. Extract text with PDF.js locally
 * 2. Chunk text
 * 3. Embed chunks with Genkit/Gemini
 * 4. Store chunks + metadata → Firestore
 */
export async function ingestDocument(userId, file, onProgress) {
    onProgress?.("Preparing document...", 8);

    // Create metadata document first (with tags field)
    const metaRef = await addDoc(collection(db, `users/${userId}/docMeta`), {
        name: file.name,
        size: file.size,
        chunkCount: 0,
        pages: 0,
        tags: [],
        storageUrl: null, // Obsolete without Firebase Storage
        createdAt: serverTimestamp(),
    });

    // Step 2: Extract text
    onProgress?.("Extracting text from PDF (Local processing)…", 25);
    const { text, pages } = await extractPdfText(file);

    // Step 3: Chunk
    onProgress?.("Chunking document…", 32);
    const chunks = chunkText(text);

    // Step 4 & 5: Embed + store chunks
    // Gemini free tier: 100 RPM → 700ms minimum between requests
    const THROTTLE_MS = 700;
    const chunksColl = collection(db, `users/${userId}/chunks`);
    for (let i = 0; i < chunks.length; i++) {
        const remaining = chunks.length - i;
        const secsLeft = Math.ceil((remaining * (THROTTLE_MS + 500)) / 1000);
        onProgress?.(
            `Embedding chunk ${i + 1} of ${chunks.length}  (~${secsLeft}s left)`,
            32 + Math.floor((i / chunks.length) * 60)
        );
        const embedding = await getEmbedding(chunks[i]);
        await addDoc(chunksColl, {
            docMetaId: metaRef.id,
            docName: file.name,
            text: chunks[i],
            embedding,
            chunkIndex: i,
            createdAt: serverTimestamp(),
        });
        // Throttle: respects Gemini free tier 100 RPM limit
        await new Promise((r) => setTimeout(r, THROTTLE_MS));
    }

    // Update metadata with final values
    await updateDoc(metaRef, { chunkCount: chunks.length, pages, storageUrl: null });

    onProgress?.("Done! ✓", 100);
    return metaRef.id;
}

// ─── Document Retrieval ───────────────────────────────────────────────────────

export async function getUserDocs(userId) {
    const snap = await getDocs(collection(db, `users/${userId}/docMeta`));
    return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
}

export async function retrieveChunks(userId, queryText, k = 6, bustCache = false, docIds = null) {
    const cacheKey = `chunks_${userId}`;
    let allChunks = null;

    // Try to load from sessionStorage cache (unless bustCache is true)
    if (!bustCache) {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
            try { allChunks = JSON.parse(cached); } catch(e) {}
        }
    }

    // If not in cache, fetch from Firestore
    if (!allChunks) {
        const snap = await getDocs(collection(db, `users/${userId}/chunks`));
        allChunks = snap.docs.map((d) => {
            const data = d.data();
            return {
                id: d.id,
                text: data.text,
                docName: data.docName,
                docMetaId: data.docMetaId,
                embedding: data.embedding,
            };
        });
        // Try to store in sessionStorage for future queries
        try { sessionStorage.setItem(cacheKey, JSON.stringify(allChunks)); } catch(e) {}
    }

    // Filter by docIds if provided (for comparison mode)
    let filtered = allChunks;
    if (docIds && docIds.length > 0) {
        filtered = allChunks.filter((c) => docIds.includes(c.docMetaId));
    }

    // Score and rank
    const queryEmbedding = await getEmbedding(queryText);
    return filtered
        .map((data) => ({
            text: data.text,
            docName: data.docName,
            score: cosineSimilarity(queryEmbedding, data.embedding),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
}

export async function deleteDocument(userId, docMetaId) {
    // Delete chunks from Firestore
    const chunksRef = collection(db, `users/${userId}/chunks`);
    const q = query(chunksRef, where("docMetaId", "==", docMetaId));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));

    // Delete metadata from Firestore
    await deleteDoc(doc(db, `users/${userId}/docMeta`, docMetaId));
}

// ─── Chat Session Persistence ─────────────────────────────────────────────────

/**
 * Create a new chat session in Firestore (backend-persisted).
 */
export async function createChatSession(userId, title = "New Chat") {
    const ref = await addDoc(collection(db, `users/${userId}/chats`), {
        title,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        messageCount: 0,
    });
    return ref.id;
}

export async function getUserChats(userId) {
    const snap = await getDocs(
        query(collection(db, `users/${userId}/chats`), orderBy("updatedAt", "desc"), limit(20))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function saveMessage(userId, chatId, role, text, sources = []) {
    const msgRef = await addDoc(
        collection(db, `users/${userId}/chats/${chatId}/messages`),
        { role, text, sources, pinned: false, createdAt: serverTimestamp() }
    );
    // Update chat metadata (last message preview, message count) - use atomic increment
    await updateDoc(doc(db, `users/${userId}/chats`, chatId), {
        updatedAt: serverTimestamp(),
        lastMessage: text.slice(0, 80),
        messageCount: increment(1),
    });
    return msgRef.id;
}

export async function getChatMessages(userId, chatId) {
    const snap = await getDocs(
        query(
            collection(db, `users/${userId}/chats/${chatId}/messages`),
            orderBy("createdAt", "asc")
        )
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function updateChatTitle(userId, chatId, title) {
    await updateDoc(doc(db, `users/${userId}/chats`, chatId), { title });
}

export async function deleteChatSession(userId, chatId) {
    // Delete all messages
    const snap = await getDocs(collection(db, `users/${userId}/chats/${chatId}/messages`));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    // Delete chat
    await deleteDoc(doc(db, `users/${userId}/chats`, chatId));
}

// ─── Pinned Messages ──────────────────────────────────────────────────────────

export async function pinMessage(userId, chatId, messageId, pinned) {
    await updateDoc(doc(db, `users/${userId}/chats/${chatId}/messages`, messageId), { pinned });
}

export async function getPinnedMessages(userId, chatId) {
    const snap = await getDocs(
        query(
            collection(db, `users/${userId}/chats/${chatId}/messages`),
            where("pinned", "==", true),
            orderBy("createdAt", "asc")
        )
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ─── Document Tags ────────────────────────────────────────────────────────────

export async function updateDocTags(userId, docId, tags) {
    await updateDoc(doc(db, `users/${userId}/docMeta`, docId), { tags });
}

// ─── Analytics Data ───────────────────────────────────────────────────────────

export async function getAnalyticsData(userId) {
    try {
        const docsSnap = await getDocs(collection(db, `users/${userId}/docMeta`));
        const chunksSnap = await getDocs(collection(db, `users/${userId}/chunks`));
        const chatsSnap = await getDocs(collection(db, `users/${userId}/chats`));

        const docCount = docsSnap.size;
        const chunkCount = chunksSnap.size;
        const chatCount = chatsSnap.size;

        let totalMessages = 0;
        let mostQueriedDoc = null;
        let mostQueriedCount = 0;

        // Count messages per chat in parallel (instead of sequential awaits)
        const messageCounts = await Promise.all(
            chatsSnap.docs.map((chatDoc) =>
                getDocs(collection(db, `users/${userId}/chats/${chatDoc.id}/messages`))
                    .then((snap) => snap.size)
            )
        );
        totalMessages = messageCounts.reduce((sum, n) => sum + n, 0);

        // Find most queried document (count chunks per docMetaId)
        const docChunkCounts = {};
        chunksSnap.docs.forEach((d) => {
            const docMetaId = d.data().docMetaId;
            docChunkCounts[docMetaId] = (docChunkCounts[docMetaId] || 0) + 1;
        });

        docsSnap.docs.forEach((d) => {
            const count = docChunkCounts[d.id] || 0;
            if (count > mostQueriedCount) {
                mostQueriedCount = count;
                mostQueriedDoc = d.data().name;
            }
        });

        const latestDoc = docsSnap.docs.length > 0
            ? docsSnap.docs.sort((a, b) => (b.data().createdAt?.seconds ?? 0) - (a.data().createdAt?.seconds ?? 0))[0]
            : null;

        return {
            docCount,
            chunkCount,
            chatCount,
            totalMessages,
            mostQueriedDoc: mostQueriedDoc || "—",
            latestDoc: latestDoc?.data().name || "—",
            latestDocDate: latestDoc?.data().createdAt?.toDate?.() || new Date(),
        };
    } catch (e) {
        console.error("Analytics error:", e);
        return {
            docCount: 0,
            chunkCount: 0,
            chatCount: 0,
            totalMessages: 0,
            mostQueriedDoc: "—",
            latestDoc: "—",
            latestDocDate: new Date(),
        };
    }
}
