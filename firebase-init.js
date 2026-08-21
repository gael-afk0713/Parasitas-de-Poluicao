// Inicializa o app Firebase uma única vez e exporta `auth`/`db` prontos
// pra usar em script.js e fase1.js. SDK modular via CDN (gstatic), sem
// bundler/build step — pinado numa versão fixa (12.18.0) de propósito,
// pra não quebrar silenciosamente se a "latest" mudar a API por baixo.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
