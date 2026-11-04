import { useEffect, useState } from 'react';
import * as I from 'lucide-react';

const API = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

export default function CallbackSystemControl({ page }: { page: string }) {
  const [settings, setSettings] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (page !== 'home' && page !== 'settings') return;
    void fetch(`${API}/api/callback-settings`).then((response) => response.json()).then(setSettings).catch(() => setError('Callback settings unavailable'));
  }, [page]);

  if (page !== 'home' && page !== 'settings') return null;
  const update = async (patch: Record<string, unknown>) => {
    const next = { ...settings, ...patch };
    setSettings(next); setSaving(true); setError('');
    try {
      const response = await fetch(`${API}/api/callback-settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      if (!response.ok) throw new Error('Could not save callback settings');
      setSettings(await response.json());
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not save callback settings'); }
    finally { setSaving(false); }
  };
  if (!settings) return error ? <div className="callback-system-error"><I.AlertTriangle size={14}/>{error}</div> : null;
  return <section className="callback-system-control"><div><span className="eyebrow">AUTOMATION CONTROL</span><b>AI Callback System</b><small>{settings.enabled ? 'Missed-call automation is active.' : 'Paused; missed calls will still be logged.'}</small></div><label className="callback-toggle"><input type="checkbox" checked={Boolean(settings.enabled)} onChange={(event) => void update({ enabled: event.target.checked })}/><span>{settings.enabled ? 'ON' : 'OFF'}</span></label><select value={settings.mode} onChange={(event) => void update({ mode: event.target.value })}><option value="after_hours">After hours</option><option value="during_hours">During hours</option><option value="always">Always</option></select>{saving && <small>Saving...</small>}</section>;
}
