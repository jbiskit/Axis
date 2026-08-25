import { AppShell } from "./components/AppShell";
import { IntuneWorkspace } from "./components/IntuneWorkspace";
import { LoginScreen } from "./components/LoginScreen";
import { PopoutView } from "./components/PopoutView";
import { UpdateDialog } from "./components/UpdateDialog";
import { useDevices } from "./hooks/useDevices";
import { useHashRoute } from "./hooks/useHashRoute";
import { useSession } from "./hooks/useSession";
import { useUpdater } from "./hooks/useUpdater";
import { isPopoutRoute } from "./lib/popout";

export default function App() {
  const session = useSession();
  const route = useHashRoute();
  const isPopout = isPopoutRoute(route.pathname);
  const updater = useUpdater(!isPopout);
  const devicesEnabled =
    session.signedIn &&
    !isPopout &&
    (route.pathname.startsWith("/intune/devices") || route.pathname === "/intune");
  const devices = useDevices(devicesEnabled, session.signedIn);

  const updateDialog = (
    <UpdateDialog
      phase={updater.phase}
      update={updater.update}
      progress={updater.progress}
      error={updater.error}
      busy={updater.busy}
      onLater={updater.dismiss}
      onDownload={() => void updater.startDownload()}
      onRelaunch={() => void updater.relaunch()}
    />
  );

  if (isPopout) {
    return (
      <div className="popout-shell">
        <header className="popout-titlebar">
          <span className="shell-mark">AX</span>
          <h1>Inspector</h1>
        </header>
        <main className="popout-main">
          {session.restoring ? (
            <p className="muted">Loading inspector…</p>
          ) : !session.signedIn ? (
            <p className="muted">No live session in this window. Sign in from the main Axis window, then pop out again.</p>
          ) : (
            <PopoutView kind={route.search.get("kind") ?? ""} id={route.search.get("id") ?? ""} />
          )}
        </main>
      </div>
    );
  }

  if (session.restoring) {
    return (
      <div className="login-screen">
        <div className="login-restore">
          <span className="shell-mark">AX</span>
          <p style={{ margin: 0 }}>Checking Windows Credential Manager for a saved Axis session…</p>
        </div>
        {updateDialog}
      </div>
    );
  }

  if (!session.signedIn) {
    return (
      <>
        <LoginScreen
          deviceCode={session.deviceCode}
          onLogin={session.login}
          onCancel={() => {
            void session.cancelLogin();
          }}
        />
        {updateDialog}
      </>
    );
  }

  return (
    <>
      <AppShell
        route={route}
        accountName={session.accountName}
        organizationName={session.glance?.organizationName ?? null}
        onSignOut={() => {
          window.location.hash = "/intune";
          void session.logout();
        }}
      >
        <IntuneWorkspace
          route={route}
          glance={session.glance}
          glanceLoading={session.glanceLoading}
          glanceError={session.glanceError}
          accountName={session.accountName}
          signedIn={session.signedIn}
          devices={devices.devices}
          devicesLoading={devices.loading}
          devicesError={devices.error}
          devicesTruncated={devices.truncated}
          devicesFetchedAt={devices.fetchedAt}
          onRefreshGlance={() => void session.reloadGlance()}
          onRefreshDevices={() => void devices.reload()}
        />
      </AppShell>
      {updateDialog}
    </>
  );
}
