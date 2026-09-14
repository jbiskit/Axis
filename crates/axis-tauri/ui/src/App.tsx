import { AppShell } from "./components/AppShell";
import { ContextSwapDialog } from "./components/ContextSwapDialog";
import { CreateClientContainerDialog } from "./components/CreateClientContainerDialog";
import { IntuneWorkspace } from "./components/IntuneWorkspace";
import { LoginScreen } from "./components/LoginScreen";
import { PopoutView } from "./components/PopoutView";
import { UnsavedLeaveGuard } from "./components/workbench/UnsavedLeaveGuard";
import { UpdateDialog } from "./components/UpdateDialog";
import { useClientContainer } from "./hooks/useClientContainer";
import { useDevices } from "./hooks/useDevices";
import { useHashRoute } from "./hooks/useHashRoute";
import { useSession } from "./hooks/useSession";
import { useUpdater } from "./hooks/useUpdater";
import { requestLeave } from "./lib/inspectorDrafts";
import { isPopoutRoute } from "./lib/popout";
import { clearShellBannerDismissals, ReadOnlyProvider } from "./lib/readOnly";

export default function App() {
  const session = useSession();
  const route = useHashRoute();
  const isPopout = isPopoutRoute(route.pathname);
  const updater = useUpdater(!isPopout);
  const client = useClientContainer(session.signedIn && !isPopout);
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
            <ReadOnlyProvider value={session.isReadOnly}>
              <PopoutView kind={route.search.get("kind") ?? ""} id={route.search.get("id") ?? ""} />
            </ReadOnlyProvider>
          )}
        </main>
        <UnsavedLeaveGuard />
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
          appVersion={updater.appVersion}
          autoCheck={updater.autoCheck}
          checkingForUpdate={updater.checking}
          updateStatus={updater.status}
          onAutoCheckChange={updater.setAutoCheck}
          onCheckForUpdate={() => void updater.checkNow()}
        />
        {updateDialog}
      </>
    );
  }

  return (
    <ReadOnlyProvider value={session.isReadOnly}>
      <AppShell
        route={route}
        accountName={session.accountName}
        organizationName={session.glance?.organizationName ?? null}
        mode={session.mode}
        readOnlyScopeExceedsRequest={session.readOnlyScopeExceedsRequest}
        exceededWriteScopes={session.exceededWriteScopes}
        appVersion={updater.appVersion}
        autoCheck={updater.autoCheck}
        checkingForUpdate={updater.checking}
        updateStatus={updater.status}
        onAutoCheckChange={updater.setAutoCheck}
        onCheckForUpdate={() => void updater.checkNow()}
        onSwapContext={() => void session.swapContext()}
        contextSwapBusy={session.contextSwapActive}
        clientContainer={client.status}
        clientContainerBusy={client.busy}
        onOpenClientContainer={() => void client.open()}
        onCreateClientContainer={() => void client.beginCreate()}
        onCloseClientContainer={() => void client.clear()}
        onExportClientSnapshot={() => void client.exportSnapshot()}
        onSnoozeClientStale={(days) => void client.snooze(days)}
        onCompareClientSnapshots={() => {
          window.location.hash = "/intune/client";
        }}
        onSignOut={() => {
          requestLeave(() => {
            clearShellBannerDismissals();
            window.location.hash = "/intune";
            void session.logout();
          });
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
          clientContainer={client.status}
          onRefreshClientContainer={() => void client.refresh()}
        />
      </AppShell>
      <UnsavedLeaveGuard />
      {session.contextSwapActive && session.deviceCode && session.contextSwapTargetMode ? (
        <ContextSwapDialog
          targetMode={session.contextSwapTargetMode}
          deviceCode={session.deviceCode}
          onCancel={() => void session.cancelLogin()}
        />
      ) : null}
      {client.createPath ? (
        <CreateClientContainerDialog
          folderPath={client.createPath}
          busy={client.busy}
          error={client.error}
          defaultName={session.glance?.organizationName}
          onCancel={client.cancelCreate}
          onCreate={(name, primaryDomain) => void client.finishCreate(name, primaryDomain)}
        />
      ) : null}
      {updateDialog}
    </ReadOnlyProvider>
  );
}
