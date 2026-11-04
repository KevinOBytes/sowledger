import { build } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";

// The component and installed Datadog serializer/privacy/configuration are real.
// Only the SDK's network/lifecycle entrypoint is replaced to capture the options
// supplied by DatadogInit. No substitute implements masking or serialization.
export async function buildApiKeyReplayFixture() {
  const root = process.cwd();
  const result = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, loader: "tsx", contents: `
import { createRoot } from 'react-dom/client';
import DevelopersPage from './app/(app)/settings/developers/page';
import DatadogInit from './components/DatadogInit';
import { validateAndBuildRumConfiguration } from './node_modules/@datadog/browser-rum-core/esm/domain/configuration/configuration.js';
import { serializeNode } from './node_modules/@datadog/browser-rum/esm/domain/record/serialization/serializeNode.js';
import { serializeInTransaction } from './node_modules/@datadog/browser-rum/esm/domain/record/serialization/serializationTransaction.js';
import { createRecordingScope } from './node_modules/@datadog/browser-rum/esm/domain/record/recordingScope.js';
import { createElementsScrollPositions } from './node_modules/@datadog/browser-rum/esm/domain/record/elementsScrollPositions.js';
import { initShadowRootsController } from './node_modules/@datadog/browser-rum/esm/domain/record/shadowRootsController.js';

window.apiKeyReplay = {
  ready: () => !!window.apiKeyReplayConfig,
  serialize(kind) {
    const configuration = validateAndBuildRumConfiguration(window.apiKeyReplayConfig);
    if (!configuration) throw Error('The real Datadog configuration validator rejected the application options');
    const shadows = initShadowRootsController(() => {}, () => {});
    const scope = createRecordingScope(configuration, createElementsScrollPositions(), shadows);
    let snapshot;
    // The installed SDK's 0/1 kinds are initial/subsequent full snapshots. A
    // fresh scope avoids assuming node IDs or duplicating privacy inheritance.
    serializeInTransaction(kind, () => {}, () => {}, scope, transaction => {
      snapshot = serializeNode(document.body, configuration.defaultPrivacyLevel, transaction);
    });
    shadows.stop();
    if (!snapshot) throw Error('Installed Datadog serializer returned no snapshot');
    return JSON.stringify(snapshot);
  }
};
createRoot(document.getElementById('root')).render(<><DatadogInit/><DevelopersPage/></>);
` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "replay-privacy-external-boundaries", setup(builder) {
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "replay-fixture" }));
      builder.onResolve({ filter: /^@datadog\/browser-rum$/ }, () => ({ path: "datadog-entrypoint", namespace: "replay-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "replay-fixture" }, args => ({
        loader: "jsx", resolveDir: root,
        contents: args.path === "next-link"
          ? "export default function Link(props) { return <a {...props}/>; }"
          : `let configuration; export const datadogRum = {
              getInitConfiguration: () => configuration,
              init(value) { configuration = value; window.apiKeyReplayConfig = value; },
              setTrackingConsent() {}, startSessionReplayRecording() {}, stopSessionReplayRecording() {}
            };`,
      }));
      builder.onLoad({ filter: /components\/DatadogInit\.tsx$/ }, args => ({
        loader: "tsx", resolveDir: path.dirname(args.path),
        contents: `const replayFixtureEnv = { NODE_ENV: 'production', NEXT_PUBLIC_DATADOG_APPLICATION_ID: '11111111-1111-4111-8111-111111111111', NEXT_PUBLIC_DATADOG_CLIENT_TOKEN: 'synthetic-public-token', NEXT_PUBLIC_DATADOG_SITE: 'datadoghq.com' };\n${readFileSync(args.path, "utf8").replaceAll("process.env", "replayFixtureEnv")}`,
      }));
    } }],
  });
  return result.outputFiles[0].text;
}
