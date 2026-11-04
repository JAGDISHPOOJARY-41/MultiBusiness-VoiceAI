# Voxly architecture

The frontend is a mobile-first React/Vite single page application. Navigation is represented as a shared page model so the desktop sidebar and mobile bottom sheet stay consistent. The FastAPI API is the server-side boundary for workflow processing, Firebase Admin, server-side speech providers, and Google Calendar.

`/api/ai/chat` is the canonical workflow endpoint. Browser voice uses `MediaRecorder` and sends audio to `/api/voice/simulate`; FastAPI calls the configured server-side STT provider, merges the transcript into workflow state, executes confirmed actions, and returns the next response. `/api/voice/synthesize` keeps TTS credentials server-side. Telephone provider adapters remain available as an optional compatibility integration, but browser simulation does not require a phone number.
