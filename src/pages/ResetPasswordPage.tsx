import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { ApiError, apiPost } from '../auth/api';
import { Button, Card, Field, InfoNote, TextInput } from '../components/ui';
import { Logo } from '../components/Logo';

/** Choose-a-new-password screen for a single-use reset link. */
export default function ResetPasswordPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = 'Choose a new password | Stockora';
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const errors: { password?: string; confirm?: string } = {};
    if (!password) errors.password = 'Enter a new password.';
    else if (password !== confirm) errors.confirm = 'Passwords do not match.';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    setError(null);
    try {
      await apiPost('/api/auth/reset', { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset the password. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-center bg-canvas px-4 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <Card className="p-6 sm:p-8">
          {done ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-ok-soft text-primary-dark">
                <KeyRound className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="text-xl font-bold tracking-tight text-ink">Password updated</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Your password was changed and all existing sessions were signed out. Use the new
                password to sign in.
              </p>
              <Button className="mt-6 w-full" onClick={() => navigate('/login', { replace: true })}>
                Go to sign in
              </Button>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-bold tracking-tight text-ink">Choose a new password</h2>
              <p className="mt-1 text-sm text-muted">
                This link can be used once. After saving, every other session is signed out.
              </p>
              {error ? (
                <div className="mt-4 rounded-xl border border-crit/25 bg-crit-soft px-4 py-3 text-sm font-medium text-[#7F1D1D]" role="alert">
                  {error}
                </div>
              ) : null}
              <form onSubmit={submit} noValidate className="mt-6 space-y-4">
                <Field
                  label="New password"
                  htmlFor="reset-password"
                  error={fieldErrors.password}
                  hint="Use a long passphrase — at least 12 characters."
                  required
                >
                  <div className="relative">
                    <TextInput
                      id="reset-password"
                      type={show ? 'text' : 'password'}
                      autoComplete="new-password"
                      autoFocus
                      value={password}
                      invalid={Boolean(fieldErrors.password)}
                      onChange={(event) => setPassword(event.target.value)}
                      className="pr-11"
                    />
                    <button
                      type="button"
                      onClick={() => setShow((value) => !value)}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md px-2 py-1.5 text-xs font-semibold text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      aria-label={show ? 'Hide password' : 'Show password'}
                    >
                      {show ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </Field>
                <Field label="Confirm new password" htmlFor="reset-confirm" error={fieldErrors.confirm} required>
                  <TextInput
                    id="reset-confirm"
                    type={show ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirm}
                    invalid={Boolean(fieldErrors.confirm)}
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                </Field>
                <InfoNote tone="info">
                  Stockora’s policy is length-based so passphrases work naturally: minimum 12
                  characters, no forced symbol rules, paste supported.
                </InfoNote>
                <Button type="submit" loading={submitting} className="w-full">
                  Save new password
                </Button>
              </form>
            </>
          )}
        </Card>
        <p className="mt-6 text-center text-sm">
          <Link to="/login" className="inline-flex items-center gap-1.5 font-semibold text-primary-dark hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
