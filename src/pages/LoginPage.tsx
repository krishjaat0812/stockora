import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn, ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../auth/api';
import { Button, Card, Field, InfoNote, TextInput } from '../components/ui';
import { Logo } from '../components/Logo';

export default function LoginPage() {
  const { status, login, landing } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = 'Sign in | Stockora | Smart Retail Inventory Assistant';
  }, []);

  if (status === 'loading') return null;
  if (status === 'authenticated') return <Navigate to={from ?? landing} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const errors: { email?: string; password?: string } = {};
    if (!email.trim()) errors.email = 'Enter your email address.';
    if (!password) errors.password = 'Enter your password.';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    setError(null);
    try {
      const payload = await login(email.trim(), password);
      navigate(from ?? payload.landing, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'missing_fields') {
        setError(err.message);
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Could not reach the server. Check your connection and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <div className="hidden flex-col justify-between bg-primary-dark px-10 py-10 text-white lg:flex xl:px-16">
        <Link to="/login" className="flex items-center gap-2.5" aria-label="Stockora">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="text-xl font-bold tracking-tight">Stockora</span>
        </Link>
        <div className="max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">
            Smart Retail Inventory Assistant
          </p>
          <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight xl:text-4xl">
            Smarter Stock. Less Waste. Better Decisions.
          </h1>
          <p className="mt-4 text-sm leading-6 text-white/75">
            Sign in to your shop workspace for inventory, expiry and reorder decisions — or to the
            administration panel to manage clients and feature access.
          </p>
          <ul className="mt-6 space-y-2.5 text-sm text-white/85">
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#79db8d]" aria-hidden="true" />
              Feature access is enforced by the server, per organisation.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#79db8d]" aria-hidden="true" />
              Passwords are hashed with PBKDF2-SHA-256; sessions use HttpOnly cookies.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#79db8d]" aria-hidden="true" />
              Every client organisation only ever sees its own data.
            </li>
          </ul>
        </div>
        <p className="text-xs text-white/50">
          Built for neighbourhood retailers, convenience stores and small supermarkets.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex min-h-screen flex-col justify-center px-4 py-10 sm:px-8">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 flex items-center justify-between lg:hidden">
            <Logo />
          </div>

          <Card className="p-6 sm:p-8">
            <div className="mb-6">
              <h2 className="text-xl font-bold tracking-tight text-ink">Sign in</h2>
              <p className="mt-1 text-sm text-muted">
                Use the account your administrator created for you.
              </p>
            </div>

            {error ? (
              <div className="mb-4 rounded-xl border border-crit/25 bg-crit-soft px-4 py-3 text-sm font-medium text-[#7F1D1D]" role="alert">
                {error}
              </div>
            ) : null}

            <form onSubmit={submit} noValidate className="space-y-4">
              <Field label="Email address" htmlFor="login-email" error={fieldErrors.email} required>
                <TextInput
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  value={email}
                  invalid={Boolean(fieldErrors.email)}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@shop.com"
                />
              </Field>

              <Field label="Password" htmlFor="login-password" error={fieldErrors.password} required>
                <div className="relative">
                  <TextInput
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    invalid={Boolean(fieldErrors.password)}
                    onChange={(event) => setPassword(event.target.value)}
                    className="pr-11"
                    placeholder="Your password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
              </Field>

              <div className="flex items-center justify-between gap-3 pt-1">
                <Link
                  to="/forgot-password"
                  className="text-sm font-semibold text-primary-dark hover:underline"
                >
                  Forgot password?
                </Link>
                <Button type="submit" loading={submitting} icon={<LogIn className="h-4 w-4" aria-hidden="true" />}>
                  Sign in
                </Button>
              </div>
            </form>

            {import.meta.env.DEV ? (
              <div className="mt-6 border-t border-line pt-4">
                <InfoNote tone="info">
                  <span className="font-semibold">Development accounts:</span> administrator{' '}
                  <code className="font-mono text-[11px]">admin@stockora.dev</code> /{' '}
                  <code className="font-mono text-[11px]">StockoraAdmin!2026</code>, shop owner{' '}
                  <code className="font-mono text-[11px]">owner@freshmart.dev</code> /{' '}
                  <code className="font-mono text-[11px]">StockoraShop!2026</code>. These seed
                  credentials exist for local demo only and are documented in the README.
                </InfoNote>
              </div>
            ) : null}
          </Card>

          <p className="mt-6 text-center text-xs text-muted">
            Stockora · Smarter stock, less waste, better decisions.
          </p>
        </div>
      </div>
    </div>
  );
}
