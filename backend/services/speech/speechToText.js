const WebSocket = require('ws');

class SpeechToTextProvider {
  constructor(config = {}) { this.provider = config.provider || process.env.STT_PROVIDER || ''; this.apiKey = config.apiKey || process.env.STT_API_KEY || ''; }
  isConfigured() { return Boolean(this.provider && this.apiKey); }
  async transcribe() { throw new Error('Speech-to-text provider is not configured'); }
  createLiveSession({ onTranscript, onError }) {
    if (!this.isConfigured()) return null;
    if (this.provider.toLowerCase() !== 'deepgram') throw new Error(`Unsupported live STT provider: ${this.provider}. Add a provider adapter in services/speech/speechToText.js.`);
    const url = process.env.STT_WS_URL || 'wss://api.deepgram.com/v1/listen?encoding=mulaw&sample_rate=8000&channels=1&interim_results=true&endpointing=300';
    const socket = new WebSocket(url, { headers: { Authorization: `Token ${this.apiKey}` } });
    socket.on('message', (raw) => { try { const data = JSON.parse(raw.toString()); const alternative = data.channel?.alternatives?.[0]; const transcript = alternative?.transcript?.trim(); if (transcript && (data.is_final || data.speech_final)) onTranscript(transcript, { isFinal: Boolean(data.is_final || data.speech_final) }); } catch (error) { onError(error); } });
    socket.on('error', onError);
    return { sendAudio: (audio) => { if (socket.readyState === WebSocket.OPEN) socket.send(audio); }, close: () => socket.close() };
  }
}

module.exports = SpeechToTextProvider;
