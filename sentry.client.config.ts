import { readBrowserConsent, subscribeBrowserConsent } from "@/lib/browser-consent";

type BrowserSentry = typeof import("@sentry/nextjs");
type BrowserTransport = ReturnType<BrowserSentry["makeFetchTransport"]>;
type BrowserSpan = ReturnType<BrowserSentry["startInactiveSpan"]>;
type TraceOptions = Pick<Parameters<BrowserSentry["init"]>[0], "tracesSampleRate" | "tracesSampler">;
type ReplayMode = ReturnType<ReturnType<BrowserSentry["replayIntegration"]>["getRecordingMode"]>;
let sdk: BrowserSentry | undefined;
let loading: Promise<void> | undefined;
let initialized = false;
let active = false;
let unavailable = false;
let replayStopped = false;
let sampledReplayMode: ReplayMode;
let stopping: Promise<void> | undefined;
const LIFETIME_ATTRIBUTE = "sowledger.consent_lifetime";
const recordingSpans = new Set<BrowserSpan>();
let consentLifetime = 0;
let acceptedTracing: TraceOptions | undefined;

const maySend = () => active && !unavailable && readBrowserConsent();

function deny() {
  // Fence all retained transport callbacks before asynchronous replay shutdown.
  if (active) consentLifetime++;
  active = false;
  if (!sdk) return;
  try {
    const client = sdk.getClient();
    if (!client) return;
    const options = client.getOptions();
    options.enabled = false;
    // Both must be undefined: rate 0/a root sampler alone does not prevent
    // children inheriting an already-sampled parent's decision.
    options.tracesSampleRate = undefined;
    options.tracesSampler = undefined;
    for (const scope of [sdk.getGlobalScope(), sdk.getIsolationScope(), sdk.getCurrentScope()]) scope.clearBreadcrumbs();
    for (const span of [...recordingSpans]) {
      try { span.end(); } catch { unavailable = true; }
    }
    recordingSpans.clear();
    if (replayStopped || stopping) return;
    const replay = sdk.getReplay();
    sampledReplayMode = replay?.getRecordingMode();
    replayStopped = true;
    if (!replay) return;
    // Ordinary stop()/close() flushes. Withdrawal must discard the final segment.
    stopping = Promise.resolve(replay.stop({ flush: false })).then(() => {
      stopping = undefined;
      if (readBrowserConsent()) reconcile();
    }).catch(() => {
      stopping = undefined;
      unavailable = true;
    });
  } catch {
    unavailable = true;
  }
}

function validParent(span: BrowserSpan): boolean {
  if (!sdk) return false;
  const root = sdk.getRootSpan(span);
  return root.isRecording() && sdk.spanToJSON(root).data[LIFETIME_ATTRIBUTE] === consentLifetime;
}

function requestMayRecord(): boolean {
  try {
    if (!maySend()) {
      // A raw cookie change can precede the shared observer's next notification.
      if (active && !readBrowserConsent()) deny();
      return false;
    }
    const parent = sdk?.getActiveSpan();
    return !parent || validParent(parent);
  } catch {
    unavailable = true;
    deny();
    return false;
  }
}

function enable() {
  if (!sdk || unavailable || active || stopping || !readBrowserConsent()) return;
  const browserSdk = sdk;
  try {
    if (initialized) {
      const client = browserSdk.getClient();
      if (!client) { unavailable = true; return; }
      if (acceptedTracing) Object.assign(client.getOptions(), acceptedTracing);
      active = true;
      client.getOptions().enabled = true;
      if (replayStopped) {
        const replay = browserSdk.getReplay();
        // Resume only the mode already selected by SDK sampling. A blanket
        // replay.start() would turn every re-acceptance into full-session capture.
        if (sampledReplayMode === "session") replay?.start();
        else if (sampledReplayMode === "buffer") replay?.startBuffering();
        replayStopped = false;
      }
      return;
    }

    const nativeFetch = window.fetch.bind(window);
    const consentFetch: typeof window.fetch = (input, init) => maySend()
      ? nativeFetch(input, init)
      : Promise.resolve(new Response(null, { status: 204 }));
    const lifetimeIntegration: Parameters<BrowserSentry["addIntegration"]>[0] = {
      name: "SOWLedgerConsentLifetime",
      setup(client) {
        const options = client.getOptions();
        acceptedTracing = { tracesSampleRate: options.tracesSampleRate, tracesSampler: options.tracesSampler };
        // Integration setup precedes default BrowserTracing.afterAllSetup, so
        // even the initial automatic root gets a consent lifetime.
        client.on("spanStart", span => {
          try {
            if (!maySend()) {
              if (active && !readBrowserConsent()) deny();
              span.end();
              return;
            }
            const root = browserSdk.getRootSpan(span);
            if (root === span) span.setAttribute(LIFETIME_ATTRIBUTE, consentLifetime);
            else if (!validParent(span)) { span.end(); return; }
            if (span.isRecording()) recordingSpans.add(span);
          } catch {
            unavailable = true;
            deny();
            try { span.end(); } catch { /* Keep all send fences denied. */ }
          }
        });
        client.on("spanEnd", span => { recordingSpans.delete(span); });
      },
    };
    active = true;
    browserSdk.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1,
      debug: false,
      replaysOnErrorSampleRate: 1.0,
      replaysSessionSampleRate: process.env.NODE_ENV === "production" ? 0.02 : 0.1,
      beforeBreadcrumb: breadcrumb => {
        if (maySend()) return breadcrumb;
        if (active && !readBrowserConsent()) deny();
        return null;
      },
      beforeSend: event => maySend() ? event : null,
      beforeSendTransaction: event => maySend() && event.contexts?.trace?.data?.[LIFETIME_ATTRIBUTE] === consentLifetime ? event : null,
      transport: (options: Parameters<BrowserSentry["makeFetchTransport"]>[0]): BrowserTransport => {
        const transport = browserSdk.makeFetchTransport(options, consentFetch);
        return {
          // This object is created once and retained by Sentry. Read current
          // consent on every send, including replay/non-error envelopes.
          send: envelope => maySend() ? transport.send(envelope) : Promise.resolve({}),
          flush: timeout => transport.flush(timeout),
        };
      },
      integrations: [
        browserSdk.browserTracingIntegration({ shouldCreateSpanForRequest: requestMayRecord }),
        browserSdk.replayIntegration({ maskAllText: true, blockAllMedia: true }),
        lifetimeIntegration,
      ],
    });
    initialized = true;
    if (!readBrowserConsent()) deny();
  } catch {
    unavailable = true;
    active = false;
    // Initialization may have installed a client before failing. Keep it denied.
    initialized = true;
    deny();
  }
}

function reconcile() {
  if (!readBrowserConsent()) { deny(); return; }
  if (unavailable) return;
  if (sdk) { enable(); return; }
  // Shared, failure-contained import: no retry on every focus/fallback tick.
  loading ??= import("@sentry/nextjs").then(module => {
    sdk = module;
    enable();
  }).catch(() => { unavailable = true; });
}

if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_SENTRY_DSN) {
  // This browser configuration lives for the page lifetime, including bfcache
  // restores; unlike a mounted UI component its observer must survive navigation.
  subscribeBrowserConsent(reconcile);
  reconcile();
}
