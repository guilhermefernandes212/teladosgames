const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Na versão instalada, o launcher define DISCORD_STREAM_DATA (pasta gravável do usuário)
const DATA_ROOT = process.env.DISCORD_STREAM_DATA || __dirname;
const DB_DIR = path.join(DATA_ROOT, 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');
fs.mkdirSync(DB_DIR, { recursive: true });

// Memory cache of DB
let dbData = {
  users: {},
  rooms: {},
  sessions: {}
};

function initDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf8');
      dbData = JSON.parse(content);
      if (!dbData.users) dbData.users = {};
      if (!dbData.rooms) dbData.rooms = {};
      if (!dbData.sessions) dbData.sessions = {};
      migrateSessions();
      purgeExpiredSessions();
    } else {
      dbData.sessionsVersion = 2;
      saveDb();
    }
  } catch (err) {
    console.error('Erro ao carregar banco de dados:', err);
    saveDb();
  }
}

// Os tokens de sessão ficam guardados só como hash SHA-256: quem copiar o db.json não consegue usá-los
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Bancos antigos guardavam o token puro como chave; converte para hash sem deslogar ninguém
function migrateSessions() {
  if (dbData.sessionsVersion === 2) return;
  const migrated = {};
  for (const [token, session] of Object.entries(dbData.sessions)) {
    migrated[hashToken(token)] = session;
  }
  dbData.sessions = migrated;
  dbData.sessionsVersion = 2;
  saveDb();
}

function purgeExpiredSessions() {
  const now = Date.now();
  let changed = false;
  for (const [key, session] of Object.entries(dbData.sessions)) {
    if (!session || now > session.expiresAt) {
      delete dbData.sessions[key];
      changed = true;
    }
  }
  if (changed) saveDb();
}

function saveDb() {
  try {
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(dbData, null, 2), 'utf8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error('Erro ao salvar banco de dados:', err);
  }
}

// Senhas: Argon2id com os parâmetros mínimos recomendados pela OWASP (19 MiB, 2 passadas, 1 thread).
// Hashes antigos (PBKDF2) continuam válidos e são convertidos para Argon2id no próximo login.
const PASSWORD_ALGO = 'argon2id';
const ARGON2_PARAMS = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };

function argon2idHash(password, saltBuffer) {
  return crypto.argon2Sync('argon2id', {
    message: Buffer.from(String(password), 'utf8'),
    nonce: saltBuffer,
    ...ARGON2_PARAMS
  });
}

// Retorna { hash, salt, algo } prontos para guardar
function hashPassword(password) {
  const saltBuffer = crypto.randomBytes(16);
  return {
    hash: argon2idHash(password, saltBuffer).toString('hex'),
    salt: saltBuffer.toString('hex'),
    algo: PASSWORD_ALGO
  };
}

function verifyPassword(password, saltHex, storedHashHex, algo) {
  try {
    const saltBuffer = Buffer.from(saltHex, 'hex');
    const storedHash = Buffer.from(storedHashHex, 'hex');
    const computedHash = algo === PASSWORD_ALGO
      ? argon2idHash(password, saltBuffer)
      : crypto.pbkdf2Sync(String(password), saltBuffer, 100000, 32, 'sha256');
    return computedHash.length === storedHash.length && crypto.timingSafeEqual(computedHash, storedHash);
  } catch (err) {
    return false;
  }
}

// Mesmo custo de verificação para usuário inexistente, para não revelar quais contas existem pelo tempo de resposta
const DUMMY_PASSWORD = hashPassword(crypto.randomBytes(16).toString('hex'));

// Remove caracteres que poderiam virar HTML ou atributo na página
function cleanText(str, maxLen) {
  return String(str || '').replace(/[<>"'`&\u0000-\u001f]/g, '').trim().slice(0, maxLen);
}

// ==========================================
// AUTENTICAÇÃO E USUÁRIOS
// ==========================================

function registerUser(username, password, displayName = '') {
  const cleanUsername = (username || '').trim().toLowerCase();
  if (!cleanUsername || cleanUsername.length < 3 || cleanUsername.length > 24) {
    throw new Error('O nome de usuário deve ter entre 3 e 24 caracteres.');
  }

  if (!/^[a-z0-9_-]+$/.test(cleanUsername)) {
    throw new Error('O nome de usuário só pode conter letras, números, hífens e sublinhados.');
  }

  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('A senha deve conter no mínimo 8 caracteres.');
  }
  if (password.length > 128) {
    throw new Error('A senha pode ter no máximo 128 caracteres.');
  }

  if (dbData.users[cleanUsername]) {
    throw new Error('Este nome de usuário já está em uso.');
  }

  const pw = hashPassword(password);
  const userId = 'usr_' + crypto.randomUUID();

  const newUser = {
    id: userId,
    username: cleanUsername,
    displayName: cleanText(displayName, 32) || cleanUsername,
    passwordHash: pw.hash,
    salt: pw.salt,
    pwAlgo: pw.algo,
    savedRooms: [],
    createdAt: new Date().toISOString()
  };

  dbData.users[cleanUsername] = newUser;
  saveDb();

  // Gera sessão inicial
  const token = createSession(cleanUsername, userId);
  return {
    token,
    user: sanitizeUser(newUser)
  };
}

function loginUser(username, password) {
  const cleanUsername = (username || '').trim().toLowerCase();
  const user = dbData.users[cleanUsername];

  if (typeof password !== 'string' || password.length > 128) {
    throw new Error('Nome de usuário ou senha incorretos.');
  }

  if (!user) {
    verifyPassword(password, DUMMY_PASSWORD.salt, DUMMY_PASSWORD.hash, DUMMY_PASSWORD.algo);
    throw new Error('Nome de usuário ou senha incorretos.');
  }

  if (!verifyPassword(password, user.salt, user.passwordHash, user.pwAlgo)) {
    throw new Error('Nome de usuário ou senha incorretos.');
  }

  // Conta antiga com PBKDF2: aproveita a senha correta para converter para Argon2id
  if (user.pwAlgo !== PASSWORD_ALGO) {
    const pw = hashPassword(password);
    user.passwordHash = pw.hash;
    user.salt = pw.salt;
    user.pwAlgo = pw.algo;
    saveDb();
  }

  const token = createSession(cleanUsername, user.id);
  return {
    token,
    user: sanitizeUser(user)
  };
}

function createSession(username, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 dias

  dbData.sessions[hashToken(token)] = {
    userId,
    username,
    createdAt: Date.now(),
    expiresAt
  };

  saveDb();
  return token;
}

function getUserBySession(token) {
  if (!token || typeof token !== 'string') return null;
  const key = hashToken(token);
  const session = dbData.sessions[key];
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    delete dbData.sessions[key];
    saveDb();
    return null;
  }

  const user = dbData.users[session.username];
  return user ? sanitizeUser(user) : null;
}

function logoutSession(token) {
  if (!token || typeof token !== 'string') return;
  const key = hashToken(token);
  if (dbData.sessions[key]) {
    delete dbData.sessions[key];
    saveDb();
  }
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: cleanText(user.displayName, 32) || user.username,
    savedRooms: user.savedRooms || [],
    createdAt: user.createdAt
  };
}

// ==========================================
// GESTÃO DE SALAS E FAVORITOS
// ==========================================

function createRoom(id, name, createdBy, password = null) {
  const cleanId = (id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!cleanId || cleanId.length < 2 || cleanId.length > 32) {
    throw new Error('ID da sala deve ter entre 2 e 32 caracteres (letras, números e hífens).');
  }

  // Se a sala já existe, retorna a sala existente com segurança
  if (dbData.rooms[cleanId]) {
    return sanitizeRoom(dbData.rooms[cleanId]);
  }

  let pw = null;
  if (password && typeof password === 'string' && password.trim().length > 0) {
    if (password.length > 128) throw new Error('A senha da sala pode ter no máximo 128 caracteres.');
    pw = hashPassword(password.trim());
  }

  const newRoom = {
    id: cleanId,
    name: cleanText(name, 50) || cleanId,
    createdBy,
    passwordHash: pw ? pw.hash : null,
    salt: pw ? pw.salt : null,
    pwAlgo: pw ? pw.algo : undefined,
    isLocked: false,
    createdAt: new Date().toISOString()
  };

  dbData.rooms[cleanId] = newRoom;

  // Adiciona automaticamente a sala criada às salas salvas do criador
  if (createdBy && dbData.users[createdBy]) {
    if (!dbData.users[createdBy].savedRooms) {
      dbData.users[createdBy].savedRooms = [];
    }
    if (!dbData.users[createdBy].savedRooms.includes(cleanId)) {
      dbData.users[createdBy].savedRooms.push(cleanId);
    }
  }

  saveDb();
  return sanitizeRoom(newRoom);
}

function getRoom(id) {
  const cleanId = (id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const room = dbData.rooms[cleanId];
  return room ? sanitizeRoom(room) : null;
}

function verifyRoomPassword(id, password) {
  const cleanId = (id || '').trim().toLowerCase();
  const room = dbData.rooms[cleanId];
  if (!room) return false;
  if (!room.passwordHash) return true; // sala pública sem senha
  if (typeof password !== 'string' || password.length > 128) return false;

  // Senhas de sala são guardadas sem os espaços das pontas; compara do mesmo jeito
  return verifyPassword(password.trim(), room.salt, room.passwordHash, room.pwAlgo);
}

function saveRoomForUser(username, roomId) {
  const cleanUsername = (username || '').trim().toLowerCase();
  const cleanRoomId = String(roomId || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');

  const user = dbData.users[cleanUsername];
  if (!user) throw new Error('Usuário não encontrado.');
  if (!cleanRoomId || cleanRoomId.length > 32) throw new Error('ID da sala inválido.');

  if (!user.savedRooms) user.savedRooms = [];
  if (!user.savedRooms.includes(cleanRoomId)) {
    user.savedRooms.push(cleanRoomId);
    saveDb();
  }

  return user.savedRooms;
}

function unsaveRoomForUser(username, roomId) {
  const cleanUsername = (username || '').trim().toLowerCase();
  const cleanRoomId = String(roomId || '').trim().toLowerCase();

  const user = dbData.users[cleanUsername];
  if (!user) throw new Error('Usuário não encontrado.');

  if (user.savedRooms) {
    user.savedRooms = user.savedRooms.filter(id => id !== cleanRoomId);
    saveDb();
  }

  return user.savedRooms;
}

function getUserSavedRooms(username) {
  const cleanUsername = (username || '').trim().toLowerCase();
  const user = dbData.users[cleanUsername];
  if (!user) return [];

  const savedIds = user.savedRooms || [];
  return savedIds.map(id => {
    const room = dbData.rooms[id];
    if (room) {
      return sanitizeRoom(room);
    }
    return {
      id,
      name: `Sala ${id}`,
      hasPassword: false,
      createdBy: 'Desconhecido',
      createdAt: null
    };
  });
}

function sanitizeRoom(room) {
  return {
    id: room.id,
    // Limpa também nomes salvos antes desta correção
    name: cleanText(room.name, 50) || room.id,
    createdBy: room.createdBy,
    hasPassword: Boolean(room.passwordHash),
    isLocked: Boolean(room.isLocked),
    createdAt: room.createdAt
  };
}

initDb();

module.exports = {
  registerUser,
  loginUser,
  getUserBySession,
  logoutSession,
  createRoom,
  getRoom,
  verifyRoomPassword,
  saveRoomForUser,
  unsaveRoomForUser,
  getUserSavedRooms
};
