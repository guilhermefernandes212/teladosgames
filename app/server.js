const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const selfsigned = require('selfsigned');
const localtunnel = require('localtunnel');
const db = require('./db.js');

const { spawn } = require('child_process');
const os = require('os');

let publicTunnelUrl = null;
let cloudflareProcess = null;
let publicDetectedIp = null;

function getLocalIpAddresses() {
  const nets = os.networkInterfaces();
  const list = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        const isVpn = name.toLowerCase().includes('radmin') || name.toLowerCase().includes('hamachi') || name.toLowerCase().includes('vpn');
        const isLan = net.address.startsWith('192.168.') || net.address.startsWith('10.') || (net.address.startsWith('172.') && parseInt(net.address.split('.')[1], 10) >= 16 && parseInt(net.address.split('.')[1], 10) <= 31);
        list.push({
          name,
          ip: net.address,
          isVpn,
          isLan
        });
      }
    }
  }
  return list;
}

async function fetchPublicIp() {
  const apis = ['https://api.ipify.org', 'https://icanhazip.com', 'https://ifconfig.me/ip'];
  for (const url of apis) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const text = (await res.text()).trim();
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(text)) {
          publicDetectedIp = text;
          return text;
        }
      }
    } catch (e) {}
  }
  return null;
}

function setupPublicTunnel(port) {
  // Versão instalada: cloudflared.exe fica ao lado do server.js.
  // No projeto (desenvolvimento): fica em ../vendor/.
  const cloudflaredBin = [
    path.join(__dirname, 'cloudflared.exe'),
    path.join(__dirname, '..', 'vendor', 'cloudflared.exe')
  ].find(p => fs.existsSync(p));

  if (cloudflaredBin) {
    console.log('⚡ Iniciando Cloudflare Tunnel direto (sem senhas e sem telas intermediárias)...');
    try {
      cloudflareProcess = spawn(cloudflaredBin, ['tunnel', '--url', `http://localhost:${port}`]);

      cloudflareProcess.stderr.on('data', (data) => {
        const text = data.toString();
        const match = text.match(/https:\/\/(?!api)[a-z0-9-]+\.trycloudflare\.com/i);
        if (match && !publicTunnelUrl) {
          publicTunnelUrl = match[0];
          console.log('====================================================');
          console.log(`🌐 [LINK DIRETO DO CLOUDFLARE PARA AMIGOS]:`);
          console.log(`   ${publicTunnelUrl}`);
          console.log('====================================================');
        }
      });

      cloudflareProcess.on('error', (err) => {
        console.warn('Aviso no cloudflared:', err.message);
        fallbackLocaltunnel(port);
      });

      cloudflareProcess.on('exit', () => {
        publicTunnelUrl = null;
      });

      return;
    } catch (e) {
      console.warn('Falha ao spawnar cloudflared:', e.message);
    }
  }

  fallbackLocaltunnel(port);
}

async function fallbackLocaltunnel(port) {
  try {
    const tunnel = await localtunnel({ port });
    publicTunnelUrl = tunnel.url;
    console.log(`🌐 [Link Público (Localtunnel)]: ${publicTunnelUrl}`);
  } catch (err) {
    console.log('ℹ️  Acesso remoto não iniciado.');
  }
}

// Limpeza segura ao encerrar processo
process.on('exit', () => {
  if (cloudflareProcess) cloudflareProcess.kill();
});
process.on('SIGINT', () => {
  if (cloudflareProcess) cloudflareProcess.kill();
  process.exit();
});
process.on('SIGTERM', () => {
  if (cloudflareProcess) cloudflareProcess.kill();
  process.exit();
});

const HTTP_PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 8443;
// Na versão instalada, o launcher define DISCORD_STREAM_DATA (pasta gravável do usuário)
const CERT_DIR = path.join(process.env.DISCORD_STREAM_DATA || __dirname, 'certs');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');
// Lista dos IPs incluídos no certificado (o PEM é base64, então os IPs não aparecem em texto puro nele)
const CERT_IPS_FILE = path.join(CERT_DIR, 'cert-ips.json');

if (!fs.existsSync(CERT_DIR)) {
  fs.mkdirSync(CERT_DIR, { recursive: true });
}

async function getOrGenerateCertificates() {
  const localIps = getLocalIpAddresses();
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' }
  ];

  for (const item of localIps) {
    altNames.push({ type: 7, ip: item.ip });
  }

  if (publicDetectedIp) {
    altNames.push({ type: 7, ip: publicDetectedIp });
  }

  if (fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE) && fs.existsSync(CERT_IPS_FILE)) {
    try {
      const certIps = JSON.parse(fs.readFileSync(CERT_IPS_FILE, 'utf8'));
      const existingCert = fs.readFileSync(CERT_FILE, 'utf8');
      const notExpired = new crypto.X509Certificate(existingCert).validToDate > new Date(Date.now() + 24 * 60 * 60 * 1000);
      // Reaproveita o certificado se todos os IPs locais atuais já estão nele (evita novo aviso no navegador)
      const hasAllIps = Array.isArray(certIps) && localIps.every(i => certIps.includes(i.ip));
      if (hasAllIps && notExpired) {
        return {
          cert: existingCert,
          key: fs.readFileSync(KEY_FILE, 'utf8')
        };
      }
    } catch (e) {}
  }

  console.log('🔒 Gerando novos certificados TLS auto-assinados para HTTPS/WSS (incluindo todos os IPs da máquina)...');
  const attrs = [
    { name: 'commonName', value: 'TelaDosGames-Secure' },
    { name: 'countryName', value: 'BR' },
    { name: 'organizationName', value: 'SecureWebRTC' }
  ];

  const pems = await selfsigned.generate(attrs, {
    days: 365,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames
      }
    ]
  });

  fs.writeFileSync(CERT_FILE, pems.cert, 'utf8');
  fs.writeFileSync(KEY_FILE, pems.private, 'utf8');
  const includedIps = altNames.filter(a => a.ip).map(a => a.ip);
  fs.writeFileSync(CERT_IPS_FILE, JSON.stringify(includedIps), 'utf8');
  return { cert: pems.cert, key: pems.private };
}

// Salas ativas em memória (conexoes WebRTC / sockets)
// roomId -> Map(clientId -> { ws, userId, username, displayName, isSharingScreen, isMicMuted })
const activeRooms = new Map();

function sanitizeString(str, maxLen = 60) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen).replace(/[<>]/g, '');
}

// Nomes aparecem dentro de atributos HTML no navegador: remove também aspas e afins
function sanitizeName(str, maxLen = 30) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>"'`&\u0000-\u001f]/g, '').trim().slice(0, maxLen);
}

// Limitador simples por chave (IP, conta, sala...): no máximo `max` eventos a cada `windowMs`
function createLimiter(max, windowMs) {
  const hits = new Map(); // chave -> { count, firstAt }
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now - entry.firstAt > windowMs) hits.delete(key);
    }
  }, windowMs);
  timer.unref();

  return {
    isBlocked(key) {
      const entry = hits.get(key);
      if (!entry) return false;
      if (Date.now() - entry.firstAt > windowMs) {
        hits.delete(key);
        return false;
      }
      return entry.count >= max;
    },
    hit(key) {
      const entry = hits.get(key);
      if (!entry || Date.now() - entry.firstAt > windowMs) {
        hits.set(key, { count: 1, firstAt: Date.now() });
      } else {
        entry.count++;
      }
    },
    reset(key) {
      hits.delete(key);
    },
    stop() {
      clearInterval(timer);
      hits.clear();
    }
  };
}

const MIN = 60 * 1000;
const loginIpLimiter = createLimiter(10, 15 * MIN);        // 10 falhas por IP a cada 15 min
const loginUserLimiter = createLimiter(20, 15 * MIN);      // 20 falhas por conta (ataque vindo de vários IPs)
const registerLimiter = createLimiter(5, 60 * MIN);        // 5 contas novas por IP por hora
const roomPasswordLimiter = createLimiter(10, 15 * MIN);   // 10 senhas de sala erradas por IP e sala
const MAX_WS_PER_IP = 20;                                  // conexões simultâneas por IP
const wsCountByIp = new Map();

function logSecurity(event, details) {
  console.warn(`[SEGURANÇA] ${new Date().toISOString()} ${event} ${JSON.stringify(details)}`);
}

// Requisição feita direto do próprio computador (não via Cloudflare/Localtunnel, que também chegam por 127.0.0.1)
function isLocalRequest(req) {
  const addr = (req.socket && req.socket.remoteAddress) || '';
  const isLoopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  const viaProxy = req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip'] || req.headers['x-forwarded-proto'];
  return isLoopback && !viaProxy;
}

// IP real de quem fez a requisição.
// Os cabeçalhos cf-connecting-ip / x-forwarded-for só são confiáveis quando a conexão chega pelo túnel
// (Cloudflare/Localtunnel rodam nesta máquina e entram por 127.0.0.1). Em conexão direta por IP,
// qualquer um poderia forjar esses cabeçalhos para fugir do limite de tentativas.
function getClientIp(req) {
  const addr = (req.socket && req.socket.remoteAddress) || 'desconhecido';
  const isLoopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  if (isLoopback) {
    const forwarded = req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return String(forwarded).slice(0, 64);
  }
  return addr;
}

// Bloqueia WebSocket aberto por outro site (Cross-Site WebSocket Hijacking)
function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // clientes fora do navegador não mandam Origin
  let url;
  try { url = new URL(origin); } catch (e) { return false; }
  if (url.host === (req.headers.host || '')) return true;
  if (publicTunnelUrl && url.origin === new URL(publicTunnelUrl).origin) return true;
  const h = url.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return true;
  if (publicDetectedIp && h === publicDetectedIp) return true;
  return getLocalIpAddresses().some(i => i.ip === h);
}

async function startServer() {
  await fetchPublicIp();
  const app = express();

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=(), usb=()');
    // Só scripts do próprio app: mesmo que algum texto escape, o navegador não executa código injetado
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self' ws: wss:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; '));
    next();
  });

  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.json({ limit: '64kb' }));

  // Middleware de Autenticação para Rotas da API
  function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Autenticação requerida.' });
    }
    const token = authHeader.split(' ')[1];
    const user = db.getUserBySession(token);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Sessão expirada ou inválida.' });
    }
    req.user = user;
    req.token = token;
    next();
  }

  // ==========================================
  // ROTAS DE AUTENTICAÇÃO (CADASTRO E LOGIN)
  // ==========================================

  app.post('/api/auth/register', (req, res) => {
    const ip = getClientIp(req);
    if (registerLimiter.isBlocked(ip)) {
      logSecurity('cadastro-bloqueado', { ip });
      return res.status(429).json({ success: false, message: 'Muitas contas criadas a partir desta conexão. Tente novamente mais tarde.' });
    }
    try {
      const { username, password, displayName } = req.body || {};
      const result = db.registerUser(username, password, displayName);
      registerLimiter.hit(ip);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    const ip = getClientIp(req);
    const { username, password } = req.body || {};
    const userKey = String(username || '').trim().toLowerCase().slice(0, 32);
    if (loginIpLimiter.isBlocked(ip) || loginUserLimiter.isBlocked(userKey)) {
      logSecurity('login-bloqueado', { ip, username: userKey });
      return res.status(429).json({ success: false, message: 'Muitas tentativas de login. Aguarde 15 minutos e tente novamente.' });
    }
    try {
      const result = db.loginUser(username, password);
      loginIpLimiter.reset(ip);
      loginUserLimiter.reset(userKey);
      res.json({ success: true, ...result });
    } catch (err) {
      loginIpLimiter.hit(ip);
      loginUserLimiter.hit(userKey);
      logSecurity('login-falhou', { ip, username: userKey });
      res.status(400).json({ success: false, message: err.message });
    }
  });

  app.get('/api/auth/me', authMiddleware, (req, res) => {
    const savedRooms = db.getUserSavedRooms(req.user.username);
    res.json({
      success: true,
      user: {
        ...req.user,
        savedRooms
      }
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      db.logoutSession(token);
    }
    res.json({ success: true });
  });

  // ==========================================
  // ROTAS DE GESTÃO DE SALAS E FAVORITOS
  // ==========================================

  app.post('/api/rooms/create', authMiddleware, (req, res) => {
    try {
      const { id, name, password } = req.body || {};
      const existing = db.getRoom(id);
      if (existing && existing.createdBy !== req.user.username) {
        throw new Error('Já existe uma sala com esse ID. Escolha outro ID.');
      }
      const room = db.createRoom(id, name, req.user.username, password);
      res.json({ success: true, room });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  });

  app.get('/api/rooms/my-rooms', authMiddleware, (req, res) => {
    try {
      const rooms = db.getUserSavedRooms(req.user.username);
      // Inclui contagem ao vivo de participantes
      const enriched = rooms.map(r => {
        const active = activeRooms.get(r.id);
        return {
          ...r,
          activeCount: active ? active.size : 0
        };
      });
      res.json({ success: true, rooms: enriched });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  });

  app.post('/api/rooms/save', authMiddleware, (req, res) => {
    try {
      const { roomId } = req.body;
      if (!roomId) throw new Error('ID da sala é obrigatório.');
      db.saveRoomForUser(req.user.username, roomId);
      const rooms = db.getUserSavedRooms(req.user.username);
      res.json({ success: true, savedRooms: rooms });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  });

  app.post('/api/rooms/unsave', authMiddleware, (req, res) => {
    try {
      const { roomId } = req.body;
      if (!roomId) throw new Error('ID da sala é obrigatório.');
      db.unsaveRoomForUser(req.user.username, roomId);
      const rooms = db.getUserSavedRooms(req.user.username);
      res.json({ success: true, savedRooms: rooms });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  });

  app.get('/api/tunnel-info', (req, res) => {
    const localIps = getLocalIpAddresses();
    const lan = localIps.find(i => i.isLan) || localIps[0] || { ip: '127.0.0.1' };
    const vpn = localIps.find(i => i.isVpn);
    // O IP público da sua casa só é mostrado para quem está no próprio computador do servidor
    const showPublicIp = isLocalRequest(req) && publicDetectedIp;

    res.json({
      success: true,
      httpsPort: Number(HTTPS_PORT),
      publicUrl: publicTunnelUrl,
      publicIp: showPublicIp ? publicDetectedIp : null,
      localIp: lan.ip,
      vpnIp: vpn ? vpn.ip : null,
      localUrl: `http://localhost:${HTTP_PORT}`,
      lanHttpUrl: `http://${lan.ip}:${HTTP_PORT}`,
      lanHttpsUrl: `https://${lan.ip}:${HTTPS_PORT}`,
      vpnHttpUrl: vpn ? `http://${vpn.ip}:${HTTP_PORT}` : null,
      vpnHttpsUrl: vpn ? `https://${vpn.ip}:${HTTPS_PORT}` : null,
      publicHttpUrl: showPublicIp ? `http://${publicDetectedIp}:${HTTP_PORT}` : null,
      publicHttpsUrl: showPublicIp ? `https://${publicDetectedIp}:${HTTPS_PORT}` : null,
      interfaces: localIps.map(i => ({
        name: i.name,
        ip: i.ip,
        isLan: i.isLan,
        isVpn: i.isVpn,
        httpUrl: `http://${i.ip}:${HTTP_PORT}`,
        httpsUrl: `https://${i.ip}:${HTTPS_PORT}`
      }))
    });
  });

  app.get('/api/rooms/:id', (req, res) => {
    const room = db.getRoom(req.params.id);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Sala não encontrada.' });
    }
    const active = activeRooms.get(room.id);
    res.json({
      success: true,
      room: {
        ...room,
        activeCount: active ? active.size : 0
      }
    });
  });

  // Servidores HTTP e HTTPS
  // Acesso por http://IP (rede local, VPN, IP público) é redirecionado para https://IP:8443,
  // porque o navegador só libera microfone e transmissão de tela em HTTPS ou localhost.
  // localhost e os túneis (Cloudflare/Localtunnel, que chegam com domínio próprio) não são afetados.
  const httpServer = http.createServer((req, res) => {
    const hostHeader = req.headers.host || '';
    const hostname = hostHeader.replace(/:\d+$/, '');
    const isIpv4Host = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
    if (isIpv4Host && !hostname.startsWith('127.') && !req.headers['x-forwarded-proto']) {
      res.writeHead(307, { Location: `https://${hostname}:${HTTPS_PORT}${req.url || '/'}` });
      return res.end();
    }
    app(req, res);
  });
  const tlsCredentials = await getOrGenerateCertificates();
  const httpsServer = https.createServer({ ...tlsCredentials, minVersion: 'TLSv1.3' }, app);

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  function handleUpgrade(req, socket, head) {
    const pathname = (req.url || '').split('?')[0];
    if (pathname === '/ws') {
      if (!isAllowedOrigin(req)) {
        logSecurity('websocket-origem-recusada', { ip: getClientIp(req), origin: req.headers.origin });
        socket.destroy();
        return;
      }
      const ip = getClientIp(req);
      if ((wsCountByIp.get(ip) || 0) >= MAX_WS_PER_IP) {
        logSecurity('websocket-excesso-conexoes', { ip });
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  }

  httpServer.on('upgrade', handleUpgrade);
  httpsServer.on('upgrade', handleUpgrade);

  // ==========================================
  // WEBSOCKET DE SINALIZAÇÃO P2P MULTI-PEER
  // ==========================================

  wss.on('connection', (ws, req) => {
    const clientId = crypto.randomUUID();
    let currentRoomId = null;
    let currentUser = null;
    let clientDisplayName = 'Convidado';

    const clientIp = getClientIp(req);
    wsCountByIp.set(clientIp, (wsCountByIp.get(clientIp) || 0) + 1);

    // Limites por conexão: mensagens em geral (a sinalização WebRTC manda rajadas), chat e trocas de sala
    const msgLimiter = createLimiter(300, 10 * 1000);
    const chatLimiter = createLimiter(8, 10 * 1000);
    const joinLimiter = createLimiter(20, MIN);
    let floodWarned = false;

    ws.send(JSON.stringify({
      type: 'connection-ready',
      clientId
    }));

    function sendSafe(targetWs, msgObj) {
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify(msgObj));
      }
    }

    function broadcastToRoom(roomId, msgObj, excludeClientId = null) {
      const room = activeRooms.get(roomId);
      if (!room) return;
      for (const [pId, pInfo] of room.entries()) {
        if (pId !== excludeClientId) {
          sendSafe(pInfo.ws, msgObj);
        }
      }
    }

    ws.on('message', (raw) => {
      if (raw.length > 65536) return;

      if (msgLimiter.isBlocked('all')) {
        if (!floodWarned) {
          floodWarned = true;
          logSecurity('websocket-flood', { ip: clientIp, clientId });
        }
        return;
      }
      msgLimiter.hit('all');

      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch (e) {
        return;
      }
      if (!data || typeof data !== 'object') return;

      switch (data.type) {
        // --- 1. ENTRAR EM UMA SALA (MESH P2P) ---
        case 'join-room': {
          const roomId = String(data.roomId || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
          const token = typeof data.token === 'string' ? data.token : null;
          const password = typeof data.password === 'string' ? data.password : '';

          if (!roomId) {
            sendSafe(ws, { type: 'error', message: 'ID da sala inválido.' });
            return;
          }

          if (joinLimiter.isBlocked('all')) {
            sendSafe(ws, { type: 'error', message: 'Você trocou de sala muitas vezes. Aguarde um minuto.' });
            return;
          }
          joinLimiter.hit('all');

          const pwKey = `${clientIp}|${roomId}`;
          if (roomPasswordLimiter.isBlocked(pwKey)) {
            sendSafe(ws, { type: 'error', code: 'bad-password', message: 'Muitas senhas erradas para esta sala. Aguarde 15 minutos.' });
            return;
          }

          // Verifica se o usuário é autenticado via sessão
          let user = null;
          if (token) {
            try {
              user = db.getUserBySession(token);
            } catch (e) {}
          }

          // Verifica ou cria sala com segurança
          let roomDb = null;
          try {
            roomDb = db.getRoom(roomId);
            if (!roomDb) {
              roomDb = db.createRoom(roomId, data.roomName || `Sala ${roomId}`, user ? user.username : 'anonimo', password || null);
            }
          } catch (e) {
            console.warn('Aviso na criação/busca da sala:', e.message);
            roomDb = { id: roomId, name: data.roomName || `Sala ${roomId}`, hasPassword: false };
          }

          // Valida senha se a sala for protegida
          if (roomDb && roomDb.hasPassword) {
            const ok = db.verifyRoomPassword(roomId, password);
            if (!ok) {
              if (password) {
                roomPasswordLimiter.hit(pwKey);
                logSecurity('senha-sala-errada', { ip: clientIp, roomId });
              }
              sendSafe(ws, {
                type: 'error',
                code: 'bad-password',
                message: password ? 'Senha incorreta para esta sala.' : 'Esta sala tem senha. Digite a senha para entrar.'
              });
              return;
            }
          }

          // Já está em uma sala: sai dela antes (evita ficar "fantasma" na sala anterior)
          if (currentRoomId) {
            leaveCurrentRoom();
          }

          // Se o usuário está logado, salva automaticamente a sala para acesso posterior!
          if (user) {
            try {
              db.saveRoomForUser(user.username, roomId);
            } catch (e) {
              console.warn('Não foi possível salvar a sala para o usuário:', e.message);
            }
          }

          currentUser = user;
          currentRoomId = roomId;
          roomPasswordLimiter.reset(pwKey);
          clientDisplayName = user ? user.displayName : (sanitizeName(data.displayName, 30) || 'Convidado');

          if (!activeRooms.has(roomId)) {
            activeRooms.set(roomId, new Map());
          }

          const roomPeers = activeRooms.get(roomId);

          // Coleta lista de pares que já estão na sala antes de registrar o novo
          const existingPeersList = [];
          for (const [pId, pInfo] of roomPeers.entries()) {
            existingPeersList.push({
              clientId: pId,
              displayName: pInfo.displayName,
              username: pInfo.username,
              isSharingScreen: pInfo.isSharingScreen,
              isMicMuted: pInfo.isMicMuted
            });
          }

          // Registra este cliente na sala ativa
          roomPeers.set(clientId, {
            ws,
            clientId,
            username: user ? user.username : 'convidado',
            displayName: clientDisplayName,
            isSharingScreen: false,
            isMicMuted: false,
            joinedAt: new Date()
          });

          // Avisa o cliente que ele entrou na sala com sucesso e lista os participantes já presentes
          sendSafe(ws, {
            type: 'room-joined-success',
            roomId,
            roomName: roomDb.name,
            hasPassword: roomDb.hasPassword,
            existingPeers: existingPeersList
          });

          // Avisa os outros participantes da sala que um novo par entrou (para que iniciem as conexões WebRTC)
          broadcastToRoom(roomId, {
            type: 'peer-joined',
            clientId,
            displayName: clientDisplayName,
            username: user ? user.username : 'convidado',
            totalPeers: roomPeers.size
          }, clientId);

          console.log(`[SALA ${roomId}] ${clientDisplayName} (${clientId}) entrou. Total: ${roomPeers.size}`);
          break;
        }

        // --- 2. SINALIZAÇÃO P2P DIRECIONADA (OFFER / ANSWER / CANDIDATE) ---
        case 'signal': {
          if (!currentRoomId || !activeRooms.has(currentRoomId)) return;
          const roomPeers = activeRooms.get(currentRoomId);
          const targetId = data.targetId;

          if (!targetId || !data.payload) return;

          const targetPeer = roomPeers.get(targetId);
          if (targetPeer) {
            sendSafe(targetPeer.ws, {
              type: 'signal',
              fromId: clientId,
              displayName: clientDisplayName,
              payload: data.payload
            });
          }
          break;
        }

        // --- 3. ATUALIZAÇÃO DE ESTADO DE MÍDIA (TELA, MIC) ---
        case 'media-state': {
          if (!currentRoomId || !activeRooms.has(currentRoomId)) return;
          const roomPeers = activeRooms.get(currentRoomId);
          const myPeer = roomPeers.get(clientId);

          if (myPeer) {
            if (data.isSharingScreen !== undefined) myPeer.isSharingScreen = Boolean(data.isSharingScreen);
            if (data.isMicMuted !== undefined) myPeer.isMicMuted = Boolean(data.isMicMuted);

            broadcastToRoom(currentRoomId, {
              type: 'peer-media-state-changed',
              clientId,
              displayName: clientDisplayName,
              isSharingScreen: myPeer.isSharingScreen,
              isMicMuted: myPeer.isMicMuted
            });
          }
          break;
        }

        // --- 4. CHAT DA SALA ---
        case 'chat-message': {
          if (!currentRoomId || !activeRooms.has(currentRoomId)) return;
          const text = sanitizeString(data.text || '', 280);
          if (!text) return;
          if (chatLimiter.isBlocked('all')) {
            sendSafe(ws, { type: 'error', message: 'Calma! Você está mandando mensagens rápido demais.' });
            return;
          }
          chatLimiter.hit('all');

          broadcastToRoom(currentRoomId, {
            type: 'chat-message',
            senderId: clientId,
            senderName: clientDisplayName,
            text,
            timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          });
          break;
        }
      }
    });

    function leaveCurrentRoom() {
      const roomId = currentRoomId;
      currentRoomId = null;
      if (!roomId || !activeRooms.has(roomId)) return;
      const roomPeers = activeRooms.get(roomId);

      if (roomPeers.has(clientId)) {
        roomPeers.delete(clientId);
        console.log(`[SALA ${roomId}] ${clientDisplayName} saiu. Restantes: ${roomPeers.size}`);

        broadcastToRoom(roomId, {
          type: 'peer-left',
          clientId,
          displayName: clientDisplayName,
          totalPeers: roomPeers.size
        });

        if (roomPeers.size === 0) {
          activeRooms.delete(roomId);
        }
      }
    }

    ws.on('close', () => {
      leaveCurrentRoom();
      msgLimiter.stop();
      chatLimiter.stop();
      joinLimiter.stop();
      const n = (wsCountByIp.get(clientIp) || 1) - 1;
      if (n <= 0) wsCountByIp.delete(clientIp); else wsCountByIp.set(clientIp, n);
    });
  });

  httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`🚀 [HTTP] Servidor rodando em: http://0.0.0.0:${HTTP_PORT}`);
    setupPublicTunnel(HTTP_PORT);
  });

  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`🔒 [HTTPS Seguro] Servidor rodando em: https://0.0.0.0:${HTTPS_PORT}`);

    const localIps = getLocalIpAddresses();
    const lan = localIps.find(i => i.isLan) || localIps[0] || { ip: '127.0.0.1' };
    const vpn = localIps.find(i => i.isVpn);

    console.log('===================================================================');
    console.log('📺 TELADOSGAMES - CONEXÕES VIA IP DISPONÍVEIS:');
    console.log('-------------------------------------------------------------------');
    console.log(`🏠 [IP DO ROTEADOR / REDE LOCAL]:`);
    console.log(`   HTTP:  http://${lan.ip}:${HTTP_PORT}`);
    console.log(`   HTTPS: https://${lan.ip}:${HTTPS_PORT}`);
    if (vpn) {
      console.log('-------------------------------------------------------------------');
      console.log(`🛡️ [IP RADMIN VPN / VPN]:`);
      console.log(`   HTTP:  http://${vpn.ip}:${HTTP_PORT}`);
      console.log(`   HTTPS: https://${vpn.ip}:${HTTPS_PORT}`);
    }
    if (publicDetectedIp) {
      console.log('-------------------------------------------------------------------');
      console.log(`🌐 [IP PÚBLICO (INTERNET)]:`);
      console.log(`   HTTP:  http://${publicDetectedIp}:${HTTP_PORT}`);
      console.log(`   HTTPS: https://${publicDetectedIp}:${HTTPS_PORT}`);
      console.log(`   (Requer portas ${HTTP_PORT} ou ${HTTPS_PORT} redirecionadas no roteador)`);
    }
    console.log('===================================================================');
  });
}

startServer().catch((err) => {
  console.error('Falha fatal ao iniciar o servidor:', err);
  process.exit(1);
});
