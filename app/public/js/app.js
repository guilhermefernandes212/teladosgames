/**
 * app.js
 * Orquestrador da Interface Minimalista, Autenticação,
 * Conexão Direta com Amigos por IP ou Link, e Telas Simultâneas.
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- Elementos do Topbar ---
  const navBrand = document.getElementById('navBrand');
  const topRoomPill = document.getElementById('topRoomPill');
  const topRoomDot = document.getElementById('topRoomDot');
  const topRoomName = document.getElementById('topRoomName');
  const btnQuickInvite = document.getElementById('btnQuickInvite');
  const btnOpenRemoteModal = document.getElementById('btnOpenRemoteModal');
  const btnToggleRoomsDrawer = document.getElementById('btnToggleRoomsDrawer');
  const userProfileBtn = document.getElementById('userProfileBtn');
  const userAvatarHeader = document.getElementById('userAvatarHeader');
  const userNameHeader = document.getElementById('userNameHeader');

  // --- Elementos do Palco & Lobby ---
  const streamGrid = document.getElementById('streamGrid');
  const voiceLobbyPlaceholder = document.getElementById('voiceLobbyPlaceholder');
  const lobbyStatusBadge = document.getElementById('lobbyStatusBadge');
  const currentRoomTitle = document.getElementById('currentRoomTitle');
  const currentRoomSubtitle = document.getElementById('currentRoomSubtitle');
  const voiceAvatarsRow = document.getElementById('voiceAvatarsRow');

  const lobbyBtnShareScreen = document.getElementById('lobbyBtnShareScreen');
  const lobbyBtnCopyLink = document.getElementById('lobbyBtnCopyLink');
  const lobbyBtnNewRoom = document.getElementById('lobbyBtnNewRoom');

  // --- Dock Flutuante Central ---
  const dockBtnMic = document.getElementById('dockBtnMic');
  const dockIconMic = document.getElementById('dockIconMic');
  const dockBtnDeafen = document.getElementById('dockBtnDeafen');
  const dockIconDeafen = document.getElementById('dockIconDeafen');
  const dockBtnScreen = document.getElementById('dockBtnScreen');
  const dockTextScreen = document.getElementById('dockTextScreen');
  const dockBtnCopy = document.getElementById('dockBtnCopy');
  const dockBtnBookmark = document.getElementById('dockBtnBookmark');
  const dockBtnChatToggle = document.getElementById('dockBtnChatToggle');
  const chatUnreadDot = document.getElementById('chatUnreadDot');
  const dockBtnLeave = document.getElementById('dockBtnLeave');

  // --- Gavetas Laterais (Off-Canvas) ---
  const chatDrawer = document.getElementById('chatDrawer');
  const btnCloseChatDrawer = document.getElementById('btnCloseChatDrawer');
  const chatMessages = document.getElementById('chatMessages');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');

  const roomsDrawer = document.getElementById('roomsDrawer');
  const btnCloseRoomsDrawer = document.getElementById('btnCloseRoomsDrawer');
  const savedRoomsList = document.getElementById('savedRoomsList');
  const userAvatarSidebar = document.getElementById('userAvatarSidebar');
  const userNameSidebar = document.getElementById('userNameSidebar');
  const userStatusSidebar = document.getElementById('userStatusSidebar');
  const btnLogout = document.getElementById('btnLogout');
  const drawerBackdrop = document.getElementById('drawerBackdrop');

  // --- Modais ---
  const btnOpenCreateRoom = document.getElementById('btnOpenCreateRoom');
  const createRoomModal = document.getElementById('createRoomModal');
  const btnCloseCreateModal = document.getElementById('btnCloseCreateModal');
  const formCreateRoom = document.getElementById('formCreateRoom');
  const newRoomName = document.getElementById('newRoomName');
  const newRoomId = document.getElementById('newRoomId');
  const newRoomPass = document.getElementById('newRoomPass');

  const btnOpenJoinModal = document.getElementById('btnOpenJoinModal');
  const joinModal = document.getElementById('joinModal');
  const btnCloseJoinModal = document.getElementById('btnCloseJoinModal');
  const formJoinRoom = document.getElementById('formJoinRoom');
  const joinRoomId = document.getElementById('joinRoomId');
  const joinRoomPass = document.getElementById('joinRoomPass');

  const remoteModal = document.getElementById('remoteModal');
  const btnCloseRemoteModal = document.getElementById('btnCloseRemoteModal');
  const selectConnectionMode = document.getElementById('selectConnectionMode');
  const inputPublicUrl = document.getElementById('inputPublicUrl');
  const btnCopyPublicUrl = document.getElementById('btnCopyPublicUrl');
  const txtConnectionTip = document.getElementById('txtConnectionTip');
  const btnCopyFullInvite = document.getElementById('btnCopyFullInvite');

  const authModal = document.getElementById('authModal');
  const btnCloseAuthModal = document.getElementById('btnCloseAuthModal');
  const tabBtnLogin = document.getElementById('tabBtnLogin');
  const tabBtnRegister = document.getElementById('tabBtnRegister');
  const formLogin = document.getElementById('formLogin');
  const formRegister = document.getElementById('formRegister');
  const loginUsername = document.getElementById('loginUsername');
  const loginPassword = document.getElementById('loginPassword');
  const regUsername = document.getElementById('regUsername');
  const regDisplayName = document.getElementById('regDisplayName');
  const regPassword = document.getElementById('regPassword');

  // --- Banner de Autoplay de Áudio ---
  const audioAutoplayPrompt = document.getElementById('audioAutoplayPrompt');
  const btnDismissAudioPrompt = document.getElementById('btnDismissAudioPrompt');

  // --- Estado da Aplicação ---
  let authToken = localStorage.getItem('discord_stream_token') || null;
  let currentUser = null;
  let currentRoomId = null;
  let currentRoomName = null;
  let ws = null;
  let meshManager = null;
  let myClientId = null;

  let isMicMuted = false;
  let isDeafened = false;
  let micMutedBeforeDeafen = false;
  let activeScreensCount = 0;
  let cachedTunnelInfo = null;
  let isJoiningRoom = false;
  let pendingRoomId = null;
  let lastRoomPassword = '';
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  const MAX_RECONNECT_ATTEMPTS = 5;

  const roomPeersMap = new Map();

  // ==========================================
  // INICIALIZAÇÃO
  // ==========================================

  initApp();

  async function initApp() {
    if (authToken) {
      await fetchCurrentUser();
    } else {
      updateUserUI(null);
    }

    // Carrega em segundo plano as informações de IP do servidor
    loadTunnelInfo();

    // Se o usuário abriu um link direto de sala (?room=xyz)
    const urlParams = new URLSearchParams(window.location.search);
    const inviteRoomId = urlParams.get('room');
    const invitePass = urlParams.get('pass') || '';

    if (inviteRoomId) {
      console.log(`[Link Direto] Entrando automaticamente na sala: ${inviteRoomId}`);
      showToast(`Conectando à sala #${inviteRoomId}...`, 'info');
      setTimeout(() => {
        joinRoom(inviteRoomId, invitePass);
      }, 200);
    }
  }

  function showConnectingUI(roomId) {
    topRoomDot.className = 'room-status-dot online';
    topRoomName.textContent = `#${roomId}`;
    lobbyStatusBadge.textContent = '🟡 Conectando...';
    currentRoomTitle.textContent = `Entrando na sala #${roomId}...`;
    currentRoomSubtitle.textContent = 'Estabelecendo conexão segura de voz e transmissão em tempo real.';
  }

  function resetRoomUI() {
    topRoomDot.className = 'room-status-dot offline';
    topRoomName.textContent = 'Nenhuma sala ativa';
    lobbyStatusBadge.textContent = '🟢 Sala Pronta';
    currentRoomTitle.textContent = 'Selecione ou Crie uma Sala';
    currentRoomSubtitle.textContent = 'Clique no botão abaixo ou crie uma sala para conversar e transmitir a tela.';
  }

  // ==========================================
  // AUTENTICAÇÃO REST API
  // ==========================================

  async function fetchCurrentUser() {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (data.success && data.user) {
        currentUser = data.user;
        updateUserUI(currentUser);
        loadSavedRooms();
      } else {
        logout();
      }
    } catch (e) {
      console.warn('Falha na verificação de sessão:', e);
      logout();
    }
  }

  function updateUserUI(user) {
    if (user) {
      const initial = (user.displayName || user.username || 'U')[0].toUpperCase();
      userAvatarHeader.textContent = initial;
      userNameHeader.textContent = user.displayName || user.username;
      userAvatarSidebar.textContent = initial;
      userNameSidebar.textContent = user.displayName || user.username;
      userStatusSidebar.textContent = '🟢 Online';
      btnLogout.style.display = 'block';
    } else {
      const guestName = localStorage.getItem('discord_guest_name') || 'Visitante';
      const initial = guestName[0].toUpperCase();
      userAvatarHeader.textContent = initial;
      userNameHeader.textContent = 'Entrar / Cadastrar';
      userAvatarSidebar.textContent = initial;
      userNameSidebar.textContent = guestName;
      userStatusSidebar.textContent = 'Modo Convidado';
      btnLogout.style.display = 'none';
      renderSavedRoomsList([]);
    }
  }

  async function loadSavedRooms() {
    if (!authToken) return;
    try {
      const res = await fetch('/api/rooms/my-rooms', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (data.success) {
        renderSavedRoomsList(data.rooms);
      }
    } catch (e) {
      console.warn('Erro ao carregar salas salvas:', e);
    }
  }

  function renderSavedRoomsList(rooms) {
    savedRoomsList.innerHTML = '';
    if (!rooms || rooms.length === 0) {
      savedRoomsList.innerHTML = `
        <div style="font-size: 12px; color: var(--text-muted); padding: 16px; text-align: center;">
          ${currentUser ? 'Nenhuma sala favoritada ainda.<br>Clique no <b>+</b> acima para criar uma!' : 'Faça login para salvar suas salas favoritas.'}
        </div>
      `;
      return;
    }

    rooms.forEach(r => {
      const item = document.createElement('div');
      item.className = `saved-room-item ${r.id === currentRoomId ? 'active' : ''}`;
      item.dataset.roomId = r.id;

      let badgeHtml = '';
      if (r.activeCount > 0) {
        badgeHtml = `<span class="room-live-badge">${r.activeCount} online</span>`;
      }

      item.innerHTML = `
        <div class="room-item-left" title="${escapeHtml(r.name)} (#${escapeHtml(r.id)})">
          <span>#</span>
          <span>${escapeHtml(r.name)}</span>
          ${badgeHtml}
        </div>
        <button class="btn-remove-room" title="Remover dos favoritos">✕</button>
      `;

      item.querySelector('.room-item-left').addEventListener('click', () => {
        closeDrawers();
        joinRoom(r.id, '');
      });

      item.querySelector('.btn-remove-room').addEventListener('click', async (e) => {
        e.stopPropagation();
        await unsaveRoom(r.id);
      });

      savedRoomsList.appendChild(item);
    });
  }

  async function unsaveRoom(roomId) {
    if (!authToken) return;
    try {
      const res = await fetch('/api/rooms/unsave', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ roomId })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Sala removida dos favoritos.', 'info');
        loadSavedRooms();
      }
    } catch (e) {
      showToast('Erro ao remover sala.', 'error');
    }
  }

  // ==========================================
  // WEBSOCKET & WEBRTC MESH DE VOZ E TELAS
  // ==========================================

  function initWebSocket() {
    return new Promise((resolve, reject) => {
      const isHttps = window.location.protocol === 'https:';
      const protocol = isHttps ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      const socket = new WebSocket(wsUrl);
      ws = socket;
      let opened = false;

      socket.onopen = () => {
        opened = true;
        console.log('✅ WebSocket Conectado.');
        meshManager = new WebRTCMeshManager(socket);
        meshManager.isMicMuted = isMicMuted;
        meshManager.isDeafened = isDeafened;
        setupMeshCallbacks();
        resolve(socket);
      };

      socket.onerror = (err) => {
        if (!opened) {
          reject(err);
        }
      };

      socket.onmessage = (event) => {
        if (ws !== socket) return; // mensagem de uma conexão antiga
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (e) {
          console.error('Mensagem inválida do servidor:', e);
          return;
        }
        handleSignalingMessage(msg).catch(e => console.error('Erro ao processar mensagem do servidor:', e));
      };

      socket.onclose = () => {
        console.log('WebSocket desconectado.');
        if (ws !== socket) return; // fechamento intencional (saiu da sala ou trocou de sala)
        handleUnexpectedDisconnect();
      };
    });
  }

  // Conexão com o servidor caiu sem o usuário ter saído: limpa e tenta voltar para a sala
  function handleUnexpectedDisconnect() {
    const roomToRejoin = currentRoomId || pendingRoomId;
    cleanupConnection();
    clearRoomState();

    if (!roomToRejoin) return;

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts = 0;
      resetRoomUI();
      showToast('Conexão com o servidor perdida. Entre na sala novamente.', 'error');
      return;
    }

    reconnectAttempts++;
    showConnectingUI(roomToRejoin);
    lobbyStatusBadge.textContent = '🟠 Reconectando...';
    showToast(`Conexão perdida. Reconectando (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`, 'error');

    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      joinRoom(roomToRejoin, lastRoomPassword);
    }, 2000 * reconnectAttempts);
  }

  function setupMeshCallbacks() {
    // 1. Nova tela compartilhada por outro participante
    meshManager.onRemoteScreenAdded = (peerId, displayName, stream) => {
      addScreenCardToGrid(peerId, displayName, stream, false);
      showToast(`${displayName} iniciou o compartilhamento de tela!`, 'info');
    };

    // 2. Tela remota encerrada
    meshManager.onRemoteScreenRemoved = (peerId) => {
      removeScreenCardFromGrid(peerId);
    };

    // 3. O próprio usuário começou a transmitir
    meshManager.onLocalScreenStarted = (stream) => {
      addScreenCardToGrid('local', 'Sua Tela (Você)', stream, true);
      dockBtnScreen.classList.add('btn-active-screenshare');
      dockTextScreen.textContent = 'Parar Tela';
      showToast('Transmissão da sua tela iniciada!', 'success');
    };

    // 4. O próprio usuário parou a transmissão
    meshManager.onLocalScreenStopped = () => {
      removeScreenCardFromGrid('local');
      dockBtnScreen.classList.remove('btn-active-screenshare');
      dockTextScreen.textContent = 'Transmitir Tela';
      showToast('Compartilhamento de tela finalizado.', 'info');
    };

    // 5. Indicador de fala estilo Discord (anel verde pulsante)
    meshManager.onPeerSpeaking = (peerId, isSpeaking) => {
      const avatarEl = document.getElementById(`avatar-circle-${peerId}`);
      if (avatarEl) {
        avatarEl.classList.toggle('is-speaking', isSpeaking);
      }
    };

    meshManager.onPeerLeft = (peerId) => {
      removePeerFromVoiceLobby(peerId);
      removeScreenCardFromGrid(peerId);
    };
  }

  // ==========================================
  // MANIPULAÇÃO DE MENSAGENS DE SINALIZAÇÃO
  // ==========================================

  async function handleSignalingMessage(msg) {
    switch (msg.type) {
      case 'connection-ready':
        myClientId = msg.clientId;
        break;

      case 'room-joined-success': {
        const wasReconnect = reconnectAttempts > 0;
        isJoiningRoom = false;
        pendingRoomId = null;
        reconnectAttempts = 0;
        currentRoomId = msg.roomId;
        currentRoomName = msg.roomName;
        enterRoomUI(msg.roomId, msg.roomName);
        const mesh = meshManager;

        // Conecta-se a todos os pares já existentes na sala (a negociação é automática)
        if (msg.existingPeers && msg.existingPeers.length > 0) {
          for (const peer of msg.existingPeers) {
            addPeerToVoiceLobby(peer.clientId, peer.displayName);
            mesh.connectToPeer(peer.clientId, peer.displayName, true);
          }
        }
        showToast(wasReconnect ? 'Reconectado à sala!' : `Você entrou na sala ${msg.roomName}!`, 'success');

        // Inicializa o microfone (com fallback silencioso); a voz é adicionada às conexões quando ficar pronta
        await mesh.initVoice();
        if (meshManager === mesh && !window.isSecureContext) {
          showToast('Microfone e tela exigem HTTPS. Abra o app pelo link https:// ou pelo localhost.', 'error');
        }
        break;
      }

      case 'peer-joined':
        addPeerToVoiceLobby(msg.clientId, msg.displayName);
        showToast(`${msg.displayName} entrou na sala.`, 'info');
        break;

      case 'signal':
        if (meshManager) meshManager.handleSignal(msg.fromId, msg.displayName, msg.payload);
        break;

      case 'peer-media-state-changed':
        if (meshManager && msg.clientId !== myClientId) {
          meshManager.handleRemoteMediaState(msg.clientId, msg.isSharingScreen);
        }
        break;

      case 'peer-left':
        showToast(`${msg.displayName} saiu da sala.`, 'info');
        if (meshManager) meshManager.closePeer(msg.clientId);
        break;

      case 'chat-message':
        appendChatMessage(msg);
        break;

      case 'error': {
        const failedRoomId = pendingRoomId;
        isJoiningRoom = false;
        showToast(msg.message, 'error');

        if (failedRoomId && !currentRoomId) {
          // Falhou ao entrar: volta a interface ao estado inicial
          pendingRoomId = null;
          reconnectAttempts = 0;
          resetRoomUI();

          // Sala protegida: abre o modal de entrada já com o ID preenchido para digitar a senha
          if (msg.code === 'bad-password') {
            joinRoomId.value = failedRoomId;
            joinRoomPass.value = '';
            joinModal.style.display = 'flex';
            joinRoomPass.focus();
          }
        }
        break;
      }
    }
  }

  // ==========================================
  // ENTRAR E GERENCIAR SALA
  // ==========================================

  async function joinRoom(roomId, password = '') {
    roomId = (roomId || '').trim().toLowerCase();
    if (!roomId) return;
    if (isJoiningRoom) return;
    if (currentRoomId === roomId) {
      showToast('Você já está nesta sala.', 'info');
      return;
    }

    // Trocando de sala: sai da atual por completo antes (evita "fantasma" e conexões antigas)
    if (currentRoomId) {
      cleanupConnection();
      clearRoomState();
    }

    clearTimeout(reconnectTimer);
    isJoiningRoom = true;
    pendingRoomId = roomId;
    lastRoomPassword = password;
    showConnectingUI(roomId);

    try {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        await initWebSocket();
      }

      let myName = currentUser ? currentUser.displayName : localStorage.getItem('discord_guest_name');
      if (!myName) {
        myName = 'Amigo-' + CryptoHelper.generateRandomId(3);
        localStorage.setItem('discord_guest_name', myName);
      }

      ws.send(JSON.stringify({
        type: 'join-room',
        roomId,
        token: authToken,
        password,
        displayName: myName
      }));

    } catch (e) {
      // Falha ao abrir a conexão: o onclose do WebSocket agenda novas tentativas
      isJoiningRoom = false;
      console.error('Não foi possível conectar ao servidor:', e);
    }
  }

  function enterRoomUI(roomId, roomName) {
    topRoomDot.className = 'room-status-dot online';
    topRoomName.textContent = `#${roomName} (${roomId})`;

    lobbyStatusBadge.textContent = '🟢 Sala Conectada';
    currentRoomTitle.textContent = roomName;
    currentRoomSubtitle.textContent = `Sala: ${roomId} • Ambos podem conversar e transmitir a tela simultaneamente.`;

    // Adiciona o avatar local no saguão de voz
    voiceAvatarsRow.innerHTML = '';
    const myName = currentUser ? currentUser.displayName : (localStorage.getItem('discord_guest_name') || 'Você');
    addPeerToVoiceLobby('local', myName);

    // Destaca na lista de salas salvas
    document.querySelectorAll('.saved-room-item').forEach(el => {
      el.classList.toggle('active', el.dataset.roomId === roomId);
    });
  }

  function addPeerToVoiceLobby(peerId, displayName) {
    if (document.getElementById(`voice-user-${peerId}`)) return;

    const userCard = document.createElement('div');
    userCard.className = 'voice-user-card';
    userCard.id = `voice-user-${peerId}`;

    const initial = (displayName || 'U').slice(0, 2).toUpperCase();

    userCard.innerHTML = `
      <div id="avatar-circle-${peerId}" class="voice-avatar-big">
        ${escapeHtml(initial)}
      </div>
      <span>${escapeHtml(displayName)}</span>
    `;

    voiceAvatarsRow.appendChild(userCard);
    roomPeersMap.set(peerId, { displayName });
  }

  function removePeerFromVoiceLobby(peerId) {
    const el = document.getElementById(`voice-user-${peerId}`);
    if (el) el.remove();
    roomPeersMap.delete(peerId);
  }

  // ==========================================
  // GRADE DE TELAS SIMULTÂNEAS (DUAL SCREEN SHARE)
  // ==========================================

  function addScreenCardToGrid(peerId, title, stream, isLocal = false) {
    const cardId = `screen-card-${peerId}`;
    let card = document.getElementById(cardId);

    if (!card) {
      card = document.createElement('div');
      card.className = 'screen-card';
      card.id = cardId;

      card.innerHTML = `
        <div class="screen-card-header">
          <span>📺</span>
          <span>${escapeHtml(title)}</span>
        </div>
        <div class="screen-card-actions">
          <button class="btn-card-action btn-fullscreen" title="Tela Cheia">⛶</button>
        </div>
        <video autoplay playsinline ${isLocal ? 'muted' : ''}></video>
      `;

      card.querySelector('.btn-fullscreen').addEventListener('click', () => {
        if (!document.fullscreenElement) {
          card.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen();
        }
      });

      streamGrid.appendChild(card);
      activeScreensCount++;
    }

    const video = card.querySelector('video');
    video.srcObject = stream;
    video.play().catch(e => console.warn('Autoplay aguardando interação:', e));

    updateGridClass();
  }

  function removeScreenCardFromGrid(peerId) {
    const card = document.getElementById(`screen-card-${peerId}`);
    if (card) {
      const video = card.querySelector('video');
      if (video) video.srcObject = null;
      card.remove();
      activeScreensCount = Math.max(0, activeScreensCount - 1);
      updateGridClass();
    }
  }

  function updateGridClass() {
    streamGrid.className = `stream-grid screens-${activeScreensCount}`;
    if (activeScreensCount > 0) {
      voiceLobbyPlaceholder.style.display = 'none';
    } else {
      voiceLobbyPlaceholder.style.display = 'flex';
    }
  }

  // ==========================================
  // AÇÕES RÁPIDAS NO CENTRO DO SAGUÃO
  // ==========================================

  lobbyBtnShareScreen.addEventListener('click', () => {
    toggleScreenShare();
  });

  lobbyBtnCopyLink.addEventListener('click', () => {
    copyDirectRoomLink();
  });

  lobbyBtnNewRoom.addEventListener('click', () => {
    openCreateRoomModal();
  });

  // ==========================================
  // CONTROLES DO DOCK FLUTUANTE
  // ==========================================

  // Microfone
  function setMicMuted(muted) {
    isMicMuted = muted;
    if (meshManager) meshManager.setMicMuted(isMicMuted);
    dockBtnMic.classList.toggle('btn-muted', isMicMuted);
    dockIconMic.textContent = isMicMuted ? '🎙️❌' : '🎙️';
  }

  dockBtnMic.addEventListener('click', () => {
    // Desmutar o microfone com o áudio ensurdecido também tira o Deafen (igual ao Discord)
    if (isMicMuted && isDeafened) {
      setDeafened(false, { restoreMic: false });
    }
    setMicMuted(!isMicMuted);
    showToast(isMicMuted ? 'Microfone desativado.' : 'Microfone ativado.', 'info');
  });

  // Ensurdecer (Deafen): silencia todos e muta o microfone; ao desfazer, o microfone volta ao estado anterior
  function setDeafened(deafened, { restoreMic = true } = {}) {
    if (deafened === isDeafened) return;
    isDeafened = deafened;
    if (meshManager) meshManager.setDeafened(isDeafened);
    dockBtnDeafen.classList.toggle('btn-muted', isDeafened);
    dockIconDeafen.textContent = isDeafened ? '🎧❌' : '🎧';

    if (isDeafened) {
      micMutedBeforeDeafen = isMicMuted;
      setMicMuted(true);
    } else if (restoreMic) {
      setMicMuted(micMutedBeforeDeafen);
    }
  }

  dockBtnDeafen.addEventListener('click', () => {
    setDeafened(!isDeafened);
    showToast(isDeafened ? 'Áudio ensurdecido (silenciado).' : 'Áudio restaurado.', 'info');
  });

  // Transmitir Tela (Toggle)
  dockBtnScreen.addEventListener('click', () => {
    toggleScreenShare();
  });

  async function toggleScreenShare() {
    if (!currentRoomId) {
      showToast('Entre em uma sala primeiro para transmitir.', 'error');
      openCreateRoomModal();
      return;
    }

    if (meshManager && meshManager.isSharingScreen) {
      meshManager.stopScreenShare();
    } else if (meshManager) {
      try {
        await meshManager.startScreenShare({ fps: 60, resolution: '1080p' });
      } catch (e) {
        if (e && e.message === 'insecure-context') {
          showToast('Transmitir tela exige HTTPS. Abra o app pelo link https:// ou pelo localhost.', 'error');
        } else {
          showToast('Compartilhamento de tela cancelado.', 'info');
        }
      }
    }
  }

  // Copiar Link Direto da Sala para Amigos
  dockBtnCopy.addEventListener('click', () => {
    copyDirectRoomLink();
  });

  btnQuickInvite.addEventListener('click', () => {
    copyDirectRoomLink();
  });

  topRoomPill.addEventListener('click', () => {
    if (currentRoomId) copyDirectRoomLink();
  });

  function copyDirectRoomLink() {
    if (!currentRoomId) {
      showToast('Crie ou selecione uma sala primeiro.', 'info');
      openCreateRoomModal();
      return;
    }

    let baseUrl = window.location.origin;
    const host = window.location.hostname;

    if (host === 'localhost' || host === '127.0.0.1') {
      // No localhost, usa preferencialmente o link da Cloudflare (1 clique pela web) ou o IP do roteador em HTTPS
      if (cachedTunnelInfo && cachedTunnelInfo.publicUrl) {
        baseUrl = cachedTunnelInfo.publicUrl;
      } else if (cachedTunnelInfo && cachedTunnelInfo.lanHttpsUrl) {
        baseUrl = cachedTunnelInfo.lanHttpsUrl;
      }
    } else if (window.location.protocol === 'http:' && cachedTunnelInfo && cachedTunnelInfo.httpsPort) {
      // Link http://IP não libera microfone/tela no navegador do amigo: troca para https
      baseUrl = `https://${host}:${cachedTunnelInfo.httpsPort}`;
    }

    baseUrl = baseUrl.replace(/\/$/, '');
    const directUrl = `${baseUrl}/?room=${encodeURIComponent(currentRoomId)}`;

    copyText(directUrl).then(ok => {
      if (ok) {
        showToast(`Link copiado! Seu amigo só precisa clicar nele para entrar na sua sala: ${directUrl}`, 'success');
      } else {
        showToast(`Não foi possível copiar automaticamente. Link: ${directUrl}`, 'error');
      }
    });
  }

  // Salvar Sala Atual nos Favoritos
  dockBtnBookmark.addEventListener('click', async () => {
    if (!currentRoomId) {
      showToast('Nenhuma sala ativa no momento.', 'info');
      return;
    }
    if (!authToken) {
      openAuthModal();
      showToast('Faça login para salvar esta sala na sua conta.', 'info');
      return;
    }

    try {
      const res = await fetch('/api/rooms/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ roomId: currentRoomId })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Sala salva com sucesso nos seus favoritos!', 'success');
        loadSavedRooms();
      }
    } catch (e) {
      showToast('Erro ao salvar sala.', 'error');
    }
  });

  // Alternar Gaveta de Chat
  dockBtnChatToggle.addEventListener('click', () => {
    const isOpen = chatDrawer.classList.contains('open');
    if (isOpen) {
      closeDrawers();
    } else {
      closeDrawers();
      chatDrawer.classList.add('open');
      drawerBackdrop.style.display = 'block';
      chatUnreadDot.style.display = 'none';
      chatInput.focus();
    }
  });

  btnCloseChatDrawer.addEventListener('click', () => {
    closeDrawers();
  });

  // Alternar Gaveta de Salas
  btnToggleRoomsDrawer.addEventListener('click', () => {
    const isOpen = roomsDrawer.classList.contains('open');
    if (isOpen) {
      closeDrawers();
    } else {
      closeDrawers();
      roomsDrawer.classList.add('open');
      drawerBackdrop.style.display = 'block';
      loadSavedRooms();
    }
  });

  btnCloseRoomsDrawer.addEventListener('click', () => {
    closeDrawers();
  });

  drawerBackdrop.addEventListener('click', () => {
    closeDrawers();
  });

  function closeDrawers() {
    chatDrawer.classList.remove('open');
    roomsDrawer.classList.remove('open');
    drawerBackdrop.style.display = 'none';
  }

  // Desconectar da Sala
  dockBtnLeave.addEventListener('click', () => {
    if (confirm('Deseja sair da sala de transmissão?')) {
      leaveRoom();
    }
  });

  // Encerra conexões (voz, telas, WebSocket) e limpa o palco
  function cleanupConnection() {
    if (meshManager) {
      meshManager.destroy();
      meshManager = null;
    }

    if (ws) {
      const oldWs = ws;
      ws = null; // marca o fechamento como intencional antes de fechar
      try { oldWs.close(); } catch (e) {}
    }

    myClientId = null;
    activeScreensCount = 0;
    streamGrid.innerHTML = '';
    streamGrid.appendChild(voiceLobbyPlaceholder);
    voiceAvatarsRow.innerHTML = '';
    roomPeersMap.clear();
    updateGridClass();

    dockBtnScreen.classList.remove('btn-active-screenshare');
    dockTextScreen.textContent = 'Transmitir Tela';

    // Limpa o chat da sala anterior
    chatMessages.innerHTML = '<div class="chat-welcome-notice">Início das mensagens desta sala. Converse por texto aqui!</div>';
    chatUnreadDot.style.display = 'none';
  }

  function clearRoomState() {
    currentRoomId = null;
    currentRoomName = null;
    pendingRoomId = null;
    isJoiningRoom = false;
    document.querySelectorAll('.saved-room-item').forEach(el => el.classList.remove('active'));
  }

  function leaveRoom() {
    clearTimeout(reconnectTimer);
    reconnectAttempts = 0;
    cleanupConnection();
    clearRoomState();
    lastRoomPassword = '';
    resetRoomUI();
    showToast('Você saiu da sala.', 'info');
  }

  // ==========================================
  // CHAT EM TEMPO REAL
  // ==========================================

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
      type: 'chat-message',
      text
    }));

    chatInput.value = '';
  });

  function appendChatMessage(msg) {
    const item = document.createElement('div');
    item.className = 'chat-message-item';
    item.innerHTML = `
      <div class="chat-msg-header">
        <span class="chat-msg-user">${escapeHtml(msg.senderName)}</span>
        <span class="chat-msg-time">${msg.timestamp}</span>
      </div>
      <div class="chat-msg-body">${escapeHtml(msg.text)}</div>
    `;
    chatMessages.appendChild(item);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Se o chat estiver fechado, exibe ponto indicador no botão do dock
    if (!chatDrawer.classList.contains('open')) {
      chatUnreadDot.style.display = 'block';
    }
  }

  // ==========================================
  // MODAIS E FORMULÁRIOS
  // ==========================================

  // Perfil / Login
  userProfileBtn.addEventListener('click', () => {
    if (!currentUser) {
      openAuthModal();
    } else {
      btnToggleRoomsDrawer.click();
    }
  });

  function openAuthModal() {
    authModal.style.display = 'flex';
  }

  btnCloseAuthModal.addEventListener('click', () => {
    authModal.style.display = 'none';
  });

  tabBtnLogin.addEventListener('click', () => {
    tabBtnLogin.classList.add('active');
    tabBtnRegister.classList.remove('active');
    formLogin.style.display = 'flex';
    formRegister.style.display = 'none';
  });

  tabBtnRegister.addEventListener('click', () => {
    tabBtnRegister.classList.add('active');
    tabBtnLogin.classList.remove('active');
    formRegister.style.display = 'flex';
    formLogin.style.display = 'none';
  });

  // Login
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUsername.value.trim(),
          password: loginPassword.value
        })
      });
      const data = await res.json();
      if (data.success) {
        authToken = data.token;
        localStorage.setItem('discord_stream_token', authToken);
        currentUser = data.user;
        updateUserUI(currentUser);
        authModal.style.display = 'none';
        loadSavedRooms();
        showToast(`Bem-vindo, ${currentUser.displayName}!`, 'success');
      } else {
        showToast(data.message, 'error');
      }
    } catch (err) {
      showToast('Erro ao realizar login.', 'error');
    }
  });

  // Cadastro
  formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: regUsername.value.trim(),
          displayName: regDisplayName.value.trim(),
          password: regPassword.value
        })
      });
      const data = await res.json();
      if (data.success) {
        authToken = data.token;
        localStorage.setItem('discord_stream_token', authToken);
        currentUser = data.user;
        updateUserUI(currentUser);
        authModal.style.display = 'none';
        loadSavedRooms();
        showToast(`Conta criada com sucesso! Bem-vindo, ${currentUser.displayName}!`, 'success');
      } else {
        showToast(data.message, 'error');
      }
    } catch (err) {
      showToast('Erro ao cadastrar conta.', 'error');
    }
  });

  // Logout
  btnLogout.addEventListener('click', () => {
    if (confirm('Deseja realmente sair da sua conta?')) {
      logout();
    }
  });

  function logout() {
    if (authToken) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      }).catch(() => {});
    }
    authToken = null;
    currentUser = null;
    localStorage.removeItem('discord_stream_token');
    updateUserUI(null);
    closeDrawers();
    showToast('Sessão encerrada.', 'info');
  }

  // Criar Sala Modal
  btnOpenCreateRoom.addEventListener('click', () => {
    openCreateRoomModal();
  });

  function openCreateRoomModal() {
    closeDrawers();
    newRoomId.value = 'sala-' + CryptoHelper.generateRandomId(4);
    createRoomModal.style.display = 'flex';
  }

  btnCloseCreateModal.addEventListener('click', () => {
    createRoomModal.style.display = 'none';
  });

  formCreateRoom.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = newRoomName.value.trim();
    const id = newRoomId.value.trim();
    const password = newRoomPass.value.trim();

    if (!authToken) {
      // Conecta diretamente como anônimo sem bloquear!
      createRoomModal.style.display = 'none';
      joinRoom(id, password);
      showToast('Sala criada! Para salvar nos seus favoritos, acesse sua conta.', 'info');
      return;
    }

    try {
      const res = await fetch('/api/rooms/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ id, name, password })
      });
      const data = await res.json();
      if (data.success) {
        createRoomModal.style.display = 'none';
        showToast('Sala criada com sucesso!', 'success');
        await loadSavedRooms();
        joinRoom(id, password);
      } else {
        showToast(data.message, 'error');
      }
    } catch (err) {
      showToast('Erro ao criar sala.', 'error');
    }
  });

  // Entrar por ID Modal
  btnOpenJoinModal.addEventListener('click', () => {
    closeDrawers();
    joinModal.style.display = 'flex';
  });

  btnCloseJoinModal.addEventListener('click', () => {
    joinModal.style.display = 'none';
  });

  formJoinRoom.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = joinRoomId.value.trim();
    const pass = joinRoomPass.value.trim();

    joinModal.style.display = 'none';
    joinRoom(id, pass);
  });

  // Modal de Conexão com Amigos por IP e Internet
  async function loadTunnelInfo() {
    try {
      const res = await fetch('/api/tunnel-info');
      const data = await res.json();
      if (data.success) {
        cachedTunnelInfo = data;
        updateConnectionModeUI();
      }
    } catch (e) {
      inputPublicUrl.value = window.location.origin;
    }
  }

  function updateConnectionModeUI() {
    if (!cachedTunnelInfo) return;
    const mode = selectConnectionMode ? selectConnectionMode.value : 'cloudflare';

    let selectedBase = '';
    let tip = '';

    // Links por IP usam HTTPS: sem ele o navegador do amigo bloqueia microfone e transmissão de tela
    const certTip = ' Na primeira vez, o navegador mostra um aviso de certificado: clique em "Avançado" → "Continuar".';
    const fallbackBase = cachedTunnelInfo.lanHttpsUrl || window.location.origin;

    if (mode === 'cloudflare') {
      if (cachedTunnelInfo.publicUrl) {
        selectedBase = cachedTunnelInfo.publicUrl;
        tip = `⚡ Link Cloudflare: Conecta qualquer amigo pela Internet com 1 clique (sem precisar abrir portas no roteador).`;
      } else {
        selectedBase = fallbackBase;
        tip = `ℹ️ Link Cloudflare ainda não disponível. Usando o IP da rede local.` + certTip;
      }
    } else if (mode === 'lan') {
      selectedBase = fallbackBase;
      tip = `🏠 IP do Roteador / Rede Local (${cachedTunnelInfo.localIp}): Ideal para quem está no mesmo Wi-Fi ou cabo de rede.` + certTip;
    } else if (mode === 'vpn') {
      if (cachedTunnelInfo.vpnHttpsUrl) {
        selectedBase = cachedTunnelInfo.vpnHttpsUrl;
        tip = `🛡️ IP Radmin VPN (${cachedTunnelInfo.vpnIp}): Conexão direta P2P com amigos conectados no seu Radmin VPN.` + certTip;
      } else {
        selectedBase = fallbackBase;
        tip = `⚠️ Radmin VPN não ativo no momento. Usando IP local do roteador.` + certTip;
      }
    } else if (mode === 'public_ip') {
      if (cachedTunnelInfo.publicHttpsUrl) {
        selectedBase = cachedTunnelInfo.publicHttpsUrl;
        tip = `🌐 IP Público (${cachedTunnelInfo.publicIp}): Requer a porta ${cachedTunnelInfo.httpsPort} liberada no roteador.` + certTip;
      } else {
        selectedBase = cachedTunnelInfo.publicUrl || fallbackBase;
        tip = `ℹ️ IP Público não disponível (só aparece no computador que hospeda o servidor). Usando link alternativo.`;
      }
    }

    const roomParam = currentRoomId ? `?room=${encodeURIComponent(currentRoomId)}` : '';
    inputPublicUrl.value = `${selectedBase.replace(/\/$/, '')}/${roomParam}`;
    if (txtConnectionTip) {
      txtConnectionTip.textContent = tip;
    }
  }

  if (selectConnectionMode) {
    selectConnectionMode.addEventListener('change', () => {
      updateConnectionModeUI();
    });
  }

  btnOpenRemoteModal.addEventListener('click', async () => {
    remoteModal.style.display = 'flex';
    await loadTunnelInfo();
  });

  btnCloseRemoteModal.addEventListener('click', () => {
    remoteModal.style.display = 'none';
  });

  btnCopyPublicUrl.addEventListener('click', async () => {
    const directLink = inputPublicUrl.value.trim();
    if (await copyText(directLink)) {
      showToast('Link direto copiado para a área de transferência!', 'success');
    } else {
      inputPublicUrl.select();
      showToast('Não foi possível copiar automaticamente. Selecione o link e use Ctrl+C.', 'error');
    }
  });

  btnCopyFullInvite.addEventListener('click', async () => {
    const directLink = inputPublicUrl.value.trim();
    const roomText = currentRoomId ? ` na sala ${currentRoomName || currentRoomId}` : '';
    const text = `🎮 Venha para a minha transmissão no TelaDosGames${roomText}!\n🔗 Clique no link para entrar direto na sala com voz e tela: ${directLink}`;

    if (await copyText(text)) {
      showToast('Convite copiado! Envie para seus amigos.', 'success');
    } else {
      showToast('Não foi possível copiar automaticamente.', 'error');
    }
  });

  // Notificação de Autoplay de Áudio
  btnDismissAudioPrompt.addEventListener('click', (e) => {
    e.stopPropagation();
    audioAutoplayPrompt.style.display = 'none';
  });

  // Desbloqueia reprodução automática de áudio na primeira interação do usuário na página
  document.addEventListener('click', () => {
    audioAutoplayPrompt.style.display = 'none';

    if (meshManager && meshManager.audioContext && meshManager.audioContext.state === 'suspended') {
      meshManager.audioContext.resume().catch(() => {});
    }

    document.querySelectorAll('audio').forEach(audio => {
      if (audio.paused && !audio.muted) {
        audio.play().catch(() => {});
      }
    });
  });

  // ==========================================
  // UTILITÁRIOS
  // ==========================================

  // Copia texto; navigator.clipboard só existe em HTTPS/localhost, então há um fallback
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {}

    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  // Escapa também aspas: o texto às vezes vai dentro de atributos (ex.: title="..."),
  // e o truque de textContent/innerHTML não escapa " nem '
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 260);
    }, 3800);
  }
});
