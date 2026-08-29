# Site público para GitHub Pages

Esta pasta contém somente a interface pública do site. Nenhum nome, capítulo, carta ou fotografia privada está gravado no HTML ou no JavaScript.

## Antes de publicar

1. Configure primeiro o projeto Supabase usando o pacote privado separado.
2. Abra `config.js`.
3. Substitua `SUPABASE_URL` pela URL do projeto.
4. Substitua `SUPABASE_PUBLISHABLE_KEY` pela chave publicável, normalmente iniciada por `sb_publishable_`.
5. Nunca use uma chave `sb_secret_`, `service_role` ou qualquer segredo nesse arquivo.

## Publicar no GitHub Pages

Envie apenas os arquivos desta pasta para a raiz do repositório:

- `.nojekyll`
- `index.html`
- `styles.css`
- `app.js`
- `config.js`
- `favicon.svg`
- `robots.txt`

Nas configurações do repositório, habilite o GitHub Pages a partir da branch `main` e da pasta raiz `/`.

## Privacidade

O GitHub Pages hospeda arquivos estáticos públicos. A proteção real do conteúdo é feita pelo Supabase Auth, pelas políticas RLS e pelo armazenamento privado. O site público não contém os textos nem as fotos. O painel gera links temporários de convite e redefinição para o administrador compartilhar diretamente.

Uma pessoa autorizada que visualiza o conteúdo ainda pode fazer captura de tela, copiar texto ou salvar uma imagem exibida. Nenhum site consegue impedir totalmente essas ações de um usuário autorizado.


## Convites e e-mail

A opção padrão do painel é **Gerar link para compartilhar**, que não depende de SMTP. Copie o link e envie somente à pessoa autorizada. A opção **Enviar por e-mail** e o botão público **Esqueci minha senha** dependem da configuração de SMTP do Supabase para funcionar com endereços externos.
