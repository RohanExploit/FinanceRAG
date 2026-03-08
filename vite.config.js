import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        target: 'esnext',
        outDir: 'dist',
        sourcemap: false,
        minify: 'terser',
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
            output: {
                manualChunks: {
                    'pdf': ['pdfjs-dist'],
                    'firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
                    'gemini': ['@google/generative-ai'],
                }
            }
        }
    },
    optimizeDeps: {
        exclude: ['pdfjs-dist'],
    },
});
