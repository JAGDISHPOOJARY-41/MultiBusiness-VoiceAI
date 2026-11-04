import { FormEvent, useState } from 'react';
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import * as I from 'lucide-react';
import { auth } from './config/firebase';

type Mode = 'login' | 'signup' | 'forgot' | 'onboarding';

const onboardingSteps = ['Welcome', 'Business name', 'Business type', 'Location', 'Timezone', 'Business hours', 'Assistant name', 'Language', 'Clinic workflow', 'Cake workflow', 'Finish'];

export default function AuthPage({ mode }: { mode: Mode }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [step, setStep] = useState(0);
  const [businessName, setBusinessName] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setMessage('');
    if (!auth) { setError('Firebase Auth is not configured. Add the VITE_FIREBASE_* values to frontend/.env.'); return; }
    try {
      if (mode === 'login') await signInWithEmailAndPassword(auth, email, password);
      else if (mode === 'signup') await createUserWithEmailAndPassword(auth, email, password);
      else await sendPasswordResetEmail(auth, email);
      if (mode === 'forgot') setMessage('Password reset instructions have been sent.'); else window.location.href = mode === 'signup' ? '/onboarding' : '/';
    } catch (authError: any) { setError(authError?.message || 'Authentication failed'); }
  };

  if (mode === 'onboarding') return <div className="auth-shell"><div className="auth-card onboarding-card"><div className="brand auth-brand"><div className="brand-mark"><I.Waves size={20}/></div><span>voxly<span className="brand-dot">.</span></span></div><div className="onboarding-progress"><span>Step {step + 1} of {onboardingSteps.length}</span><div><i style={{ width: `${((step + 1) / onboardingSteps.length) * 100}%` }}/></div></div><span className="eyebrow">ONBOARDING</span><h1>{onboardingSteps[step]}</h1>{step === 0 && <p>Let’s set up your AI assistant for the businesses you serve.</p>}{step === 1 && <input value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="Business name" autoFocus/>}{step > 1 && step < 10 && <><p>Configure this part of your Voxly workspace.</p><input placeholder={onboardingSteps[step]}/></>}{step === 10 && <p>Your workspace is ready. You can edit these settings later.</p>}<button className="btn auth-submit" onClick={() => step === onboardingSteps.length - 1 ? window.location.assign('/') : setStep(step + 1)}>{step === onboardingSteps.length - 1 ? 'Open workspace' : 'Continue'} <I.ArrowRight size={16}/></button></div></div>;

  const title = mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create your workspace' : 'Reset your password';
  return <div className="auth-shell"><div className="auth-card"><div className="brand auth-brand"><div className="brand-mark"><I.Waves size={20}/></div><span>voxly<span className="brand-dot">.</span></span></div><span className="eyebrow">{mode === 'signup' ? 'GET STARTED' : 'SECURE ACCESS'}</span><h1>{title}</h1><p>{mode === 'login' ? 'Sign in to manage your AI assistant.' : mode === 'signup' ? 'Build workflows for your clinic, shop, or local team.' : 'Enter your email and we’ll send a reset link.'}</p><form onSubmit={submit}>{<label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email"/></label>}{mode !== 'forgot' && <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}/></label>}{error && <div className="auth-error">{error}</div>}{message && <div className="auth-message">{message}</div>}<button className="btn auth-submit" type="submit">{mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'} <I.ArrowRight size={16}/></button></form><div className="auth-links">{mode === 'login' ? <><a href="/signup">Create an account</a><a href="/forgot-password">Forgot password?</a></> : <a href="/login">Back to sign in</a>}</div></div></div>;
}
