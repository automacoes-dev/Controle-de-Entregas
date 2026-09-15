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
  apiKey: "AIzaSyC8DizbaPkfD3iGn3bfzOnLoFYTuYltwsA",
  authDomain: "entregas-b8cca.firebaseapp.com",
  projectId: "entregas-b8cca",
  storageBucket: "entregas-b8cca.firebasestorage.app",
  messagingSenderId: "443270533251",
  appId: "1:443270533251:web:d2245e9a44e77b88050bb6",
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
