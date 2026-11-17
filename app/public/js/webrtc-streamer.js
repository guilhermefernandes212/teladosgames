/**
 * webrtc-streamer.js
 * Motor WebRTC Mesh para comunicação simultânea em tempo real:
 * - Áudio bidirecional permanente (conversa de voz estilo Discord)
 * - Transmissão simultânea de tela (2 ou mais pessoas compartilhando ao mesmo tempo)
 * - Negociação automática ("perfect negotiation"): qualquer mudança de faixa
 *   (entrar na sala, iniciar/parar tela, microfone liberado depois) renegocia sozinha,
 *   inclusive quando duas pessoas começam a transmitir ao mesmo tempo.
 * - Um elemento <audio> por stream remoto (voz e som da tela tocam juntos)
 */

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:openrelay.metered.ca:80' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require'
};

class WebRTCMeshManager {
  constructor(signalingWs) {
    this.ws = signalingWs;
    this.localVoiceStream = null;
    this.localScreenStream = null;

    // peerId -> { pc, displayName, polite, makingOffer, ignoreOffer, signalQueue,
    //             voiceSender, screenSenders: [], audioEls: Map(streamId -> <audio>) }
    this.peers = new Map();

    // Callbacks de UI
    this.onRemoteScreenAdded = null; // (peerId, displayName, stream)
    this.onRemoteScreenRemoved = null; // (peerId)
    this.onPeerSpeaking = null; // (peerId, isSpeaking)
    this.onPeerLeft = null; // (peerId)
    this.onLocalScreenStarted = null; // (stream)
    this.onLocalScreenStopped = null; // ()

    // Áudio Análise (Detecção de voz / anel verde Discord)
    this.audioContext = null;
    this.silentAudioContext = null;
    this.micAnalyser = null;
    this.voiceDetectionInterval = null;

    this.isMicMuted = false;
    this.isDeafened = false;
    this.isSharingScreen = false;
    this.destroyed = false;
  }

  /**
   * Inicializa o microfone local para a conversa de voz.
   * Se já houver conexões abertas (alguém entrou enquanto o navegador pedia permissão),
   * a faixa de voz é adicionada a elas e a renegociação acontece automaticamente.
   */
  async initVoice() {
    let stream;
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1
          },
          video: false
        });
        this.setupVoiceActivityDetection(stream);
      } else {
        console.warn('getUserMedia não disponível (a página precisa estar em HTTPS ou localhost).');
        stream = this.createSilentAudioStream();
      }
    } catch (err) {
      console.warn('Microfone não concedido ou indisponível:', err.message);
      // Cria faixa de áudio silenciosa para que a negociação WebRTC não falhe
      stream = this.createSilentAudioStream();
    }

    if (this.destroyed) {
      stream.getTracks().forEach(t => t.stop());
      return null;
    }

    this.localVoiceStream = stream;
    this.applyMicState();

    // Adiciona a voz em conexões criadas antes do microfone estar pronto
    for (const peerData of this.peers.values()) {
      this.attachVoiceTrack(peerData);
    }

    return this.localVoiceStream;
  }

  createSilentAudioStream() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return new MediaStream();
      const ctx = new AudioCtx();
      this.silentAudioContext = ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0; // silêncio real (sem isso, desmutar tocaria um apito de 440 Hz)
      const dst = ctx.createMediaStreamDestination();
      osc.connect(gain);
      gain.connect(dst);
      osc.start();
      return new MediaStream(dst.stream.getAudioTracks());
    } catch (e) {
      console.warn('Erro ao criar áudio mudo de fallback:', e);
      return new MediaStream();
    }
  }

  setupVoiceActivityDetection(stream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.micAnalyser = this.audioContext.createAnalyser();
      this.micAnalyser.fftSize = 512;
      this.micAnalyser.smoothingTimeConstant = 0.4;
      source.connect(this.micAnalyser);

      const buffer = new Uint8Array(this.micAnalyser.frequencyBinCount);
      let wasSpeaking = false;

      this.voiceDetectionInterval = setInterval(() => {
        if (this.isMicMuted || !this.micAnalyser) {
          if (wasSpeaking) {
            wasSpeaking = false;
            if (this.onPeerSpeaking) this.onPeerSpeaking('local', false);
          }
          return;
        }

        this.micAnalyser.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i];
        }
        const average = sum / buffer.length;
        const isSpeaking = average > 18; // limiar de fala

        if (isSpeaking !== wasSpeaking) {
          wasSpeaking = isSpeaking;
          if (this.onPeerSpeaking) this.onPeerSpeaking('local', isSpeaking);
        }
      }, 100);
    } catch (e) {
      console.warn('Detecção de atividade de voz não pôde ser iniciada:', e);
    }
  }

  attachVoiceTrack(peerData) {
    if (peerData.voiceSender || !this.localVoiceStream) return;
    const voiceTrack = this.localVoiceStream.getAudioTracks()[0];
    if (!voiceTrack) return;
    try {
      peerData.voiceSender = peerData.pc.addTrack(voiceTrack, this.localVoiceStream);
    } catch (e) {
      console.warn('Não foi possível adicionar a voz à conexão:', e);
    }
  }

  attachScreenTracks(peerData) {
    if (!this.localScreenStream || peerData.screenSenders.length > 0) return;
    for (const track of this.localScreenStream.getTracks()) {
      try {
        peerData.screenSenders.push(peerData.pc.addTrack(track, this.localScreenStream));
      } catch (e) {
        console.warn('Não foi possível adicionar a tela à conexão:', e);
      }
    }
    this.applyScreenEncoding(peerData);
  }

  /**
   * Configura o envio da tela para priorizar fluidez (60 fps):
   * bitrate alto, fps máximo e "manter fps" quando faltar banda/CPU
   * (o padrão do navegador para telas é derrubar o fps para manter a nitidez).
   */
  async applyScreenEncoding(peerData) {
    const fps = this.screenFps || 60;
    const maxBitrate = this.screenMaxBitrate || 8000000;
    for (const sender of peerData.screenSenders) {
      if (!sender.track || sender.track.kind !== 'video') continue;
      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) continue; // ainda não negociado
        let changed = false;
        for (const enc of params.encodings) {
          if (enc.maxBitrate !== maxBitrate) { enc.maxBitrate = maxBitrate; changed = true; }
          if (enc.maxFramerate !== fps) { enc.maxFramerate = fps; changed = true; }
        }
        if (params.degradationPreference !== 'maintain-framerate') changed = true;
        if (!changed) continue;

        try {
          await sender.setParameters({ ...params, degradationPreference: 'maintain-framerate' });
        } catch (e) {
          // Navegador sem suporte a degradationPreference: aplica só bitrate e fps
          const retry = sender.getParameters();
          for (const enc of retry.encodings || []) {
            enc.maxBitrate = maxBitrate;
            enc.maxFramerate = fps;
          }
          await sender.setParameters(retry);
        }
      } catch (e) {
        console.warn('Não foi possível ajustar a qualidade da transmissão:', e);
      }
    }
  }

  /**
   * Cria a conexão com um par da sala.
   * isInitiator = true para quem acabou de entrar (ele inicia a oferta e é o lado "impolite"
   * na resolução de colisões). O par que já estava na sala é o lado "polite".
   * Síncrono de propósito: as faixas precisam estar adicionadas antes de aplicar a oferta remota.
   */
  connectToPeer(peerId, displayName, isInitiator = true) {
    if (this.peers.has(peerId)) return this.peers.get(peerId);

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const peerData = {
      pc,
      displayName,
      polite: !isInitiator,
      makingOffer: false,
      ignoreOffer: false,
      signalQueue: Promise.resolve(),
      voiceSender: null,
      screenSenders: [],
      audioEls: new Map(),
      remoteScreenStreamId: null
    };
    this.peers.set(peerId, peerData);

    // Toda mudança de faixas dispara uma renegociação automática
    pc.onnegotiationneeded = async () => {
      try {
        peerData.makingOffer = true;
        await pc.setLocalDescription();
        this.sendSignal(peerId, { sdp: pc.localDescription });
      } catch (err) {
        console.warn('Erro ao renegociar com par:', err);
      } finally {
        peerData.makingOffer = false;
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal(peerId, { candidate: event.candidate });
      }
    };

    // Recepção de mídia remota (voz, tela e som da tela)
    pc.ontrack = (event) => {
      const track = event.track;
      const stream = event.streams[0] || new MediaStream([track]);
      console.log(`[Mesh] Faixa remota recebida de ${displayName} (${peerId}):`, track.kind);

      if (track.kind === 'audio') {
        this.playRemoteAudio(peerData, stream);
      } else if (track.kind === 'video') {
        peerData.remoteScreenStreamId = stream.id;
        if (this.onRemoteScreenAdded) {
          this.onRemoteScreenAdded(peerId, displayName, new MediaStream([track]));
        }
      }

      // Quando o par para de transmitir, a faixa é removida do stream (não dispara "ended")
      stream.onremovetrack = (ev) => {
        if (ev.track.kind === 'video' && peerData.remoteScreenStreamId === stream.id) {
          peerData.remoteScreenStreamId = null;
          if (this.onRemoteScreenRemoved) this.onRemoteScreenRemoved(peerId);
        }
        if (stream.getAudioTracks().length === 0) {
          this.removeRemoteAudio(peerData, stream.id);
        }
      };
    };

    pc.onconnectionstatechange = () => {
      console.log(`[P2P ${displayName}] Estado da conexão:`, pc.connectionState);
      if (pc.connectionState === 'failed') {
        // Tenta recuperar a rota de rede em vez de derrubar o par
        try { pc.restartIce(); } catch (e) {}
      }
    };

    this.attachVoiceTrack(peerData);
    this.attachScreenTracks(peerData);

    // Sem nenhuma faixa local (navegador sem áudio), o iniciador ainda precisa abrir a conexão
    if (isInitiator && pc.getTransceivers().length === 0) {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    return peerData;
  }

  playRemoteAudio(peerData, stream) {
    let audioEl = peerData.audioEls.get(stream.id);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      document.body.appendChild(audioEl);
      peerData.audioEls.set(stream.id, audioEl);
    }
    audioEl.muted = this.isDeafened;
    if (audioEl.srcObject !== stream) audioEl.srcObject = stream;
    audioEl.play().catch(e => {
      console.log('Autoplay de áudio aguardando clique do usuário:', e);
      const notify = document.getElementById('audioAutoplayPrompt');
      if (notify) notify.style.display = 'flex';
    });
  }

  removeRemoteAudio(peerData, streamId) {
    const audioEl = peerData.audioEls.get(streamId);
    if (audioEl) {
      audioEl.pause();
      audioEl.srcObject = null;
      audioEl.remove();
      peerData.audioEls.delete(streamId);
    }
  }

  /**
   * Processa sinalização recebida via WebSocket de outro par.
   * As mensagens de cada par são processadas em fila, na ordem de chegada.
   */
  handleSignal(fromId, displayName, payload) {
    let peerData = this.peers.get(fromId);
    if (!peerData) {
      // Par desconhecido: ele nos chamou, então somos o lado que responde
      peerData = this.connectToPeer(fromId, displayName, false);
    }

    peerData.signalQueue = peerData.signalQueue
      .then(() => this.processSignal(peerData, fromId, payload))
      .catch(err => console.warn('Erro na sinalização:', err));
    return peerData.signalQueue;
  }

  async processSignal(peerData, fromId, payload) {
    const pc = peerData.pc;
    if (pc.signalingState === 'closed') return;

    if (payload.sdp) {
      const description = payload.sdp;
      const offerCollision = description.type === 'offer' &&
        (peerData.makingOffer || pc.signalingState !== 'stable');

      peerData.ignoreOffer = !peerData.polite && offerCollision;
      if (peerData.ignoreOffer) return;

      // O lado "polite" desfaz a própria oferta automaticamente (rollback implícito)
      await pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        this.sendSignal(fromId, { sdp: pc.localDescription });
      }
      // Após cada negociação, garante a configuração de 60 fps da tela
      if (peerData.screenSenders.length > 0) this.applyScreenEncoding(peerData);
    } else if (payload.candidate) {
      try {
        await pc.addIceCandidate(payload.candidate);
      } catch (err) {
        if (!peerData.ignoreOffer) console.warn('Erro ao aplicar candidato ICE:', err);
      }
    }
  }

  sendSignal(targetId, payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'signal',
        targetId,
        payload
      }));
    }
  }

  /**
   * INICIAR COMPARTILHAMENTO DE TELA (Ambos podem transmitir simultaneamente!)
   */
  async startScreenShare({ fps = 60, resolution = '1080p' } = {}) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error('insecure-context');
    }

    let width = 1920;
    let height = 1080;
    if (resolution === '720p') { width = 1280; height = 720; }
    else if (resolution === '1440p') { width = 2560; height = 1440; }
    else if (resolution === 'source') { width = undefined; height = undefined; }

    const videoConstraints = {
      cursor: 'always',
      frameRate: { ideal: fps, max: fps }
    };
    if (width && height) {
      videoConstraints.width = { ideal: width };
      videoConstraints.height = { ideal: height };
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: videoConstraints,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    if (this.destroyed) {
      stream.getTracks().forEach(t => t.stop());
      return null;
    }

    this.localScreenStream = stream;
    this.isSharingScreen = true;
    this.screenFps = fps;

    // Detecta encerramento pela barra de compartilhamento nativa do navegador
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onended = () => this.stopScreenShare();
      // "motion" = jogo/vídeo: o codificador prioriza fluidez em vez de nitidez de texto
      try { videoTrack.contentHint = 'motion'; } catch (e) {}
    }

    // Adiciona a tela em todas as conexões; a renegociação acontece automaticamente
    for (const peerData of this.peers.values()) {
      this.attachScreenTracks(peerData);
    }

    if (this.onLocalScreenStarted) {
      this.onLocalScreenStarted(stream);
    }

    this.broadcastMediaState();
    return stream;
  }

  /**
   * PARAR COMPARTILHAMENTO DE TELA
   */
  stopScreenShare({ silent = false } = {}) {
    if (!this.localScreenStream) return;

    this.isSharingScreen = false;
    this.localScreenStream.getTracks().forEach(t => t.stop());
    this.localScreenStream = null;

    for (const peerData of this.peers.values()) {
      for (const sender of peerData.screenSenders) {
        try { peerData.pc.removeTrack(sender); } catch (e) {}
      }
      peerData.screenSenders = [];
    }

    if (this.onLocalScreenStopped && !silent) {
      this.onLocalScreenStopped();
    }

    this.broadcastMediaState();
  }

  applyMicState() {
    if (this.localVoiceStream) {
      this.localVoiceStream.getAudioTracks().forEach(t => {
        t.enabled = !this.isMicMuted;
      });
    }
  }

  /**
   * Alternar mudo do microfone
   */
  setMicMuted(muted) {
    this.isMicMuted = muted;
    this.applyMicState();
    this.broadcastMediaState();
  }

  /**
   * Alternar ensurdecido (silencia o áudio de todos os participantes).
   * O mute do microfone que acompanha o Deafen é controlado pela interface (app.js).
   */
  setDeafened(deafened) {
    this.isDeafened = deafened;
    for (const peerData of this.peers.values()) {
      for (const audioEl of peerData.audioEls.values()) {
        audioEl.muted = deafened;
      }
    }
  }

  broadcastMediaState() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'media-state',
        isSharingScreen: this.isSharingScreen,
        isMicMuted: this.isMicMuted
      }));
    }
  }

  /**
   * Chamado quando o servidor avisa o estado de mídia de um par.
   */
  handleRemoteMediaState(peerId, isSharingScreen) {
    const peerData = this.peers.get(peerId);
    if (!isSharingScreen) {
      if (peerData) peerData.remoteScreenStreamId = null;
      if (this.onRemoteScreenRemoved) this.onRemoteScreenRemoved(peerId);
    }
  }

  closePeer(peerId) {
    const peerData = this.peers.get(peerId);
    if (peerData) {
      for (const streamId of [...peerData.audioEls.keys()]) {
        this.removeRemoteAudio(peerData, streamId);
      }
      try { peerData.pc.close(); } catch (e) {}
      this.peers.delete(peerId);
    }
    if (this.onRemoteScreenRemoved) {
      this.onRemoteScreenRemoved(peerId);
    }
    if (this.onPeerLeft) {
      this.onPeerLeft(peerId);
    }
  }

  destroy() {
    this.destroyed = true;
    if (this.voiceDetectionInterval) clearInterval(this.voiceDetectionInterval);

    this.stopScreenShare({ silent: true });

    if (this.localVoiceStream) {
      this.localVoiceStream.getTracks().forEach(t => t.stop());
      this.localVoiceStream = null;
    }

    for (const id of [...this.peers.keys()]) {
      this.closePeer(id);
    }
    this.peers.clear();

    for (const ctx of [this.audioContext, this.silentAudioContext]) {
      if (ctx && ctx.state !== 'closed') {
        try { ctx.close(); } catch (e) {}
      }
    }
  }
}

window.WebRTCMeshManager = WebRTCMeshManager;
