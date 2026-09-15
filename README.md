# Rota Certa — Controle de Entregas

Sistema web para caminhoneiros controlarem entregas e o recebimento por
quinzena. Agora com **login com conta Google**: cada pessoa que usa o app
(pelo mesmo link) só enxerga os próprios lançamentos — os dados ficam
guardados na nuvem, no [Firebase](https://firebase.google.com) (produto do
Google), separados por usuário.

---

## ⚙️ Configuração obrigatória (fazer uma única vez): Firebase

O código já está pronto para login com Google, mas ele precisa de um projeto
Firebase seu para funcionar (é o Firebase que guarda os logins e os dados).
É gratuito para este uso e leva uns 10 minutos.

### 1. Crie o projeto no Firebase
1. Acesse **console.firebase.google.com** e entre com sua conta Google.
2. Clique em **"Adicionar projeto"**, dê um nome (ex.: "rota-certa") e conclua a criação.

### 2. Ative o login com Google
1. No menu à esquerda, vá em **Compilação (Build) → Authentication**.
2. Clique em **"Vamos começar" / "Get started"**.
3. Na aba **"Sign-in method"**, clique em **Google** → ative → escolha um
   e-mail de suporte → **Salvar**.

### 3. Autorize o domínio do seu site
1. Ainda em **Authentication → Settings → Authorized domains**.
2. Clique em **"Add domain"** e adicione o domínio do seu GitHub Pages, por
   exemplo `evelynsolano999-ctrl.github.io` (sem `https://` e sem o caminho
   depois da barra).

### 4. Libere o login para qualquer pessoa (não só você)
Por padrão, o Google às vezes cria a "tela de consentimento OAuth" em modo de
teste, que só deixa logar e-mails cadastrados manualmente. Para que qualquer
motorista consiga entrar com a própria conta:
1. Acesse **console.cloud.google.com/apis/credentials/consent** (é o mesmo
   projeto do Firebase — confira o nome no topo da página).
2. Se o status de publicação estiver como **"Testing"**, clique em
   **"PUBLICAR APLICATIVO" / "Publish App"** e confirme.
3. Como o app só pede e-mail e nome básico (não é um escopo sensível), a
   publicação é imediata — não precisa de análise do Google.

### 5. Crie o banco de dados (Firestore)
1. No menu do Firebase, vá em **Compilação → Firestore Database**.
2. Clique em **"Criar banco de dados"**, escolha uma localização (ex.:
   `southamerica-east1` para Brasil) e comece em **modo de produção**.

### 6. Configure as regras de segurança (garante que ninguém veja o dado de outra pessoa)
1. Em **Firestore Database → Regras (Rules)**, apague o conteúdo e cole:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /entregas/{entregaId} {
      allow read, update, delete: if request.auth != null
                                    && request.auth.uid == resource.data.uid;
      allow create: if request.auth != null
                     && request.auth.uid == request.resource.data.uid;
    }
  }
}
```

2. Clique em **"Publicar"**.

Essa regra garante, no próprio servidor do Google, que um usuário só
consegue ler, criar, editar ou apagar documentos que tenham o `uid` da
própria conta — mesmo que alguém tente manipular o app pelo celular, o
Firestore recusa.

### 7. Pegue as chaves do projeto e cole no código
1. No Firebase, clique na engrenagem ⚙️ → **"Configurações do projeto"**.
2. Role até **"Seus aplicativos"** e clique no ícone **`</>`** (Web) para
   registrar um app da Web (dê qualquer apelido).
3. O Firebase mostra um bloco `firebaseConfig = { ... }`. Copie os valores.
4. Abra o arquivo **`firebase-config.js`** deste projeto e cole cada valor no
   lugar de `COLE_AQUI_...`.

### 8. Suba os arquivos atualizados para o MESMO repositório do GitHub
Você **não precisa criar um repositório novo nem perder o link atual**. No
repositório que já existe (o que já está recebendo seus lançamentos):
1. Abra o repositório no GitHub pelo navegador.
2. Para cada arquivo que mudou (`index.html`, `app.js`, `style.css`, `sw.js`
   e o novo `firebase-config.js`), clique no arquivo → ícone de lápis
   (Edit) → apague o conteúdo antigo → cole o conteúdo novo → **Commit
   changes**. Para o `firebase-config.js`, que é novo, use **Add file →
   Upload files** e arraste-o.
3. O link do GitHub Pages continua exatamente o mesmo — só o conteúdo é
   atualizado.

Pronto: a partir daí, abrir o link vai pedir login com Google antes de
mostrar qualquer tela do app.

---

## 🔒 Sobre os dados que você já cadastrou

Os lançamentos que você já digitou pelo link antigo (antes do login existir)
ficaram salvos no `localStorage` **do aparelho/navegador que você usou** —
eles não desaparecem com essa atualização. Assim que você atualizar os
arquivos e logar com o Google pela primeira vez **nesse mesmo aparelho**, o
app detecta esses dados antigos e pergunta:

> "Encontramos N entrega(s) salvas neste aparelho... Deseja importar para a
> sua conta?"

Ao confirmar, tudo é copiado para a sua conta na nuvem — de lá em diante,
esses lançamentos aparecem em qualquer aparelho em que você logar com o
mesmo e-mail. Se quiser conferir os dados antigos antes de migrar, sugestão:
antes de atualizar os arquivos, entre em **Ajustes → Exportar backup (JSON)**
no app atual e guarde o arquivo — é uma cópia de segurança extra.

Essa pergunta de importação só aparece uma vez por conta/aparelho.

---

## Como cada usuário passa a usar o app

1. Cada pessoa abre o mesmo link do GitHub Pages.
2. Toca em **"Entrar com o Google"** e escolhe a própria conta.
3. A partir daí, cadastra as próprias entregas normalmente — ninguém mais
   enxerga esses lançamentos, só quem logou com aquele e-mail.
4. Para sair da conta (ex.: trocar de motorista no mesmo aparelho): **Ajustes
   → Sair da conta**.

---

## ⚠️ Sobre abrir o arquivo direto no iPhone (sem link)

Se alguém **descompactar o ZIP e tocar no `index.html` direto pelo app
Arquivos**, o iPhone abre no modo "Visualização Rápida" (Quick Look) — uma
pré-visualização que **não executa JavaScript nem permite login com Google**.
O app só funciona de verdade pelo link `https://` publicado (GitHub Pages).
Não há como o login com Google funcionar em modo `file://` — é uma exigência
de segurança do próprio Google.

## Instalar como aplicativo (PWA)

Com o site já publicado em `https://`:
- **Android/Chrome**: menu ⋮ → "Adicionar à tela inicial" / "Instalar app".
- **iPhone/Safari**: botão de compartilhar → "Adicionar à Tela de Início".

O app volta a abrir mesmo sem internet (Service Worker cacheia os arquivos).
Os lançamentos em si sincronizam automaticamente quando a internet volta,
graças ao cache offline do próprio Firestore.

## Estrutura dos arquivos

```
index.html          Estrutura das telas (Login, Painel, Nova entrega, Entregas, Histórico, Ajustes)
style.css           Todo o visual do app
app.js              Lógica: login, cálculos, regra da quinzena, CRUD via Firestore, filtros, gráficos
firebase-config.js  Chaves do SEU projeto Firebase (edite este arquivo — veja seção de configuração acima)
manifest.json       Metadados do PWA (nome, ícone, cor do tema)
sw.js               Service Worker — cache dos arquivos do app para uso offline
icon-192.png        Ícone do app
icon-512.png        Ícone do app em alta resolução
```

## Sobre os dados

- Cada entrega é um documento na coleção `entregas` do Firestore, com um
  campo `uid` igual ao ID da conta Google que a criou.
- A quinzena **nunca é salva** — é sempre recalculada a partir da data no
  momento de exibir, editar ou filtrar.
- **Ajustes → Exportar backup (JSON)** continua disponível a qualquer
  momento, por usuário logado.
- **Ajustes → Importar backup** substitui todos os dados da conta logada
  pelos do arquivo (pede confirmação antes).
- **Ajustes → Apagar tudo** remove todos os lançamentos da conta logada.
