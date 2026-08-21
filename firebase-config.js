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
  apiKey: 'AIzaSyDELbxTgzSG3cBZgIeUeWTj5ylx0XjCibs',
  authDomain: 'parasitas-de-poluicao.firebaseapp.com',
  projectId: 'parasitas-de-poluicao',
  storageBucket: 'parasitas-de-poluicao.firebasestorage.app',
  messagingSenderId: '853761565278',
  appId: '1:853761565278:web:bd641a2809bf71fd84cacf',
  measurementId: 'G-CDKBC9ZD0J',
};
