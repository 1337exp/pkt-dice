import { createApp } from 'vue';
import TaoUI, { localeRu } from '@1337exp/taoui';
import '@1337exp/taoui/styles.css';
import './styles/app.css';
import App from './App.vue';

createApp(App).use(TaoUI, { locale: localeRu }).mount('#app');
