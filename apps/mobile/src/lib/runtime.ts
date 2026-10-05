import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Socket from "effect/unstable/socket/Socket";

import { remoteHttpClientLayer } from "@t3tools/client-runtime/rpc";

import { cryptoLayer } from "../features/cloud/dpop";
import { managedRelayClientLayer } from "../features/cloud/managedRelayLayer";
import { resolveCloudPublicConfig } from "../features/cloud/publicConfig";
import { tracingLayer } from "../features/observability/tracing";
import * as Persistence from "../persistence/layer";
import { disposeOnFoundationReplace, type FoundationHotModule } from "./foundation-fast-refresh";
import { whenProtectedDataAvailable } from "./protectedData";

declare const module: { readonly hot?: FoundationHotModule } | undefined;

function configuredRelayUrl(): string {
  return resolveCloudPublicConfig().relay.url ?? "http://relay.invalid";
}

const httpClientLayer = remoteHttpClientLayer(fetch);

type RuntimeLayerSource =
  | ReturnType<typeof managedRelayClientLayer>
  | typeof Socket.layerWebSocketConstructorGlobal
  | typeof cryptoLayer
  | typeof httpClientLayer
  | typeof Persistence.layer
  | typeof tracingLayer;

const runtimeLayer = Layer.merge(
  managedRelayClientLayer(configuredRelayUrl()),
  Socket.layerWebSocketConstructorGlobal,
).pipe(
  Layer.provideMerge(cryptoLayer),
  Layer.provideMerge(httpClientLayer),
  Layer.provideMerge(tracingLayer.pipe(Layer.provide(httpClientLayer))),
  Layer.provideMerge(Persistence.layer),
  // These layers read the keychain and the database while they build, and a
  // failed build is kept for the life of the process.
  Layer.provide(Layer.effectDiscard(Effect.promise(whenProtectedDataAvailable))),
);

export const runtime: ManagedRuntime.ManagedRuntime<
  Layer.Success<RuntimeLayerSource>,
  Layer.Error<RuntimeLayerSource>
> = ManagedRuntime.make(runtimeLayer);

export const runtimeContextLayer: Layer.Layer<
  Layer.Success<RuntimeLayerSource>,
  Layer.Error<RuntimeLayerSource>
> = Layer.effectContext(runtime.contextEffect);

disposeOnFoundationReplace(typeof module === "undefined" ? undefined : module.hot, () =>
  runtime.dispose(),
);
