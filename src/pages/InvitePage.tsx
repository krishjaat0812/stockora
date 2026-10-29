import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, UserPlus } from 'lucide-react';
import { ApiError, apiFetch, apiPost } from '../auth/api';
import { useAuth } from '../auth/AuthContext';
import { Button, Card, Field, InfoNote, Spinner, TextInput } from '../components/ui';
import { Logo } from '../components/Logo';

interface InviteInfo {
  email: string;
  displayName: string;
  organizationName: string | null;
  minLength: number;
}

/**
 * Account-setup screen for an administrator-issued invitation link. The
 * invited person chooses their own password; no administrator ever sees it.
 */
export default function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ displayName?: string; password?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = 'Set up your account | Stockora';
    let cancelled = false;
    apiFetch<InviteInfo>(`/api/auth/invite/${encodeURIComponent(token)}`)
      .then((payload) => {
        if (cancelled) return;
        setInfo(payload);
        setDisplayName(payload.displayName);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof ApiError ? err.message : 'This invitation link is invalid or has expired.');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const errors: typeof fieldErrors = {};
    if (!displayName.trim()) errors.displayName = 'Enter your name.';
    if (!password) errors.password = 'Choose a password.';
    else if (password !== confirm) errors.confirm = 'Passwords do not match.';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    setError(null);
    try {
      const payload = await apiPost<{ landing: string }>('/api/auth/invite/accept', {
        token,
        password,
        displayName: displayName.trim(),
      });
      // The accept endpoint set the session cookie; sync the client state.
      await refresh();
      navigate(payload.landing, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not set up the account. Try again.');
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
          {loadError ? (
            <div className="text-center">
              <h2 className="text-xl font-bold tracking-tight text-ink">Invitation unavailable</h2>
              <div className="mt-3 rounded-xl border border-crit/25 bg-crit-soft px-4 py-3 text-sm font-medium text-[#7F1D1D]" role="alert">
                {loadError}
              </div>
              <p className="mt-4 text-sm text-muted">
                Ask your administrator to send a new setup link.
              </p>
              <Link
                to="/login"
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-dark hover:underline"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to sign in
              </Link>
            </div>
          ) : !info ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted" role="status">
              <Spinner /> Checking your invitation…
            </div>
          ) : (
            <>
              <div className="mb-5">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft text-primary-dark">
                  <UserPlus className="h-5 w-5" aria-hidden="true" />
                </div>
                <h2 className="text-xl font-bold tracking-tight text-ink">Set up your account</h2>
                <p className="mt-1 text-sm text-muted">
                  {info.organizationName
                    ? `You were invited to join ${info.organizationName}.`
                    : 'You were invited to the Stockora administration panel.'}{' '}
                  Choose your own password — administrators never see it.
                </p>
              </div>

              {error ? (
                <div className="mb-4 rounded-xl border border-crit/25 bg-crit-soft px-4 py-3 text-sm font-medium text-[#7F1D1D]" role="alert">
                  {error}
                </div>
              ) : null}

              <form onSubmit={submit} noValidate className="space-y-4">
                <Field label="Email address" htmlFor="invite-email" required>
                  <TextInput id="invite-email" value={info.email} readOnly disabled />
                </Field>
                <Field label="Your name" htmlFor="invite-name" error={fieldErrors.displayName} required>
                  <TextInput
                    id="invite-name"
                    autoFocus
                    value={displayName}
                    invalid={Boolean(fieldErrors.displayName)}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="e.g. Priya Sharma"
                  />
                </Field>
                <Field
                  label="Password"
                  htmlFor="invite-password"
                  error={fieldErrors.password}
                  hint={`At least ${info.minLength} characters. A long passphrase works well.`}
                  required
                >
                  <TextInput
                    id="invite-password"
                    type={show ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    invalid={Boolean(fieldErrors.password)}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>
                <Field label="Confirm password" htmlFor="invite-confirm" error={fieldErrors.confirm} required>
                  <TextInput
                    id="invite-confirm"
                    type={show ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirm}
                    invalid={Boolean(fieldErrors.confirm)}
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                </Field>
                <div className="flex items-center justify-between gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setShow((value) => !value)}
                    className="text-sm font-semibold text-primary-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {show ? 'Hide passwords' : 'Show passwords'}
                  </button>
                  <Button type="submit" loading={submitting}>
                    Create account &amp; sign in
                  </Button>
                </div>
              </form>
              <div className="mt-5 border-t border-line pt-4">
                <InfoNote tone="info">
                  This setup link expires 14 days after it was issued and can only be used once.
                </InfoNote>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
