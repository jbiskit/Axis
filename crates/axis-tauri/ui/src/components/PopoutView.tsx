import { DeviceDetailView } from "./DeviceDetailView";
import { GraphObjectInspector } from "./workbench/GraphObjectInspector";

export function PopoutView({ kind, id }: { kind: string; id: string }) {
  if (!kind || !id) {
    return <p className="muted">This popout is missing an object kind or id.</p>;
  }
  if (kind === "device") {
    return <DeviceDetailView deviceId={id} popout onClose={() => undefined} />;
  }
  return (
    <GraphObjectInspector
      kind={kind}
      id={id}
      incomplete="Popout inspector. Script bodies can be edited here when you are in Admin mode."
      popout
      onClose={() => undefined}
    />
  );
}
