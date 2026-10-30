# Leitor NF-e Ambev

Importa o XML da NF-e Ambev, lê o "Preco Unitario Final" de cada item (preço da caixa), cruza com a quantidade de unidades por caixa e calcula o valor por unidade. Gera PDF da tabela.

Site estático (HTML, CSS e JavaScript): o XML é processado no navegador, nada é enviado para servidor.

## Estrutura

```
index.html        página
css/style.css     estilos (tema claro/escuro)
js/produtos.js    cadastro de Qtde CX por código de produto
js/app.js         leitura do XML, tabela e PDF
```

## Cadastrar ou alterar produto

Edite `js/produtos.js` e adicione uma linha `"CÓDIGO_7_DÍGITOS": QTDE,`.

## Publicar no GitHub Pages

1. Envie o repositório para o GitHub (`git push`).
2. No repositório: **Settings → Pages**.
3. Em **Source**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)` e salve.
4. Em alguns minutos o site fica em `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

## Rodar localmente

Abra o `index.html` direto no navegador, ou rode `python -m http.server` na pasta e acesse `http://localhost:8000`.
