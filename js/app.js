"use strict";

const NS = "http://www.portalfiscal.inf.br/nfe";

const $ = (id) => document.getElementById(id);

const el = {
  dropzone: $("dropzone"),
  input: $("inputXml"),
  erro: $("erro"),
  resultado: $("resultado"),
  aviso: $("aviso"),
  tbody: $("tbody"),
  busca: $("busca"),
  semResultado: $("semResultado"),
  btnPdf: $("btnPdf"),
  btnNova: $("btnNova"),
  btnTema: $("btnTema"),
};

let estado = { produtos: [], nf: null, arquivo: "" };

// ─── helpers ────────────────────────────────────────────────────────────────

/** Extrai o valor após 'Preco Unitario Final:' no campo infAdProd. */
function parsePrecoUnitario(texto) {
  if (!texto) return null;
  const match = texto.match(/Preco Unitario Final:([\d,.]+)/);
  if (!match) return null;
  const valor = Number(match[1].replace(/,/g, "."));
  return Number.isFinite(valor) ? valor : null;
}

// padrões de quantidade na descrição, em ordem de confiança:
// "SH C/12", "12X350ML", "CX12" / "PACK 6" / "FD 12", "12UN"
const PADROES_QTDE = [
  /\bC\s*\/\s*(\d+)\b/i,
  /\b(\d+)\s*X\s*\d/i,
  /\b(?:CX|CAIXA|PACK|PCT|FD|FARDO)\s*(\d+)\b/i,
  /\b(\d+)\s*(?:UN|UND|UNID)\b/i,
];

/** Tenta descobrir a qtde por caixa pela descrição do produto. */
function extrairQtdeDescricao(descricao) {
  for (const padrao of PADROES_QTDE) {
    const match = descricao.match(padrao);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > 0 && n <= 200) return n;
    }
  }
  return null;
}

/** Valor por unidade, arredondado para 2 casas (meio para cima). */
function calcularVlrUn(precoCx, qtde) {
  if (precoCx === null || !qtde) return null;
  return Math.round((precoCx / qtde + Number.EPSILON) * 100) / 100;
}

function texto(pai, tag) {
  if (!pai) return null;
  const no = pai.getElementsByTagNameNS(NS, tag)[0];
  return no ? no.textContent.trim() : null;
}

function filho(pai, tag) {
  for (const no of pai.children) {
    if (no.namespaceURI === NS && no.localName === tag) return no;
  }
  return null;
}

/** Extrai produtos do XML e já cruza com o cadastro interno de Qtde CX. */
function extrairDadosXml(xmlTexto) {
  const doc = new DOMParser().parseFromString(xmlTexto, "application/xml");
  const erroParse = doc.getElementsByTagName("parsererror")[0];
  if (erroParse) throw new Error("O arquivo não é um XML válido.");

  const dets = doc.getElementsByTagNameNS(NS, "det");
  if (!dets.length) throw new Error("Nenhum produto encontrado — o arquivo não parece ser uma NF-e.");

  const produtos = Array.from(dets).map((det) => {
    const prod = filho(det, "prod");
    const infAd = filho(det, "infAdProd");

    const cprodRaw = texto(prod, "cProd");
    const cprod = cprodRaw ? cprodRaw.padStart(7, "0") : null;
    const descricao = texto(prod, "xProd") || "";
    const precoCx = parsePrecoUnitario(infAd ? infAd.textContent : "");

    // origem da qtde: "cadastro" | "descricao" | "manual" | null
    let qtde = QTDE_CX[cprod] ?? null;
    let origem = qtde ? "cadastro" : null;
    if (!qtde) {
      qtde = extrairQtdeDescricao(descricao);
      origem = qtde ? "descricao" : null;
    }

    return { codigo: cprod, descricao, precoCx, qtde, origem, vlrUn: calcularVlrUn(precoCx, qtde) };
  });

  const ide = doc.getElementsByTagNameNS(NS, "ide")[0];
  const emit = doc.getElementsByTagNameNS(NS, "emit")[0];
  const nf = {
    numero: texto(ide, "nNF"),
    serie: texto(ide, "serie"),
    emissao: texto(ide, "dhEmi") || texto(ide, "dEmi"),
    emitente: texto(emit, "xNome"),
    cnpj: texto(emit, "CNPJ"),
  };

  return { produtos, nf };
}

const brl4 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const brl2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtMoeda(v, fmt = brl4) {
  return v === null ? "—" : `R$ ${fmt.format(v)}`;
}

const ROTULO_ORIGEM = {
  descricao: { classe: "badge--auto", texto: "pela descrição", dica: "Quantidade lida da descrição do produto — confira" },
  manual: { classe: "badge--manual", texto: "editado", dica: "Quantidade alterada manualmente" },
};

function fmtData(iso) {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR");
}

function fmtCnpj(c) {
  return c && c.length === 14 ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : c;
}

function escapar(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function normalizar(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// ─── UI ─────────────────────────────────────────────────────────────────────

function mostrarErro(msg) {
  el.erro.textContent = `Erro ao ler o XML: ${msg}`;
  el.erro.hidden = false;
  el.resultado.hidden = true;
  el.dropzone.classList.remove("is-compact");
}

function renderTabela() {
  const termo = normalizar(el.busca.value.trim());
  const lista = termo
    ? estado.produtos.filter((p) => normalizar(`${p.codigo} ${p.descricao}`).includes(termo))
    : estado.produtos;

  el.tbody.innerHTML = lista
    .map((p) => {
      const i = estado.produtos.indexOf(p);
      return `
      <tr data-i="${i}">
        <td class="cod">${escapar(p.codigo ?? "—")}</td>
        <td class="desc">${escapar(p.descricao)}</td>
        <td class="num${p.precoCx === null ? " nulo" : ""}">${fmtMoeda(p.precoCx)}</td>
        <td class="num qtde">${celulaQtde(p)}</td>
        <td class="num un${p.vlrUn === null ? " nulo" : ""}">${fmtMoeda(p.vlrUn, brl2)}</td>
      </tr>`;
    })
    .join("");

  el.semResultado.hidden = lista.length > 0;
}

function badgeOrigem(p) {
  const r = ROTULO_ORIGEM[p.origem];
  if (r) return `<span class="badge ${r.classe}" title="${r.dica}">${r.texto}</span>`;
  return p.qtde ? "" : '<span class="badge">sem cadastro</span>';
}

function celulaQtde(p) {
  return `
    <div class="qtde__wrap">
      <span class="qtde__badge">${badgeOrigem(p)}</span>
      <input class="qtde__input${p.qtde ? "" : " is-vazio"}" type="number" inputmode="numeric" min="1" step="1"
        value="${p.qtde ?? ""}" placeholder="—" aria-label="Qtde CX de ${escapar(p.descricao)}">
    </div>`;
}

function renderResumo() {
  const { produtos } = estado;
  const ausentes = produtos.filter((p) => !p.qtde);
  const cadastro = produtos.filter((p) => p.origem === "cadastro").length;
  const auto = produtos.filter((p) => p.qtde && p.origem !== "cadastro");

  $("stTotal").textContent = produtos.length;
  $("stOk").textContent = cadastro;
  $("stAuto").textContent = auto.length;
  $("stAuto").classList.toggle("stat__value--warn", auto.length > 0);
  $("stFalta").textContent = ausentes.length;
  $("stFalta").classList.toggle("stat__value--erro", ausentes.length > 0);

  const linhas = [];
  if (ausentes.length) {
    const codigos = ausentes.map((p) => `<code>${escapar(p.codigo ?? "?")}</code>`).join(" ");
    linhas.push(`<p><strong>${ausentes.length} produto(s) sem Qtde CX</strong> — preencha na tabela para calcular o Vlr Unit UN. Códigos: ${codigos}</p>`);
  }
  const daDescricao = produtos.filter((p) => p.origem === "descricao").length;
  if (daDescricao) {
    linhas.push(`<p><strong>${daDescricao} produto(s) com Qtde CX lida da descrição</strong> — confira antes de usar; dá para corrigir direto na tabela.</p>`);
  }
  el.aviso.innerHTML = linhas.join("");
  el.aviso.hidden = linhas.length === 0;
}

/** Atualiza a qtde de um produto a partir do campo editável, sem redesenhar a tabela. */
function editarQtde(input) {
  const tr = input.closest("tr");
  const p = estado.produtos[Number(tr.dataset.i)];
  const n = parseInt(input.value, 10);

  p.qtde = n > 0 ? n : null;
  const doCadastro = QTDE_CX[p.codigo] ?? null;
  const daDescricao = doCadastro ? null : extrairQtdeDescricao(p.descricao);
  if (!p.qtde) p.origem = null;
  else if (p.qtde === doCadastro) p.origem = "cadastro";
  else if (p.qtde === daDescricao) p.origem = "descricao";
  else p.origem = "manual";
  p.vlrUn = calcularVlrUn(p.precoCx, p.qtde);

  input.classList.toggle("is-vazio", !p.qtde);
  tr.querySelector(".qtde__badge").innerHTML = badgeOrigem(p);
  const un = tr.querySelector(".un");
  un.textContent = fmtMoeda(p.vlrUn, brl2);
  un.classList.toggle("nulo", p.vlrUn === null);
  renderResumo();
}

function renderResultado() {
  const { nf, arquivo } = estado;

  $("nfTitulo").textContent = nf.numero ? `Nº ${nf.numero}${nf.serie ? ` · Série ${nf.serie}` : ""}` : arquivo;
  $("nfEmitente").textContent = [nf.emitente, fmtCnpj(nf.cnpj)].filter(Boolean).join(" · ") || "—";
  $("nfEmissao").textContent = fmtData(nf.emissao);
  $("nfArquivo").textContent = `${arquivo}.xml`;

  renderResumo();
  el.busca.value = "";
  renderTabela();

  el.erro.hidden = true;
  el.resultado.hidden = false;
  el.dropzone.classList.add("is-compact");
  el.dropzone.querySelector(".dropzone__title").textContent = "Importar outra NF-e";
}

async function processarArquivo(arquivo) {
  if (!arquivo) return;
  if (!/\.xml$/i.test(arquivo.name)) {
    mostrarErro("selecione um arquivo .xml.");
    return;
  }
  try {
    const { produtos, nf } = extrairDadosXml(await arquivo.text());
    estado = { produtos, nf, arquivo: arquivo.name.replace(/\.xml$/i, "") };
    renderResultado();
  } catch (e) {
    console.error(e);
    mostrarErro(e.message);
  }
}

// ─── PDF ────────────────────────────────────────────────────────────────────

function gerarPdf() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "cm", format: "a4" });
  const largura = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(`Preços Unitários — NF-e: ${estado.arquivo}`, largura / 2, 1.8, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(128);
  doc.text("Frigorífico Amazonas", largura / 2, 2.4, { align: "center" });

  doc.autoTable({
    startY: 3,
    margin: { left: 1, right: 1, top: 1.5, bottom: 1.5 },
    head: [["Cód. Produto", "Descrição", "Vlr Unit CX (R$)", "Qtde CX", "Vlr Unit UN (R$)"]],
    body: estado.produtos.map((p) => [
      p.codigo ?? "—",
      p.descricao,
      fmtMoeda(p.precoCx),
      p.qtde ?? "—",
      fmtMoeda(p.vlrUn, brl2),
    ]),
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 0.14, valign: "middle", lineColor: [204, 204, 204], lineWidth: 0.014, textColor: 20 },
    headStyles: { fillColor: [26, 58, 92], textColor: 255, fontStyle: "bold", fontSize: 8.5, halign: "center" },
    alternateRowStyles: { fillColor: [238, 243, 248] },
    columnStyles: {
      0: { cellWidth: 2.5, halign: "center" },
      1: { cellWidth: 11, fontSize: 7.5 },
      2: { cellWidth: 4, halign: "right" },
      3: { cellWidth: 2.5, halign: "right" },
      4: { cellWidth: 4, halign: "right" },
    },
    tableWidth: 24,
    horizontalPageBreak: false,
  });

  doc.save(`precos_${estado.arquivo}.pdf`);
}

// ─── eventos ────────────────────────────────────────────────────────────────

el.input.addEventListener("change", () => {
  processarArquivo(el.input.files[0]);
  el.input.value = "";
});

["dragenter", "dragover"].forEach((ev) =>
  el.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    el.dropzone.classList.add("is-over");
  })
);

["dragleave", "drop"].forEach((ev) =>
  el.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    el.dropzone.classList.remove("is-over");
  })
);

el.dropzone.addEventListener("drop", (e) => processarArquivo(e.dataTransfer.files[0]));

// evita que soltar o arquivo fora da área abra o XML no navegador
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

el.busca.addEventListener("input", renderTabela);

el.tbody.addEventListener("input", (e) => {
  if (e.target.classList.contains("qtde__input")) editarQtde(e.target);
});

// Enter no campo de qtde pula para a próxima linha
el.tbody.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !e.target.classList.contains("qtde__input")) return;
  e.preventDefault();
  const proxima = e.target.closest("tr").nextElementSibling;
  if (proxima) proxima.querySelector(".qtde__input").select();
  else e.target.blur();
});

el.btnPdf.addEventListener("click", () => {
  try {
    gerarPdf();
  } catch (e) {
    console.error(e);
    el.erro.textContent = `Não foi possível gerar o PDF: ${e.message}`;
    el.erro.hidden = false;
  }
});

el.btnNova.addEventListener("click", () => el.input.click());

el.btnTema.addEventListener("click", () => {
  const atual =
    document.documentElement.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const novo = atual === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = novo;
  try {
    localStorage.setItem("tema", novo);
  } catch (e) {}
});
