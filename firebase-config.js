// Chaves do PROJETO FIREBASE (Console → Configurações do projeto → Seus
// apps → SDK setup and configuration → "Config"). Não são segredo — a
// segurança de verdade vem das Regras do Firestore (firestore.rules) e do
// Firebase Authentication, não de esconder esse objeto — por isso é
// normal (e comum) esse arquivo ficar público num repositório estático.
//
// TROQUE os valores abaixo pelos do SEU projeto antes de jogar. Enquanto
// estiverem com os placeholders, login/cadastro e saves não funcionam —
// veja o passo a passo em CONTEXTO-PROJETO.md, seção "Como configurar o
// Firebase".
export const firebaseConfig = {
  apiKey: 'COLE_AQUI_SUA_API_KEY',
  authDomain: 'SEU-PROJETO.firebaseapp.com',
  projectId: 'SEU-PROJETO',
  storageBucket: 'SEU-PROJETO.firebasestorage.app',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000000000',
};
