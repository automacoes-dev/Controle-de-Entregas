/* ==========================================================================
   FRETE NA MÃO — lógica da aplicação
   Controle de entregas e recebimentos para caminhoneiros.
   Login com conta Google + dados salvos no Firestore, isolados por usuário.
   Funciona offline graças ao cache automático do Firestore (ver
   firebase-config.js), sincronizando sozinho quando a internet volta.
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * 1. AUTENTICAÇÃO E CAMADA DE ARMAZENAMENTO (Firebase)
   *    Toda leitura/escrita de entregas passa pelas funções abaixo, que
   *    conversam com o Firestore filtrando sempre pelo usuário logado.
   *    Cada documento da coleção "entregas" tem um campo "uid" — as regras
   *    de segurança do Firestore garantem que um usuário nunca leia ou
   *    altere documentos com "uid" de outra pessoa.
   * ------------------------------------------------------------------ */

  const auth = window.rotaCertaAuth;
  const db = window.rotaCertaDb;
  const COLECAO = "entregas";
  const LEGACY_KEY = "rotacerta:v1"; // chave usada pela versão antiga (só localStorage)

  let currentUser = null;
  let unsubscribeSnapshot = null;
  let uiEstaticaPronta = false;

  function isEntregaValida(o) {
    return (
      o &&
      typeof o.data === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(o.data) &&
      typeof o.bruto === "number" &&
      typeof o.percentual === "number" &&
      typeof o.liquido === "number"
    );
  }

  /** Converte um documento do Firestore no formato usado pelo app.
   *  Lançamentos antigos (de antes dos campos de gastos existirem) não têm
   *  os campos diesel/pedagio/etc. — por isso cada um usa "?? 0" como
   *  valor padrão. Isso NUNCA altera o documento salvo no Firestore, é só
   *  o valor usado na hora de exibir/calcular; o registro original
   *  continua intacto no banco. */
  function docParaEntrega(doc) {
    const d = doc.data();
    const diesel = d.diesel ?? 0;
    const pedagio = d.pedagio ?? 0;
    const alimentacao = d.alimentacao ?? 0;
    const estacionamento = d.estacionamento ?? 0;
    const outrosGastos = d.outrosGastos ?? 0;
    const ajudante = d.ajudante ?? 0;
    const totalGastos =
      d.totalGastos ?? diesel + pedagio + alimentacao + estacionamento + outrosGastos + ajudante;
    const liquidoAposGastos = d.liquidoAposGastos ?? d.liquido - totalGastos;
    return {
      id: doc.id,
      data: d.data,
      cidade: d.cidade && d.cidade.trim() ? d.cidade : "Não informado",
      bruto: d.bruto,
      percentual: d.percentual,
      liquido: d.liquido,
      diesel,
      pedagio,
      alimentacao,
      estacionamento,
      outrosGastos,
      ajudante,
      totalGastos,
      liquidoAposGastos,
    };
  }

  /* Estado em memória — sempre espelha o que está no Firestore para o
     usuário atual (atualizado em tempo real pelo listener onSnapshot). */
  let entregas = [];

  function dbAdicionar(dados) {
    return db.collection(COLECAO).add({
      ...dados,
      uid: currentUser.uid,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }

  function dbAtualizar(id, dados) {
    return db.collection(COLECAO).doc(id).update(dados);
  }

  function dbExcluir(id) {
    return db.collection(COLECAO).doc(id).delete();
  }

  function dbExcluirVarios(lista) {
    if (!lista.length) return Promise.resolve();
    const batch = db.batch();
    lista.forEach((e) => batch.delete(db.collection(COLECAO).doc(e.id)));
    return batch.commit();
  }

  /** Substitui todos os lançamentos do usuário pelos da lista informada. */
  function dbImportarLista(lista) {
    return dbExcluirVarios(entregas).then(() => {
      if (!lista.length) return;
      const batch = db.batch();
      lista.forEach((e) => {
        const ref = db.collection(COLECAO).doc();
        batch.set(ref, camposDeEntrega(e));
      });
      return batch.commit();
    });
  }

  /** Grava vários lançamentos novos de uma vez (usado na migração local → nuvem). */
  function dbAdicionarVarios(lista) {
    if (!lista.length) return Promise.resolve();
    const batch = db.batch();
    lista.forEach((e) => {
      const ref = db.collection(COLECAO).doc();
      batch.set(ref, camposDeEntrega(e));
    });
    return batch.commit();
  }

  /** Monta o objeto de campos gravado no Firestore a partir de uma entrega
   *  (própria do app ou vinda de um backup/importação antigo). Backups
   *  antigos não têm os campos de gastos — entram como 0, sem perder o
   *  restante do lançamento. */
  function camposDeEntrega(e) {
    const diesel = e.diesel ?? 0;
    const pedagio = e.pedagio ?? 0;
    const alimentacao = e.alimentacao ?? 0;
    const estacionamento = e.estacionamento ?? 0;
    const outrosGastos = e.outrosGastos ?? 0;
    const ajudante = e.ajudante ?? 0;
    const totalGastos = diesel + pedagio + alimentacao + estacionamento + outrosGastos + ajudante;
    return {
      data: e.data,
      cidade: e.cidade && String(e.cidade).trim() ? e.cidade : "Não informado",
      bruto: e.bruto,
      percentual: e.percentual,
      liquido: e.liquido,
      diesel,
      pedagio,
      alimentacao,
      estacionamento,
      outrosGastos,
      ajudante,
      totalGastos,
      liquidoAposGastos: e.liquido - totalGastos,
      uid: currentUser.uid,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    };
  }

  /** Verifica se existem dados de uma versão antiga (só localStorage, sem
   *  login) neste aparelho e, se houver, oferece importar para a conta que
   *  acabou de logar. Os dados locais nunca são apagados por esta função —
   *  só marcamos que já perguntamos, para não repetir a cada login. */
  function verificarMigracaoLocal(user) {
    const marcador = `rotacerta:migrado:${user.uid}`;
    if (localStorage.getItem(marcador)) return;

    let dadosLocais = [];
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) dadosLocais = parsed.filter(isEntregaValida);
      }
    } catch (e) {
      console.warn("Não foi possível ler dados locais antigos:", e);
    }

    if (!dadosLocais.length) {
      localStorage.setItem(marcador, "1");
      return;
    }

    abrirModal({
      titulo: "Importar dados deste aparelho?",
      corpo: `Encontramos ${dadosLocais.length} entrega(s) salvas neste aparelho (de antes do login). Deseja importar para a sua conta (${user.email})? Nada será apagado deste aparelho.`,
      textoConfirmar: "Importar agora",
    }).then((ok) => {
      localStorage.setItem(marcador, "1");
      if (!ok) return;
      dbAdicionarVarios(dadosLocais)
        .then(() => showToast("Dados importados com sucesso."))
        .catch((err) => {
          console.error("Falha ao importar dados locais:", err);
          showToast("Não foi possível importar os dados locais.");
        });
    });
  }

  /* ------------------------------------------------------------------ *
   * 2. DATAS E QUINZENAS
   *    Todas as operações usam diretamente os componentes "YYYY-MM-DD"
   *    da string, nunca o construtor Date(string), para não sofrer com
   *    deslocamento de fuso horário (bug clássico de "dia -1").
   * ------------------------------------------------------------------ */

  function partesISO(iso) {
    const [ano, mes, dia] = iso.split("-").map(Number);
    return { ano, mes: mes - 1, dia }; // mes: 0-11
  }

  function diasNoMes(ano, mesIndex0) {
    return new Date(ano, mesIndex0 + 1, 0).getDate();
  }

  /** Regra das quinzenas: dia 1–15 = 1ª; dia 16 até o último dia = 2ª. */
  function getQuinzena(iso) {
    const { dia } = partesISO(iso);
    return dia <= 15 ? 1 : 2;
  }

  function formatDateBR(iso) {
    const { ano, mes, dia } = partesISO(iso);
    return `${pad2(dia)}/${pad2(mes + 1)}/${ano}`;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function isoHoje() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  const NOMES_MESES = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];
  const NOMES_MESES_ABREV = [
    "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez",
  ];

  /* ------------------------------------------------------------------ *
   * 3. FORMATAÇÃO NUMÉRICA (PADRÃO BRASILEIRO)
   * ------------------------------------------------------------------ */

  const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const fmtNum2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function formatCurrency(v) {
    return fmtBRL.format(v || 0);
  }

  /** Escapa texto livre (ex.: nome de cidade) antes de inserir em innerHTML,
   *  evitando que caracteres como <, > ou " quebrem o HTML ou permitam
   *  injeção de conteúdo. */
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function formatPercent(v) {
    const n = Number(v) || 0;
    // Sem casas decimais desnecessárias: 10% em vez de 10,00%
    const str = Number.isInteger(n) ? String(n) : fmtNum2.format(n).replace(/0+$/, "").replace(/,$/, "");
    return `${str}%`;
  }

  /** Converte texto digitado pelo usuário (formatos BR variados) em número. */
  function parseNumeroBR(texto) {
    if (texto == null) return NaN;
    let s = String(texto).trim().replace(/[^\d,.\-]/g, "");
    if (s === "") return NaN;
    const temVirgula = s.includes(",");
    const temPonto = s.includes(".");
    if (temVirgula && temPonto) {
      // Ponto = separador de milhar, vírgula = decimal
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (temVirgula) {
      s = s.replace(",", ".");
    }
    // Se só tem ponto, assume que já é o separador decimal (ex.: "10.5")
    return parseFloat(s);
  }

  /* ------------------------------------------------------------------ *
   * 4. FILTROS (estado compartilhado entre Painel e Entregas)
   * ------------------------------------------------------------------ */

  const hoje = new Date();
  const filtro = {
    ano: hoje.getFullYear(),
    mes: hoje.getMonth(), // number 0-11, ou "todos"
    quinzena: "todas", // "todas" | 1 | 2
    cidade: "todas",
  };

  function entregaPassaNoFiltro(e) {
    const { ano, mes } = partesISO(e.data);
    if (filtro.ano !== "todos" && ano !== filtro.ano) return false;
    if (filtro.mes !== "todos" && mes !== filtro.mes) return false;
    if (filtro.quinzena !== "todas" && getQuinzena(e.data) !== Number(filtro.quinzena)) return false;
    if (filtro.cidade !== "todas" && e.cidade !== filtro.cidade) return false;
    return true;
  }

  function listaFiltrada() {
    return entregas.filter(entregaPassaNoFiltro).sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
  }

  function anosDisponiveis() {
    const anos = new Set([hoje.getFullYear(), hoje.getFullYear() + 1, hoje.getFullYear() + 2]);
    entregas.forEach((e) => anos.add(partesISO(e.data).ano));
    return Array.from(anos).sort((a, b) => a - b);
  }

  /** Lista de cidades distintas já cadastradas, para preencher o filtro e
   *  o autocomplete do formulário. Ordenadas alfabeticamente (pt-BR). */
  function cidadesDisponiveis() {
    const cidades = new Set();
    entregas.forEach((e) => {
      if (e.cidade && e.cidade !== "Não informado") cidades.add(e.cidade);
    });
    return Array.from(cidades).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }

  /* ------------------------------------------------------------------ *
   * 5. CÁLCULOS AGREGADOS
   * ------------------------------------------------------------------ */

  function calcularResumo(lista) {
    const r = {
      qtd: lista.length,
      bruto: 0,
      liquido: 0,
      percSoma: 0,
      totalGastos: 0,
      liquidoAposGastos: 0,
      diesel: 0,
      pedagio: 0,
      alimentacao: 0,
      estacionamento: 0,
      outrosGastos: 0,
      ajudante: 0,
      q1: { qtd: 0, bruto: 0, liquido: 0 },
      q2: { qtd: 0, bruto: 0, liquido: 0 },
    };
    lista.forEach((e) => {
      r.bruto += e.bruto;
      r.liquido += e.liquido;
      r.percSoma += e.percentual;
      r.totalGastos += e.totalGastos || 0;
      r.liquidoAposGastos += e.liquidoAposGastos ?? e.liquido;
      r.diesel += e.diesel || 0;
      r.pedagio += e.pedagio || 0;
      r.alimentacao += e.alimentacao || 0;
      r.estacionamento += e.estacionamento || 0;
      r.outrosGastos += e.outrosGastos || 0;
      r.ajudante += e.ajudante || 0;
      const q = getQuinzena(e.data);
      const alvo = q === 1 ? r.q1 : r.q2;
      alvo.qtd += 1;
      alvo.bruto += e.bruto;
      alvo.liquido += e.liquido;
    });
    r.percMedio = r.qtd ? r.percSoma / r.qtd : 0;
    r.mediaLiquida = r.qtd ? r.liquido / r.qtd : 0;
    return r;
  }

  /* ------------------------------------------------------------------ *
   * 6. NAVEGAÇÃO ENTRE TELAS
   * ------------------------------------------------------------------ */

  const views = document.querySelectorAll(".view");
  const navBtns = document.querySelectorAll(".nav-btn");

  function irPara(nome) {
    views.forEach((v) => (v.hidden = v.dataset.view !== nome));
    navBtns.forEach((b) => b.classList.toggle("is-active", b.dataset.target === nome));
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    if (nome === "nova" && document.getElementById("entregaId").value === "") {
      prepararFormularioNovo();
    }
    if (nome === "entregas") renderEntregas();
    if (nome === "historico") renderHistorico();
    if (nome === "config") renderConfig();
  }

  navBtns.forEach((b) => b.addEventListener("click", () => irPara(b.dataset.target)));
  document.getElementById("fabNova").addEventListener("click", () => irPara("nova"));

  /* ------------------------------------------------------------------ *
   * 7. DASHBOARD
   * ------------------------------------------------------------------ */

  const el = (id) => document.getElementById(id);

  function labelPeriodoHeader() {
    const mesTxt = filtro.mes === "todos" ? "TODOS OS MESES" : NOMES_MESES[filtro.mes].toUpperCase();
    const anoTxt = filtro.ano === "todos" ? "TODOS" : filtro.ano;
    return `${mesTxt} / ${anoTxt}`;
  }

  function renderDashboard() {
    const lista = listaFiltrada();
    const r = calcularResumo(lista);

    el("periodoAtual").textContent = labelPeriodoHeader();

    el("kpiLiquido").textContent = formatCurrency(r.liquido);
    el("kpiEntregas").textContent = String(r.qtd);
    el("kpiBruto").textContent = formatCurrency(r.bruto);
    el("kpiPercentual").textContent = formatPercent(r.percMedio);
    el("kpiGastos").textContent = formatCurrency(r.totalGastos);
    el("kpiLiquidoAposGastos").textContent = formatCurrency(r.liquidoAposGastos);

    // Faixas de dias das quinzenas (mostra datas completas se um mês específico
    // estiver selecionado; caso contrário mostra apenas os dias genéricos).
    if (filtro.mes !== "todos" && filtro.ano !== "todos") {
      const ultimoDia = diasNoMes(filtro.ano, filtro.mes);
      el("q1Range").textContent = `01/${pad2(filtro.mes + 1)} a 15/${pad2(filtro.mes + 1)}`;
      el("q2Range").textContent = `16/${pad2(filtro.mes + 1)} a ${ultimoDia}/${pad2(filtro.mes + 1)}`;
    } else {
      el("q1Range").textContent = "Dias 01 a 15";
      el("q2Range").textContent = "Dia 16 ao fim do mês";
    }

    el("q1Count").textContent = String(r.q1.qtd);
    el("q1Bruto").textContent = formatCurrency(r.q1.bruto);
    el("q1Liquido").textContent = formatCurrency(r.q1.liquido);

    el("q2Count").textContent = String(r.q2.qtd);
    el("q2Bruto").textContent = formatCurrency(r.q2.bruto);
    el("q2Liquido").textContent = formatCurrency(r.q2.liquido);

    el("totalCount").textContent = String(r.qtd);
    el("totalBruto").textContent = formatCurrency(r.bruto);
    el("totalLiquido").textContent = formatCurrency(r.liquido);
    el("totalGastos").textContent = formatCurrency(r.totalGastos);
    el("totalLiquidoAposGastos").textContent = formatCurrency(r.liquidoAposGastos);
    el("totalMedia").textContent = formatCurrency(r.mediaLiquida);

    el("gastoDiesel").textContent = formatCurrency(r.diesel);
    el("gastoPedagio").textContent = formatCurrency(r.pedagio);
    el("gastoAlimentacao").textContent = formatCurrency(r.alimentacao);
    el("gastoEstacionamento").textContent = formatCurrency(r.estacionamento);
    el("gastoOutros").textContent = formatCurrency(r.outrosGastos);
    el("gastoAjudante").textContent = formatCurrency(r.ajudante);
    el("gastoTotalDetalhe").textContent = formatCurrency(r.totalGastos);

    renderGraficoDiario(lista);
    renderGraficoQuinzena(r);
  }

  /* --- Gráfico 1: líquido acumulado por dia ------------------------- */

  function renderGraficoDiario(lista) {
    const canvas = el("chartDia");
    const vazio = el("chartDiaEmpty");
    if (!lista.length) {
      canvas.style.display = "none";
      vazio.style.display = "block";
      return;
    }
    canvas.style.display = "block";
    vazio.style.display = "none";

    const porDia = new Map();
    lista.forEach((e) => {
      porDia.set(e.data, (porDia.get(e.data) || 0) + e.liquido);
    });
    const diasOrdenados = Array.from(porDia.keys()).sort();
    const labels = diasOrdenados.map((iso) => {
      const { dia, mes } = partesISO(iso);
      return `${pad2(dia)}/${pad2(mes + 1)}`;
    });
    const valores = diasOrdenados.map((iso) => porDia.get(iso));

    desenharBarras(canvas, labels, valores, { cor: "#F5B700" });
  }

  /* --- Gráfico 2: comparativo de quinzenas --------------------------- */

  function renderGraficoQuinzena(resumo) {
    const canvas = el("chartQuinzena");
    const vazio = el("chartQuinzenaEmpty");
    if (!resumo.qtd) {
      canvas.style.display = "none";
      vazio.style.display = "block";
      return;
    }
    canvas.style.display = "block";
    vazio.style.display = "none";

    desenharBarras(
      canvas,
      ["1ª quinzena", "2ª quinzena"],
      [resumo.q1.liquido, resumo.q2.liquido],
      { cor: ["#34D399", "#F5B700"], horizontalLabelsGrandes: true }
    );
  }

  /** Desenha um gráfico de barras simples em <canvas>, sem dependências externas. */
  function desenharBarras(canvas, labels, valores, opts) {
    opts = opts || {};
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || canvas.parentElement.clientWidth;
    const cssHeight = Number(canvas.getAttribute("height")) || 180;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    canvas.style.height = cssHeight + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const padLeft = 8;
    const padRight = 8;
    const padTop = 18;
    const padBottom = 30;
    const larguraUtil = cssWidth - padLeft - padRight;
    const alturaUtil = cssHeight - padTop - padBottom;

    const max = Math.max(...valores, 1);
    const n = valores.length;
    const gap = Math.min(18, larguraUtil / n * 0.35);
    const barW = Math.max(6, (larguraUtil - gap * (n - 1)) / n);

    // linha de base
    ctx.strokeStyle = "#263140";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, cssHeight - padBottom + 0.5);
    ctx.lineTo(cssWidth - padRight, cssHeight - padBottom + 0.5);
    ctx.stroke();

    const maxLabels = 12;
    const passoLabel = Math.ceil(n / maxLabels);

    valores.forEach((v, i) => {
      const h = max > 0 ? (v / max) * (alturaUtil - 16) : 0;
      const x = padLeft + i * (barW + gap);
      const y = cssHeight - padBottom - h;
      const cor = Array.isArray(opts.cor) ? opts.cor[i % opts.cor.length] : opts.cor || "#F5B700";

      ctx.fillStyle = cor;
      roundRectTop(ctx, x, y, barW, h, 4);
      ctx.fill();

      // valor acima da barra
      if (opts.horizontalLabelsGrandes || n <= 8) {
        ctx.fillStyle = "#F3F6F9";
        ctx.font = "600 11px Inter, sans-serif";
        ctx.textAlign = "center";
        const valTxt = v >= 1000 ? formatCurrency(v).replace("R$", "").trim() : formatCurrency(v);
        ctx.fillText(valTxt, x + barW / 2, y - 6);
      }

      // rótulo abaixo
      if (i % passoLabel === 0) {
        ctx.fillStyle = "#5E6C7B";
        ctx.font = "500 10.5px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(labels[i]), x + barW / 2, cssHeight - padBottom + 16);
      }
    });
  }

  function roundRectTop(ctx, x, y, w, h, r) {
    if (h < r) r = Math.max(1, h);
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  }

  /* ------------------------------------------------------------------ *
   * 8. FILTROS — UI (dois conjuntos de selects sincronizados)
   * ------------------------------------------------------------------ */

  function popularSelectsDeAno() {
    const anos = anosDisponiveis();
    [el("filtroAno"), el("filtroAno2")].forEach((sel) => {
      sel.innerHTML = anos.map((a) => `<option value="${a}">${a}</option>`).join("");
    });
  }

  /** Preenche os selects de filtro de cidade e o datalist do formulário com
   *  as cidades já cadastradas, preservando a cidade selecionada no filtro
   *  se ela ainda existir na lista (senão volta para "Todas"). */
  function popularSelectsDeCidade() {
    const cidades = cidadesDisponiveis();
    const opcoes = `<option value="todas">Todas</option>` +
      cidades.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    [el("filtroCidade"), el("filtroCidade2")].forEach((sel) => {
      sel.innerHTML = opcoes;
    });
    if (filtro.cidade !== "todas" && !cidades.includes(filtro.cidade)) {
      filtro.cidade = "todas";
    }
    el("listaCidadesConhecidas").innerHTML = cidades.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("");
  }

  function sincronizarFiltrosUI() {
    el("filtroAno").value = String(filtro.ano);
    el("filtroAno2").value = String(filtro.ano);
    el("filtroMes").value = String(filtro.mes);
    el("filtroMes2").value = String(filtro.mes);
    el("filtroQuinzena").value = String(filtro.quinzena);
    el("filtroQuinzena2").value = String(filtro.quinzena);
    el("filtroCidade").value = filtro.cidade;
    el("filtroCidade2").value = filtro.cidade;
  }

  function aoMudarFiltro(campo, valorBruto) {
    let valor = valorBruto;
    if (campo === "ano") valor = Number(valor);
    if (campo === "mes") valor = valor === "todos" ? "todos" : Number(valor);
    if (campo === "quinzena") valor = valor === "todas" ? "todas" : Number(valor);
    filtro[campo] = valor;
    sincronizarFiltrosUI();
    renderTudo();
  }

  el("filtroAno").addEventListener("change", (e) => aoMudarFiltro("ano", e.target.value));
  el("filtroAno2").addEventListener("change", (e) => aoMudarFiltro("ano", e.target.value));
  el("filtroMes").addEventListener("change", (e) => aoMudarFiltro("mes", e.target.value));
  el("filtroMes2").addEventListener("change", (e) => aoMudarFiltro("mes", e.target.value));
  el("filtroQuinzena").addEventListener("change", (e) => aoMudarFiltro("quinzena", e.target.value));
  el("filtroQuinzena2").addEventListener("change", (e) => aoMudarFiltro("quinzena", e.target.value));
  el("filtroCidade").addEventListener("change", (e) => aoMudarFiltro("cidade", e.target.value));
  el("filtroCidade2").addEventListener("change", (e) => aoMudarFiltro("cidade", e.target.value));

  /* ------------------------------------------------------------------ *
   * 9. TELA "NOVA ENTREGA" / EDIÇÃO
   * ------------------------------------------------------------------ */

  const form = el("formEntrega");
  const campoData = el("campoData");
  const campoCidade = el("campoCidade");
  const campoBruto = el("campoBruto");
  const campoPercentual = el("campoPercentual");
  const campoLiquido = el("campoLiquido");
  const campoDiesel = el("campoDiesel");
  const campoPedagio = el("campoPedagio");
  const campoAlimentacao = el("campoAlimentacao");
  const campoEstacionamento = el("campoEstacionamento");
  const campoOutrosGastos = el("campoOutrosGastos");
  const campoAjudante = el("campoAjudante");
  const campoId = el("entregaId");

  const camposGasto = [campoDiesel, campoPedagio, campoAlimentacao, campoEstacionamento, campoOutrosGastos, campoAjudante];

  /** Lê um campo monetário opcional: vazio conta como 0 (não é obrigatório
   *  informar todos os gastos). */
  function parseGastoOpcional(campo) {
    if (!campo.value.trim()) return 0;
    const v = parseNumeroBR(campo.value);
    return isNaN(v) || v < 0 ? 0 : v;
  }

  function atualizarResumoGastos() {
    const liquido = parseNumeroBR(campoLiquido.value);
    const totalGastos = camposGasto.reduce((soma, campo) => soma + parseGastoOpcional(campo), 0);
    const liquidoAposGastos = (isNaN(liquido) ? 0 : liquido) - totalGastos;
    el("resumoTotalGastos").textContent = formatCurrency(totalGastos);
    el("resumoLiquidoAposGastos").textContent = formatCurrency(liquidoAposGastos);
  }

  camposGasto.forEach((campo) => campo.addEventListener("input", atualizarResumoGastos));
  campoLiquido.addEventListener("input", atualizarResumoGastos);

  function prepararFormularioNovo() {
    form.reset();
    campoId.value = "";
    campoData.value = isoHoje();
    el("formTitle").textContent = "Nova entrega";
    el("btnCancelarEdicao").hidden = true;
    el("btnSalvarEntrega").textContent = "Salvar entrega";
    atualizarPreviewQuinzena();
    atualizarResumoGastos();
  }

  function prepararFormularioEdicao(entrega) {
    campoId.value = entrega.id;
    campoData.value = entrega.data;
    campoCidade.value = entrega.cidade || "";
    campoBruto.value = fmtNum2.format(entrega.bruto);
    campoPercentual.value = formatPercent(entrega.percentual).replace("%", "");
    campoLiquido.value = fmtNum2.format(entrega.liquido);
    campoDiesel.value = entrega.diesel ? fmtNum2.format(entrega.diesel) : "";
    campoPedagio.value = entrega.pedagio ? fmtNum2.format(entrega.pedagio) : "";
    campoAlimentacao.value = entrega.alimentacao ? fmtNum2.format(entrega.alimentacao) : "";
    campoEstacionamento.value = entrega.estacionamento ? fmtNum2.format(entrega.estacionamento) : "";
    campoOutrosGastos.value = entrega.outrosGastos ? fmtNum2.format(entrega.outrosGastos) : "";
    campoAjudante.value = entrega.ajudante ? fmtNum2.format(entrega.ajudante) : "";
    el("formTitle").textContent = "Editar entrega";
    el("btnCancelarEdicao").hidden = false;
    el("btnSalvarEntrega").textContent = "Salvar alterações";
    atualizarPreviewQuinzena();
    atualizarResumoGastos();
    irPara("nova");
  }

  el("btnCancelarEdicao").addEventListener("click", () => prepararFormularioNovo());

  el("btnHoje").addEventListener("click", () => {
    campoData.value = isoHoje();
    atualizarPreviewQuinzena();
  });

  campoData.addEventListener("change", atualizarPreviewQuinzena);

  function atualizarPreviewQuinzena() {
    const iso = campoData.value;
    const preview = el("quinzenaPreview");
    if (!iso) {
      preview.textContent = "";
      return;
    }
    const q = getQuinzena(iso);
    preview.textContent = `${formatDateBR(iso)} cai na ${q}ª quinzena`;
  }

  el("btnCalcular").addEventListener("click", () => {
    const bruto = parseNumeroBR(campoBruto.value);
    const perc = parseNumeroBR(campoPercentual.value);
    if (isNaN(bruto) || isNaN(perc)) {
      showToast("Informe bruto e percentual para calcular.");
      return;
    }
    const liquido = bruto * (perc / 100);
    campoLiquido.value = fmtNum2.format(liquido);
  });

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();

    const iso = campoData.value;
    const cidade = campoCidade.value.trim();
    const bruto = parseNumeroBR(campoBruto.value);
    const percentual = parseNumeroBR(campoPercentual.value);
    const liquido = parseNumeroBR(campoLiquido.value);

    const idExistente = campoId.value;

    if (!iso) return showToast("Informe a data da entrega.");
    // A cidade só é obrigatória para lançamentos novos — registros antigos
    // sem cidade continuam editáveis normalmente (aparecem como "Não
    // informado" e não precisam ser preenchidos de novo).
    if (!idExistente && !cidade) return showToast("Informe a cidade da entrega.");
    if (isNaN(bruto) || bruto < 0) return showToast("Valor bruto inválido.");
    if (isNaN(percentual) || percentual < 0) return showToast("Percentual inválido.");
    if (isNaN(liquido) || liquido < 0) return showToast("Valor líquido inválido.");

    const diesel = parseGastoOpcional(campoDiesel);
    const pedagio = parseGastoOpcional(campoPedagio);
    const alimentacao = parseGastoOpcional(campoAlimentacao);
    const estacionamento = parseGastoOpcional(campoEstacionamento);
    const outrosGastos = parseGastoOpcional(campoOutrosGastos);
    const ajudante = parseGastoOpcional(campoAjudante);
    const totalGastos = diesel + pedagio + alimentacao + estacionamento + outrosGastos + ajudante;
    const liquidoAposGastos = liquido - totalGastos;

    const dados = {
      data: iso,
      cidade: cidade || "Não informado",
      bruto,
      percentual,
      liquido,
      diesel,
      pedagio,
      alimentacao,
      estacionamento,
      outrosGastos,
      ajudante,
      totalGastos,
      liquidoAposGastos,
    };
    const btn = el("btnSalvarEntrega");
    btn.disabled = true;

    const operacao = idExistente ? dbAtualizar(idExistente, dados) : dbAdicionar(dados);

    operacao
      .then(() => {
        showToast(idExistente ? "Entrega atualizada." : "Entrega registrada.");
        prepararFormularioNovo();
        irPara("entregas");
      })
      .catch((err) => {
        console.error("Falha ao salvar entrega:", err);
        showToast("Não foi possível salvar. Verifique sua conexão.");
      })
      .finally(() => {
        btn.disabled = false;
      });
  });

  /* ------------------------------------------------------------------ *
   * 10. TELA "ENTREGAS" (lista + tabela)
   * ------------------------------------------------------------------ */

  function renderEntregas() {
    const lista = listaFiltrada();
    const r = calcularResumo(lista);

    el("listaEntregasResumo").innerHTML = lista.length
      ? `<strong>${r.qtd}</strong> entrega${r.qtd === 1 ? "" : "s"} · bruto <strong>${formatCurrency(r.bruto)}</strong> · líquido <strong>${formatCurrency(r.liquido)}</strong>`
      : "";

    const corpoTabela = el("tabelaEntregasBody");
    const cardsWrap = el("entregasCards");
    const vazio = el("entregasEmpty");

    if (!lista.length) {
      corpoTabela.innerHTML = "";
      cardsWrap.innerHTML = "";
      vazio.hidden = false;
      return;
    }
    vazio.hidden = true;

    corpoTabela.innerHTML = lista.map(linhaTabela).join("");
    cardsWrap.innerHTML = lista.map(cartaoEntrega).join("");

    corpoTabela.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => iniciarEdicao(btn.dataset.edit))
    );
    corpoTabela.querySelectorAll("[data-del]").forEach((btn) =>
      btn.addEventListener("click", () => confirmarExclusao(btn.dataset.del))
    );
    cardsWrap.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => iniciarEdicao(btn.dataset.edit))
    );
    cardsWrap.querySelectorAll("[data-del]").forEach((btn) =>
      btn.addEventListener("click", () => confirmarExclusao(btn.dataset.del))
    );
  }

  function linhaTabela(e) {
    const q = getQuinzena(e.data);
    return `
      <tr>
        <td>${formatDateBR(e.data)}</td>
        <td>${escapeHtml(e.cidade || "Não informado")}</td>
        <td><span class="tag-quinzena q${q}">${q}ª</span></td>
        <td>${formatCurrency(e.bruto)}</td>
        <td>${formatPercent(e.percentual)}</td>
        <td class="col-liquido">${formatCurrency(e.liquido)}</td>
        <td>${formatCurrency(e.totalGastos || 0)}</td>
        <td class="col-liquido">${formatCurrency(e.liquidoAposGastos ?? e.liquido)}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="act-edit" data-edit="${e.id}">Editar</button>
            <button type="button" class="act-del" data-del="${e.id}">Excluir</button>
          </div>
        </td>
      </tr>`;
  }

  function cartaoEntrega(e) {
    const q = getQuinzena(e.data);
    return `
      <div class="entrega-card">
        <div class="entrega-card-top">
          <span class="entrega-card-date">${formatDateBR(e.data)} · ${escapeHtml(e.cidade || "Não informado")}</span>
          <span class="tag-quinzena q${q}">${q}ª quinzena</span>
        </div>
        <div class="entrega-card-body">
          <div class="entrega-card-field"><span>Bruto</span><strong>${formatCurrency(e.bruto)}</strong></div>
          <div class="entrega-card-field"><span>%</span><strong>${formatPercent(e.percentual)}</strong></div>
          <div class="entrega-card-field liquido"><span>Líquido</span><strong>${formatCurrency(e.liquido)}</strong></div>
          <div class="entrega-card-field"><span>Gastos</span><strong>${formatCurrency(e.totalGastos || 0)}</strong></div>
          <div class="entrega-card-field liquido"><span>Líq. após gastos</span><strong>${formatCurrency(e.liquidoAposGastos ?? e.liquido)}</strong></div>
        </div>
        <div class="entrega-card-actions">
          <button type="button" class="act-edit" data-edit="${e.id}">Editar</button>
          <button type="button" class="act-del" data-del="${e.id}">Excluir</button>
        </div>
      </div>`;
  }

  function iniciarEdicao(id) {
    const entrega = entregas.find((e) => e.id === id);
    if (!entrega) return;
    prepararFormularioEdicao(entrega);
  }

  function confirmarExclusao(id) {
    const entrega = entregas.find((e) => e.id === id);
    if (!entrega) return;
    abrirModal({
      titulo: "Excluir entrega?",
      corpo: `Tem certeza que deseja excluir a entrega de ${formatDateBR(entrega.data)} no valor líquido de ${formatCurrency(entrega.liquido)}? Essa ação não pode ser desfeita.`,
      textoConfirmar: "Excluir",
    }).then((confirmado) => {
      if (!confirmado) return;
      dbExcluir(id)
        .then(() => showToast("Entrega excluída."))
        .catch((err) => {
          console.error("Falha ao excluir entrega:", err);
          showToast("Não foi possível excluir. Verifique sua conexão.");
        });
    });
  }

  /* ------------------------------------------------------------------ *
   * 11. TELA "HISTÓRICO" — agrupado por mês/ano
   * ------------------------------------------------------------------ */

  function renderHistorico() {
    const grupos = new Map(); // chave "YYYY-MM" -> lista

    entregas.forEach((e) => {
      const { ano, mes } = partesISO(e.data);
      const chave = `${ano}-${pad2(mes + 1)}`;
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(e);
    });

    const chavesOrdenadas = Array.from(grupos.keys()).sort().reverse();
    const wrap = el("historicoLista");
    const vazio = el("historicoEmpty");

    if (!chavesOrdenadas.length) {
      wrap.innerHTML = "";
      vazio.hidden = false;
      return;
    }
    vazio.hidden = true;

    wrap.innerHTML = chavesOrdenadas
      .map((chave) => {
        const [ano, mes] = chave.split("-").map(Number);
        const lista = grupos.get(chave);
        const r = calcularResumo(lista);
        return `
          <button type="button" class="historico-item" data-chave="${chave}">
            <div>
              <div class="historico-mes">${NOMES_MESES[mes - 1]} de ${ano}</div>
              <div class="historico-sub">${r.qtd} entrega${r.qtd === 1 ? "" : "s"} · bruto ${formatCurrency(r.bruto)}</div>
            </div>
            <div class="historico-valor">
              <strong>${formatCurrency(r.liquido)}</strong>
              <span>líquido previsto</span>
            </div>
          </button>`;
      })
      .join("");

    wrap.querySelectorAll(".historico-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [ano, mes] = btn.dataset.chave.split("-").map(Number);
        filtro.ano = ano;
        filtro.mes = mes - 1;
        filtro.quinzena = "todas";
        sincronizarFiltrosUI();
        renderTudo();
        irPara("dashboard");
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * 12. TELA "CONFIGURAÇÕES" — exportação, backup, limpeza
   * ------------------------------------------------------------------ */

  function renderConfig() {
    el("storageInfo").textContent =
      `${entregas.length} entrega${entregas.length === 1 ? "" : "s"} sincronizada${entregas.length === 1 ? "" : "s"} na sua conta.`;
    if (currentUser) {
      el("contaNome").textContent = currentUser.displayName || "";
      el("contaEmail").textContent = currentUser.email || "";
      el("contaAvatar").src = currentUser.photoURL || "";
    }
  }

  function baixarArquivo(nome, conteudo, tipo) {
    const blob = new Blob([conteudo], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function gerarCSV(lista) {
    const linhas = [[
      "Data", "Cidade", "Quinzena", "Mês", "Ano",
      "Valor Bruto", "Percentual", "Valor Líquido",
      "Diesel", "Pedágio", "Alimentação", "Estacionamento", "Outros Gastos", "Ajudante",
      "Total de Gastos", "Líquido após Gastos",
    ]];
    lista
      .slice()
      .sort((a, b) => (a.data < b.data ? -1 : 1))
      .forEach((e) => {
        const { ano, mes } = partesISO(e.data);
        linhas.push([
          formatDateBR(e.data),
          e.cidade || "Não informado",
          `${getQuinzena(e.data)}ª`,
          NOMES_MESES[mes],
          String(ano),
          fmtNum2.format(e.bruto),
          fmtNum2.format(e.percentual),
          fmtNum2.format(e.liquido),
          fmtNum2.format(e.diesel || 0),
          fmtNum2.format(e.pedagio || 0),
          fmtNum2.format(e.alimentacao || 0),
          fmtNum2.format(e.estacionamento || 0),
          fmtNum2.format(e.outrosGastos || 0),
          fmtNum2.format(e.ajudante || 0),
          fmtNum2.format(e.totalGastos || 0),
          fmtNum2.format(e.liquidoAposGastos ?? e.liquido),
        ]);
      });
    const csv = linhas.map((l) => l.map(csvEscape).join(";")).join("\r\n");
    return "\uFEFF" + csv; // BOM para acentuação correta no Excel
  }

  function csvEscape(campo) {
    if (/[;"\n]/.test(campo)) return `"${campo.replace(/"/g, '""')}"`;
    return campo;
  }

  el("btnExportCsvTudo").addEventListener("click", () => {
    if (!entregas.length) return showToast("Não há entregas para exportar.");
    baixarArquivo(`frete-na-mao-todas-entregas.csv`, gerarCSV(entregas), "text/csv;charset=utf-8");
    showToast("CSV exportado.");
  });

  el("btnExportCsvFiltro").addEventListener("click", () => {
    const lista = listaFiltrada();
    if (!lista.length) return showToast("Não há entregas no período filtrado.");
    baixarArquivo(`frete-na-mao-periodo-filtrado.csv`, gerarCSV(lista), "text/csv;charset=utf-8");
    showToast("CSV do período exportado.");
  });

  el("btnExportBackup").addEventListener("click", () => {
    const payload = {
      app: "frete-na-mao",
      versao: 2,
      exportadoEm: new Date().toISOString(),
      entregas,
    };
    baixarArquivo(`frete-na-mao-backup.json`, JSON.stringify(payload, null, 2), "application/json");
    showToast("Backup exportado.");
  });

  el("inputImportBackup").addEventListener("change", (ev) => {
    const arquivo = ev.target.files[0];
    if (!arquivo) return;
    const reader = new FileReader();
    reader.onload = () => {
      let dados;
      try {
        dados = JSON.parse(reader.result);
      } catch {
        showToast("Arquivo inválido: não é um JSON legível.");
        return;
      }
      const lista = Array.isArray(dados) ? dados : dados.entregas;
      if (!Array.isArray(lista) || !lista.every(isEntregaValida)) {
        showToast("Arquivo de backup em formato inesperado.");
        return;
      }
      abrirModal({
        titulo: "Importar backup?",
        corpo: `Este arquivo contém ${lista.length} entrega(s). Importar irá SUBSTITUIR todos os dados salvos atualmente na sua conta (${currentUser ? currentUser.email : ""}). Deseja continuar?`,
        textoConfirmar: "Substituir dados",
      }).then((ok) => {
        if (!ok) return;
        dbImportarLista(lista)
          .then(() => showToast("Backup importado com sucesso."))
          .catch((err) => {
            console.error("Falha ao importar backup:", err);
            showToast("Não foi possível importar o backup. Verifique sua conexão.");
          });
      });
    };
    reader.readAsText(arquivo);
    ev.target.value = "";
  });

  el("btnApagarTudo").addEventListener("click", () => {
    if (!entregas.length) return showToast("Não há dados para apagar.");
    abrirModal({
      titulo: "Apagar todos os dados?",
      corpo: "Isso removerá permanentemente todas as entregas salvas na sua conta. Essa ação não pode ser desfeita. Recomendamos exportar um backup antes.",
      textoConfirmar: "Apagar tudo",
    }).then((ok) => {
      if (!ok) return;
      dbExcluirVarios(entregas)
        .then(() => showToast("Todos os dados foram apagados."))
        .catch((err) => {
          console.error("Falha ao apagar dados:", err);
          showToast("Não foi possível apagar. Verifique sua conexão.");
        });
    });
  });

  el("btnLogout").addEventListener("click", () => {
    auth.signOut();
  });

  /* ------------------------------------------------------------------ *
   * 13. MODAL DE CONFIRMAÇÃO (Promise-based, reaproveitável)
   * ------------------------------------------------------------------ */

  const modalOverlay = el("modalOverlay");
  let modalResolver = null;

  function abrirModal({ titulo, corpo, textoConfirmar }) {
    el("modalTitle").textContent = titulo;
    el("modalBody").textContent = corpo;
    el("modalConfirm").textContent = textoConfirmar || "Confirmar";
    modalOverlay.hidden = false;
    return new Promise((resolve) => {
      modalResolver = resolve;
    });
  }

  function fecharModal(resultado) {
    modalOverlay.hidden = true;
    if (modalResolver) {
      modalResolver(resultado);
      modalResolver = null;
    }
  }

  el("modalCancel").addEventListener("click", () => fecharModal(false));
  el("modalConfirm").addEventListener("click", () => fecharModal(true));
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) fecharModal(false);
  });

  /* ------------------------------------------------------------------ *
   * 14. TOAST
   * ------------------------------------------------------------------ */

  let toastTimer = null;
  function showToast(msg) {
    const t = el("toast");
    t.textContent = msg;
    t.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-visible"), 2600);
  }

  /* ------------------------------------------------------------------ *
   * 15. RENDER GERAL + INICIALIZAÇÃO
   * ------------------------------------------------------------------ */

  function renderTudo() {
    popularSelectsDeAno();
    popularSelectsDeCidade();
    sincronizarFiltrosUI();
    renderDashboard();
    // As demais telas são renderizadas sob demanda ao serem abertas,
    // mas mantemos a lista de entregas/histórico atualizados se já visíveis.
    if (!el("view-entregas").hidden) renderEntregas();
    if (!el("view-historico").hidden) renderHistorico();
    if (!el("view-config").hidden) renderConfig();
  }

  /** Coisas que só precisam acontecer uma vez, independente de login. */
  function iniciarUIEstatica() {
    if (uiEstaticaPronta) return;
    uiEstaticaPronta = true;

    // Se o arquivo foi aberto direto do aparelho (file://) em vez de um
    // endereço hospedado (http/https), avisa o usuário: login com Google,
    // Service Worker e "Adicionar à Tela de Início" não funcionam nesse
    // modo em muitos navegadores (especialmente no iPhone).
    if (location.protocol === "file:") {
      const aviso = el("avisoFileProtocol");
      if (aviso) aviso.hidden = false;
    }

    prepararFormularioNovo();

    // Recalcula os gráficos ao redimensionar (ex.: girar o celular).
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!el("view-dashboard").hidden) renderDashboard();
      }, 150);
    });
  }

  /* ------------------------------------------------------------------ *
   * 16. LOGIN COM GOOGLE
   *    Enquanto não há usuário logado, a tela de login fica visível e o
   *    restante do app (#appShell) permanece escondido. Assim que o
   *    Firebase confirma o login, passamos a ouvir só os lançamentos
   *    daquele usuário (query filtrando por uid) em tempo real.
   * ------------------------------------------------------------------ */

  document.getElementById("btnLoginGoogle").addEventListener("click", () => {
    const erroEl = document.getElementById("loginError");
    erroEl.textContent = "";
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch((err) => {
      console.error("Falha no login:", err);
      if (err.code === "auth/popup-blocked" || err.code === "auth/cancelled-popup-request") {
        auth.signInWithRedirect(provider);
      } else if (err.code !== "auth/popup-closed-by-user") {
        erroEl.textContent = "Não foi possível entrar. Tente novamente.";
      }
    });
  });

  auth.onAuthStateChanged((user) => {
    if (user) {
      currentUser = user;
      document.getElementById("loginScreen").hidden = true;
      document.getElementById("appShell").hidden = false;

      iniciarUIEstatica();
      renderDashboard();

      if (unsubscribeSnapshot) unsubscribeSnapshot();
      unsubscribeSnapshot = db
        .collection(COLECAO)
        .where("uid", "==", user.uid)
        .onSnapshot(
          (snap) => {
            entregas = snap.docs.map(docParaEntrega);
            renderTudo();
          },
          (err) => {
            console.error("Erro ao sincronizar dados:", err);
            showToast("Não foi possível sincronizar seus dados agora.");
          }
        );

      verificarMigracaoLocal(user);
    } else {
      currentUser = null;
      entregas = [];
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
      }
      document.getElementById("appShell").hidden = true;
      document.getElementById("loginScreen").hidden = false;
    }
  });

  /* ------------------------------------------------------------------ *
   * 17. PWA — REGISTRO DO SERVICE WORKER (uso offline)
   * ------------------------------------------------------------------ */

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service worker não registrado:", e));
    });
  }
})();
