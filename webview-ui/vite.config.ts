import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import { resolve } from 'path';

export default defineConfig({
    plugins: [solidPlugin()],
    build: {
        target: 'esnext',
        outDir: resolve(__dirname, '../dist/webview'),
        rollupOptions: {
            input: {
                panel: resolve(__dirname, 'src/panel/index.tsx'),
                sidebar: resolve(__dirname, 'src/sidebar/index.tsx'),
            },
            output: {
                entryFileNames: '[name].js',
                chunkFileNames: '[name].js',
                assetFileNames: '[name].[ext]',
            },
        },
    },
});
