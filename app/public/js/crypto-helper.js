/**
 * crypto-helper.js
 * Utilitários criptográficos no navegador utilizando a Web Crypto API nativa.
 * Fornece derivação de chave segura (PBKDF2), geração de tokens e hashes.
 */

const CryptoHelper = {
  /**
   * Gera uma string aleatória segura para IDs de sala ou senhas sugeridas.
   */
  generateRandomId(length = 8) {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    const bytes = new Uint8Array(length);
    window.crypto.getRandomValues(bytes);
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[bytes[i] % chars.length];
    }
    return result;
  },

  /**
   * Gera um PIN numérico seguro de 6 dígitos.
   */
  generateNumericPin() {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return (100000 + (array[0] % 900000)).toString();
  },

  /**
   * Deriva uma chave criptográfica AES-256 a partir da senha da sala
   * utilizando PBKDF2 com 100.000 iterações de HMAC-SHA256.
   */
  async deriveKeyFromPassword(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: typeof salt === 'string' ? enc.encode(salt) : salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  },

  /**
   * Calcula hash SHA-256 em formato Hex.
   */
  async sha256Hex(text) {
    const enc = new TextEncoder();
    const buffer = await window.crypto.subtle.digest('SHA-256', enc.encode(text));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
};

window.CryptoHelper = CryptoHelper;
