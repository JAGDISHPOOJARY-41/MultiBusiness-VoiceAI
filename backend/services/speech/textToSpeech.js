class TextToSpeechProvider {
  constructor(config = {}) { this.provider = config.provider || process.env.TTS_PROVIDER || ''; this.apiKey = config.apiKey || process.env.TTS_API_KEY || ''; this.voiceId = config.voiceId || process.env.TTS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb'; }
  isConfigured() { return Boolean(this.provider && this.apiKey); }
  async synthesize(text) {
    if (!this.isConfigured()) throw new Error('Text-to-speech provider is not configured');
    if (this.provider.toLowerCase() !== 'elevenlabs') throw new Error(`Unsupported TTS provider: ${this.provider}. Add a provider adapter in services/speech/textToSpeech.js.`);
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.voiceId)}?output_format=ulaw_8000`, { method: 'POST', headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, model_id: process.env.TTS_MODEL || 'eleven_multilingual_v2' }) });
    if (!response.ok) throw new Error(`TTS provider returned ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
}

module.exports = TextToSpeechProvider;
