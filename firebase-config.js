/* ==========================================================================
   CONFIGURAÇÃO DO FIREBASE
   ==========================================================================
   Substitua os valores abaixo pelos do SEU projeto no Firebase Console:
   https://console.firebase.google.com → seu projeto → ⚙️ Configurações do
   projeto → role até "Seus aplicativos" → app da Web → "Config".

   Veja o passo a passo completo no README.md, seção
   "Login com Google e dados na nuvem".
   ========================================================================== */

const firebaseConfig = {
  apiKey: "COLE_AQUI_SUA_API_KEY",
  authDomain: "COLE_AQUI_SEU_PROJETO.firebaseapp.com",
  projectId: "COLE_AQUI_SEU_PROJECT_ID",
  storageBucket: "COLE_AQUI_SEU_PROJETO.appspot.com",
  messagingSenderId: "COLE_AQUI_SEU_SENDER_ID",
  appId: "COLE_AQUI_SEU_APP_ID",
};

firebase.initializeApp(firebaseConfig);

// Deixa auth e db acessíveis para o app.js (que não usa módulos ES).
window.rotaCertaAuth = firebase.auth();
window.rotaCertaDb = firebase.firestore();

// Permite que o app funcione offline (cache local automático do Firestore),
// sincronizando sozinho assim que a internet voltar.
window.rotaCertaDb.enablePersistence({ synchronizeTabs: true }).catch((err) => {
  console.warn("Persistência offline do Firestore não pôde ser ativada:", err.code);
});
