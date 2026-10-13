import { useEffect } from 'react';
import { ToastHost } from './design/components';
import { LockScreen } from './features/lock/LockScreen';
import { Shell } from './features/shell/Shell';
import { watchViewport, useUi, wireUnauthorized } from './state/ui';
import { useSession, watchActivity, watchUnload } from './state/session';
import { assertCrypto } from './lib/crypto';

export const App = () => {
  const phase = useSession((s) => s.phase);
  const boot = useSession((s) => s.boot);
  const lock = useSession((s) => s.lock);
  const setBootError = useUi((s) => s.setBootError);
  const bootError = useUi((s) => s.bootError);
  const t = useUi((s) => s.t);

  useEffect(() => {
    const cleanups = [watchViewport(), watchActivity(), watchUnload(), wireUnauthorized(() => void lock('expired'))];
    void (async () => {
      try {
        assertCrypto();
      } catch (err) {
        setBootError(err instanceof Error ? err.message : t('errors.cryptoUnsupported'));
        return;
      }
      await boot();
      // A cloud provider may have redirected back here after OAuth.
      handleOAuthReturn();
    })();
    return () => cleanups.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (bootError) {
    return (
      <>
        <div className="nimbus-backdrop" />
        <div className="lock-root">
          <div className="lock-card">
            <h1 className="lock-heading">{t('errors.cryptoUnsupported')}</h1>
            <p className="lock-sub">{bootError}</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="nimbus-backdrop" aria-hidden />
      <div className="nimbus-grain" aria-hidden />
      {phase === 'unlocked' ? <Shell /> : <LockScreen />}
      <ToastHost />
    </>
  );
};

/** Surface `?cloud=connected&provider=…` left by the OAuth callback redirect. */
function handleOAuthReturn(): void {
  const params = new URLSearchParams(window.location.search);
  const state = params.get('cloud');
  if (!state) return;
  const provider = params.get('provider') ?? '';
  const reason = params.get('reason') ?? '';
  const { toast, t } = useUi.getState();
  if (state === 'connected') toast(`${provider} — ${t('cloud.connected')}`, 'success');
  else if (state === 'denied') toast(t('cloud.connectFailed', { reason: reason || 'refusé' }), 'warn');
  else toast(t('cloud.connectFailed', { reason: reason || state }), 'danger');
  window.history.replaceState({}, '', window.location.pathname);
}
