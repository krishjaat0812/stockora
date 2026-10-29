import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { apiPost } from '../auth/api';
import { Button, Card, Field, InfoNote, TextInput } from '../components/ui';
import { Logo } from '../components/Logo';

/**
 * Forgot-password request. The response is deliberately generic so an
 * attacker cannot probe which addresses are registered; in local development
 * (DEV_LINKS on the Worker) the issued link is surfaced explicitly because no
 * email provider is configured — the page never claims an email was sent.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ message: string; devResetLink?: string } | null>(null);

  useEffect(() => {
    document.title = 'Reset password | Stockora';
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim()) {
      setError('Enter your email address.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiPost<{ message: string; devResetLink?: string }>('/api/auth/forgot', {
        email: email.trim(),
      });
      setResult(response);
    } catch (err) {
      setError((err as Error).message);
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
          {result ? (
            <div>
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-ok-soft text-primary-dark">
                <MailCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="text-xl font-bold tracking-tight text-ink">Check your inbox</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{result.message}</p>
              {result.devResetLink ? (
                <div className="mt-4">
                  <InfoNote tone="warn">
                    <span className="font-semibold">Development only:</span> no email provider is
                    configured, so the reset link is shown here instead of being emailed. The link
                    expires after a few minutes and works once.
                  </InfoNote>
                  <Link
                    to={new URL(result.devResetLink).pathname}
                    className="mt-3 inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark"
                  >
                    Open the reset link
                  </Link>
                </div>
              ) : null}
              <div className="mt-6">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-dark hover:underline"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to sign in
                </Link>
              </div>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-bold tracking-tight text-ink">Forgot your password?</h2>
              <p className="mt-1 text-sm text-muted">
                Enter your account email and we’ll issue a single-use reset link that expires
                shortly.
              </p>
              {error ? (
                <div className="mt-4 rounded-xl border border-crit/25 bg-crit-soft px-4 py-3 text-sm font-medium text-[#7F1D1D]" role="alert">
                  {error}
                </div>
              ) : null}
              <form onSubmit={submit} noValidate className="mt-6 space-y-4">
                <Field label="Email address" htmlFor="forgot-email" required>
                  <TextInput
                    id="forgot-email"
                    type="email"
                    autoFocus
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@shop.com"
                  />
                </Field>
                <Button type="submit" loading={submitting} className="w-full">
                  Send reset link
                </Button>
              </form>
            </>
          )}
        </Card>
        {!result ? (
          <p className="mt-6 text-center text-sm">
            <Link to="/login" className="inline-flex items-center gap-1.5 font-semibold text-primary-dark hover:underline">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to sign in
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
