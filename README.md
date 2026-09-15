# Rota Certa — Controle de Entregas

Sistema web completo para caminhoneiros controlarem entregas e o recebimento
por quinzena. Funciona 100% no navegador, sem login, sem servidor e sem
serviços externos — todos os dados ficam salvos no próprio aparelho
(`localStorage`).

## ⚠️ Leia isto primeiro se for usar no iPhone

Se você **descompactou o ZIP e tocou no `index.html` direto pelo app Arquivos**
(ou por um anexo de e-mail/WhatsApp), o iPhone abre o arquivo no modo
"Visualização Rápida" (Quick Look) — uma pré-visualização estática que **não
executa o JavaScript**. É por isso que os botões não respondem: a página
aparece, mas nada dentro dela roda de verdade. Isso não é um bug do código,
é uma limitação de como o iOS abre arquivos `.html` soltos.

Duas formas de resolver:

### Opção rápida (só para testar, dados podem não persistir)
1. No app **Arquivos**, toque e segure em `index.html` (não dê toque simples).
2. Toque em **Compartilhar** → **Safari** (ou "Abrir no Safari"), em vez de deixar abrir a pré-visualização.
3. Agora o Safari de verdade carrega a página e os botões funcionam.

Essa opção é só para conferir o app rapidamente. Como o endereço continua
sendo `file://`, o Safari trata os dados como temporários — eles podem se
perder ao reabrir. **Não use essa opção no dia a dia.**

### Opção recomendada (funciona de verdade, inclusive offline e "instalar como app")
Publique os arquivos da pasta em um link `https://` gratuito — depois disso
tudo funciona normalmente: botões, salvamento dos dados, e "Adicionar à Tela
de Início" como um aplicativo de verdade.

**Passo a passo com Netlify Drop (mais simples, não precisa criar conta):**
1. No computador, acesse **app.netlify.com/drop**.
2. Arraste a pasta inteira do projeto (com `index.html`, `style.css`, `app.js` etc.) para a área indicada no site.
3. Em poucos segundos o Netlify gera um link `https://alguma-coisa.netlify.app`.
4. Abra esse link no iPhone pelo Safari.
5. Toque no botão de compartilhar (ícone de seta para cima) → **"Adicionar à Tela de Início"**.
6. Pronto: o app fica com ícone próprio na tela do iPhone, funciona offline depois do primeiro carregamento, e os dados salvos ficam persistentes nesse endereço.

Alternativas ao Netlify Drop: GitHub Pages, Vercel, ou qualquer hospedagem
estática — o resultado é o mesmo, um link `https://` fixo.

## Como usar (computador / testes locais)

Não existe build, npm install ou servidor a configurar: é HTML + CSS + JS puro.

**Opção 1 — abrir direto**
Dê duplo clique em `index.html`. No computador isso normalmente funciona bem
para testar (Chrome, Firefox, Edge executam o JavaScript de arquivos locais
normalmente). Só o Service Worker (modo offline) fica desativado nesse modo.

**Opção 2 — servidor local (recomendado, habilita o modo offline/PWA)**
Com Python instalado, na pasta do projeto:

```bash
python3 -m http.server 8080
```

Depois acesse `http://localhost:8080` no navegador do celular ou computador
(se for testar pelo celular, os dois precisam estar na mesma rede Wi-Fi, e
você deve acessar pelo IP do computador em vez de "localhost").

**Opção 3 — hospedar (a que vale para uso real no iPhone, veja seção acima)**
Suba os arquivos da pasta em qualquer hospedagem estática (GitHub Pages,
Netlify, Vercel, cPanel etc.). Como é só HTML/CSS/JS, qualquer servidor
estático funciona.

## Instalar como aplicativo (PWA)

Com o site aberto via `http://` ou `https://` (não `file://`):

- **Android/Chrome**: menu ⋮ → "Adicionar à tela inicial" / "Instalar app".
- **iPhone/Safari**: botão de compartilhar → "Adicionar à Tela de Início".

Depois de instalado uma vez com internet, o app volta a abrir mesmo sem
conexão — o Service Worker (`sw.js`) guarda em cache os arquivos da
aplicação. Os dados dos lançamentos continuam salvos localmente por conta do
`localStorage`, que não depende de internet em nenhum momento.

## Estrutura dos arquivos

```
index.html     Estrutura das telas (Painel, Nova entrega, Entregas, Histórico, Ajustes)
style.css      Todo o visual do app (tema "rodovia noturna": asfalto + amarelo de sinalização)
app.js         Toda a lógica: cálculos, regra da quinzena, CRUD, filtros, gráficos, backup
manifest.json  Metadados do PWA (nome, ícone, cor do tema)
sw.js          Service Worker — cache dos arquivos para uso offline
icon-192.png   Ícone do app (tela inicial do celular)
icon-512.png   Ícone do app em alta resolução
```

## Sobre os dados

- Cada entrega fica salva com um ID único em `localStorage`, na chave
  `rotacerta:v1`, como uma lista de objetos JSON.
- A quinzena **nunca é salva** — ela é sempre recalculada a partir da data
  no momento de exibir, editar ou filtrar. Isso garante que, se você mudar a
  data de uma entrega, ela troca de quinzena automaticamente, sem risco de
  ficar um dado antigo "preso" no registro.
- Use a tela **Ajustes → Exportar backup (JSON)** periodicamente. Como o
  armazenamento é local, limpar os dados do navegador (ou trocar de
  aparelho) apaga os lançamentos — o backup é a forma de não perder nada.
- `Ajustes → Importar backup` **substitui** todos os dados atuais pelos do
  arquivo importado (pede confirmação antes).

## Trocar o armazenamento local por um banco de dados no futuro

Toda leitura/escrita passa por um único objeto, no topo de `app.js`:

```js
const DB = {
  load() { /* lê do localStorage */ },
  saveAll(entregas) { /* grava no localStorage */ },
};
```

Para migrar para uma API/banco de dados real, basta reescrever `load()` e
`saveAll()` para fazerem `fetch` a um backend, mantendo a mesma assinatura.
Nenhuma outra parte do código toca em `localStorage` diretamente.
