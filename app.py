import streamlit as st
import pandas as pd
import xml.etree.ElementTree as ET
import re
import io
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.lib.enums import TA_CENTER, TA_LEFT

st.set_page_config(page_title="Leitor NF-e Ambev", page_icon="📦", layout="wide")

st.title("📦 Leitor de NF-e — AMBEV 🍾")
st.caption("Importe o XML da NF-e para calcular os preços unitários por unidade.")

# ─── cadastro de produtos (Qtde CX embutida) ────────────────────────────────

_PRODUTOS_RAW = [
    {"codigo": "0022106", "qtde_cx": 10},
    {"codigo": "0020498", "qtde_cx": 12},
    {"codigo": "0011556", "qtde_cx": 6},
    {"codigo": "0000503", "qtde_cx": 6},
    {"codigo": "0009274", "qtde_cx": 12},
    {"codigo": "0019231", "qtde_cx": 4},
    {"codigo": "0019668", "qtde_cx": 12},
    {"codigo": "0029534", "qtde_cx": 6},
    {"codigo": "0009276", "qtde_cx": 6},
    {"codigo": "0019229", "qtde_cx": 6},
    {"codigo": "0014340", "qtde_cx": 12},
    {"codigo": "0002353", "qtde_cx": 6},
    {"codigo": "0001898", "qtde_cx": 15},
    {"codigo": "0007703", "qtde_cx": 6},
    {"codigo": "0029143", "qtde_cx": 6},
    {"codigo": "0021658", "qtde_cx": 12},
    {"codigo": "0000504", "qtde_cx": 6},
    {"codigo": "0017163", "qtde_cx": 6},
    {"codigo": "0018836", "qtde_cx": 24},
    {"codigo": "0009096", "qtde_cx": 12},
    {"codigo": "0027866", "qtde_cx": 26},
    {"codigo": "0032067", "qtde_cx": 6},
    {"codigo": "0020651", "qtde_cx": 8},
    {"codigo": "0007982", "qtde_cx": 6},
    {"codigo": "0002357", "qtde_cx": 6},
    {"codigo": "0007977", "qtde_cx": 6},
    {"codigo": "0009085", "qtde_cx": 12},
    {"codigo": "0000253", "qtde_cx": 6},
    {"codigo": "0002350", "qtde_cx": 6},
    {"codigo": "0030942", "qtde_cx": 24},
    {"codigo": "0009087", "qtde_cx": 12},
    {"codigo": "0021666", "qtde_cx": 4},
    {"codigo": "0002349", "qtde_cx": 6},
    {"codigo": "0002132", "qtde_cx": 6},
    {"codigo": "0018807", "qtde_cx": 24},
    {"codigo": "0022180", "qtde_cx": 24},
    {"codigo": "0021946", "qtde_cx": 15},
    {"codigo": "0029580", "qtde_cx": 24},
    {"codigo": "0009091", "qtde_cx": 12},
    {"codigo": "0019225", "qtde_cx": 24},
    {"codigo": "0009084", "qtde_cx": 12},
    {"codigo": "0021020", "qtde_cx": 12},
    {"codigo": "0032500", "qtde_cx": 8},
    {"codigo": "0009089", "qtde_cx": 12},
    {"codigo": "0007983", "qtde_cx": 6},
    {"codigo": "0001699", "qtde_cx": 6},
    {"codigo": "0010389", "qtde_cx": 12},
    {"codigo": "0007981", "qtde_cx": 6},
    {"codigo": "0021668", "qtde_cx": 12},
    {"codigo": "0020535", "qtde_cx": 12},
    {"codigo": "0021781", "qtde_cx": 24},
    {"codigo": "0013566", "qtde_cx": 8},
    {"codigo": "0020647", "qtde_cx": 15},
    {"codigo": "0019266", "qtde_cx": 15},
    {"codigo": "0013839", "qtde_cx": 8},
    {"codigo": "0034263", "qtde_cx": 8},
    {"codigo": "0019729", "qtde_cx": 8},
    {"codigo": "0024168", "qtde_cx": 24},
    {"codigo": "0018780", "qtde_cx": 24},
    {"codigo": "0032498", "qtde_cx": 8},
    {"codigo": "0032392", "qtde_cx": 8},
    {"codigo": "0017808", "qtde_cx": 24},
    {"codigo": "0026204", "qtde_cx": 8},
    {"codigo": "0004262", "qtde_cx": 8},
    {"codigo": "0023271", "qtde_cx": 24},
    {"codigo": "0021791", "qtde_cx": 1},
]

# dict de lookup: código (str, 7 dígitos) → qtde_cx (int)
QTDE_CX: dict[str, int] = {p["codigo"]: p["qtde_cx"] for p in _PRODUTOS_RAW}

# ─── helpers ────────────────────────────────────────────────────────────────


def parse_preco_unitario(texto: str) -> float | None:
    """Extrai o valor após 'Preco Unitario Final:' no campo infAdProd."""
    if not texto:
        return None
    match = re.search(r"Preco Unitario Final:([\d,\.]+)", texto)
    if match:
        valor_str = match.group(1).replace(",", ".")
        try:
            return float(valor_str)
        except ValueError:
            return None
    return None


def extract_xml_data(xml_bytes: bytes) -> pd.DataFrame:
    """Extrai produtos do XML e já cruza com o cadastro interno de Qtde CX."""
    root = ET.fromstring(xml_bytes)
    rows = []

    for det in root.iter("{http://www.portalfiscal.inf.br/nfe}det"):
        prod = det.find("{http://www.portalfiscal.inf.br/nfe}prod")
        infAdProd_el = det.find("{http://www.portalfiscal.inf.br/nfe}infAdProd")

        cprod_raw = prod.findtext("{http://www.portalfiscal.inf.br/nfe}cProd") if prod is not None else None
        xprod = prod.findtext("{http://www.portalfiscal.inf.br/nfe}xProd") if prod is not None else None
        infad = infAdProd_el.text if infAdProd_el is not None else ""
        preco_cx = parse_preco_unitario(infad)

        cprod = str(cprod_raw).strip().zfill(7) if cprod_raw else None
        qtde = QTDE_CX.get(cprod)  # None se não cadastrado
        vlr_un = round(preco_cx / qtde, 4) if (preco_cx is not None and qtde) else None

        rows.append({
            "Código do Produto": cprod,
            "Descrição": xprod,
            "Vlr Unit CX (R$)": preco_cx,
            "Qtde CX": qtde,
            "Vlr Unit UN (R$)": vlr_un,
        })

    return pd.DataFrame(rows)


def generate_pdf(df: pd.DataFrame, nf_name: str) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=1 * cm,
        leftMargin=1 * cm,
        topMargin=1.5 * cm,
        bottomMargin=1.5 * cm,
    )
    styles = getSampleStyleSheet()
    story = []

    # título
    title_style = ParagraphStyle("title", parent=styles["Title"], fontSize=14, alignment=TA_CENTER, spaceAfter=4)
    story.append(Paragraph(f"Preços Unitários — NF-e: {nf_name}", title_style))
    story.append(Paragraph("Frigorífico Amazonas", ParagraphStyle("sub", parent=styles["Normal"], fontSize=9, alignment=TA_CENTER, textColor=colors.grey, spaceAfter=14)))
    story.append(Spacer(1, 0.3 * cm))

    # cabeçalho
    header = ["Cód. Produto", "Descrição", "Vlr Unit CX (R$)", "Qtde CX", "Vlr Unit UN (R$)"]

    def fmt(val):
        if val is None or (isinstance(val, float) and pd.isna(val)):
            return "—"
        if isinstance(val, float):
            return f"R$ {val:,.4f}".replace(",", "X").replace(".", ",").replace("X", ".")
        return str(val)

    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=7.5, leading=10)
    data = [header]
    for _, row in df.iterrows():
        data.append([
            row["Código do Produto"],
            Paragraph(str(row["Descrição"] or ""), small),
            fmt(row["Vlr Unit CX (R$)"]),
            str(int(row["Qtde CX"])) if pd.notna(row["Qtde CX"]) else "—",
            fmt(row["Vlr Unit UN (R$)"]),
        ])

    col_widths = [2.5 * cm, 11 * cm, 4 * cm, 2.5 * cm, 4 * cm]
    table = Table(data, colWidths=col_widths, repeatRows=1)
    table.setStyle(
        TableStyle([
            # cabeçalho
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a3a5c")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 8.5),
            ("ALIGN", (0, 0), (-1, 0), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            # corpo
            ("FONTSIZE", (0, 1), (-1, -1), 8),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#eef3f8")]),
            ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
            ("ALIGN", (0, 1), (0, -1), "CENTER"),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cccccc")),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ])
    )
    story.append(table)
    doc.build(story)
    return buffer.getvalue()


# ─── UI ─────────────────────────────────────────────────────────────────────

xml_file = st.file_uploader("📄 Importar XML da NF-e", type=["xml"], help="Arquivo XML da nota fiscal Ambev")

if xml_file:
    with st.spinner("Processando..."):
        try:
            df_final = extract_xml_data(xml_file.read())

            sem_qtde = df_final["Qtde CX"].isna().sum()
            if sem_qtde:
                codigos_ausentes = df_final.loc[df_final["Qtde CX"].isna(), "Código do Produto"].tolist()
                st.warning(
                    f"⚠️ {sem_qtde} produto(s) sem Qtde CX cadastrada — Vlr Unit UN ficará em branco. "
                    f"Códigos: {', '.join(codigos_ausentes)}"
                )

            st.success(f"✅ {len(df_final)} produtos extraídos da NF-e.")
            st.subheader("📋 Tabela de Preços Unitários")

            display = df_final.copy()
            for col in ["Vlr Unit CX (R$)", "Vlr Unit UN (R$)"]:
                display[col] = display[col].apply(
                    lambda x: f"R$ {x:,.4f}".replace(",", "X").replace(".", ",").replace("X", ".") if pd.notna(x) else "—"
                )
            display["Qtde CX"] = display["Qtde CX"].apply(lambda x: int(x) if pd.notna(x) else "—")

            st.dataframe(display, use_container_width=True, hide_index=True)

            pdf_bytes = generate_pdf(df_final, xml_file.name.replace(".xml", ""))

            st.download_button(
                label="⬇️ Baixar PDF",
                data=pdf_bytes,
                file_name=f"precos_{xml_file.name.replace('.xml', '')}.pdf",
                mime="application/pdf",
                use_container_width=True,
            )

        except ET.ParseError as e:
            st.error(f"❌ Erro ao ler o XML: {e}")
        except Exception as e:
            st.error(f"❌ Erro inesperado: {e}")
            st.exception(e)

else:
    st.info("👆 Importe o XML da NF-e para começar.")