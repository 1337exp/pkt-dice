import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
    // Относительные пути: сборку можно положить в любую подпапку сайта или в WebView.
    base: './',
    plugins: [vue()],
    resolve: { dedupe: ['vue'] },
});
