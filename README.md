# 📺 TelaDosGames

App para Windows em que você e os amigos transmitem a tela ao mesmo tempo e conversam por voz, numa sala só. Dá para conectar pela rede local (Wi-Fi), por VPN (Radmin, Hamachi), por IP público ou por um link do Cloudflare gerado na hora.

---

## Estrutura das pastas

```
TelaDosGames/
├── app/                      Servidor e página do app (o que roda de verdade)
│   ├── server.js             Servidor HTTP/HTTPS, WebSocket de sinalização, túnel
│   ├── db.js                 Contas, sessões e salas (salvas em data/db.json)
│   ├── package.json          Dependências do Node
│   ├── public/               Página que abre no navegador
│   │   ├── index.html
│   │   ├── css/style.css     Visual gamer do app
│   │   ├── fonts/            Fonte Chakra Petch (local, funciona offline)
│   │   └── js/               app.js, webrtc-streamer.js, crypto-helper.js
│   ├── node_modules/         (gerado pelo npm install)
│   ├── data/                 (gerado) contas de teste do modo desenvolvimento
│   └── certs/                (gerado) certificado HTTPS de teste
│
├── launcher/
│   └── TelaDosGames.cs              Central do Windows (TelaDosGames.exe): inicia o servidor e mostra os IPs
│
├── vendor/
│   └── cloudflared.exe       Programa da Cloudflare que cria o link público
│
├── installer/
│   ├── build-installer.ps1   Gera o instalador e o .zip portátil
│   └── TelaDosGames.iss             Configuração do instalador (Inno Setup 6)
│
├── site/                     Site de download (publicar no Netlify)
│   ├── index.html
│   ├── favicon.svg
│   ├── netlify.toml
│   └── downloads/            (gerado) cópia do instalador e do .zip
│
├── dist/                     (gerado) TelaDosGames-Setup-1.0.0.exe e TelaDosGames-Portatil.zip
├── _antigo/                  Arquivos da época "Discord Stream" (pode apagar quando quiser)
│
├── Rodar-em-desenvolvimento.bat
├── .gitignore
└── README.md
```

As pastas marcadas como **(gerado)** são recriadas sozinhas e não precisam de backup.

---

## Rodar durante o desenvolvimento

Dê dois cliques em **`Rodar-em-desenvolvimento.bat`**. Na primeira vez ele instala as dependências; depois abra **http://localhost:3000** no navegador.

Ou pelo terminal:

```powershell
cd app
npm install     # só na primeira vez
npm start
```

No modo desenvolvimento as contas ficam em `app/data/` e o certificado em `app/certs/`. Na versão instalada elas ficam em `%LOCALAPPDATA%\DiscordStream\` (o nome antigo da pasta foi mantido para não perder as contas de quem já usava).

---

## Gerar o instalador

Precisa de: Node.js, Inno Setup 6 (`winget install JRSoftware.InnoSetup`) e `npm install` feito dentro de `app/`.

```powershell
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
```

Ele gera em `dist/`:

- **`TelaDosGames-Setup-1.0.0.exe`**: instalador (não pede administrador)
- **`TelaDosGames-Portatil.zip`**: versão sem instalação (extrair e abrir o `TelaDosGames.exe`)

e já copia os dois para `site/downloads/`.

> ⚠️ O instalador não tem assinatura digital. Em PCs com o **Smart App Control** ligado ele é bloqueado sem aviso; a versão portátil funciona normalmente.

---

## Publicar o site

Arraste a pasta **`site/`** em <https://app.netlify.com/drop> (ou use o Netlify CLI). Rode o build antes, para `site/downloads/` estar atualizado.

---

## Modos de conexão

| Modo | Para quem | Observação |
|---|---|---|
| 🏠 IP do roteador | Mesma casa / Wi-Fi | Menor atraso, não gasta internet |
| 🛡️ IP da VPN | Radmin VPN / Hamachi | Direto entre cidades, sem abrir portas |
| ⚡ Link Cloudflare | Qualquer um pela internet | Mais fácil: 1 clique |
| 🌐 IP público | Quem abre portas no roteador | Portas 3000 (HTTP) e 8443 (HTTPS) |

## Segurança (resumo)

- Senhas de conta e de sala com **Argon2id**; tokens de sessão guardados só como hash.
- Limite de tentativas de login, cadastro, senha de sala, chat e conexões.
- HTTPS com **TLS 1.3**, CSP restritivo e bloqueio de WebSocket vindo de outros sites.
- Vídeo e voz via WebRTC (sempre criptografados). O chat passa pelo computador de quem abriu a sala, então **não** é ponta a ponta.
