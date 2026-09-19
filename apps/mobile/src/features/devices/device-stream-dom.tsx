"use dom";

import type { DeviceHubAccess } from "@t3tools/client-runtime/device/hub-access";
import {
  createDeviceStreamClient,
  type DeviceStreamClient,
  type DeviceScreenSize,
  type DeviceHardwareButton,
  type DeviceStreamStatus,
} from "@t3tools/client-runtime/device/stream";
import type { DevicePlatform } from "@t3tools/contracts";
import { useDOMImperativeHandle, type DOMProps } from "expo/dom";
import { useEffect, useEffectEvent, useRef, useState, type Ref, type CSSProperties } from "react";

export interface DeviceStreamRef {
  home: () => void;
  back: () => void;
  appSwitcher: () => void;
  rotate: () => void;
}

/** The native client supplies stream tickets; media and gestures stay inside the WebView. */
interface DeviceStreamProps {
  readonly access: DeviceHubAccess;
  readonly platform: DevicePlatform;
  readonly deviceId: string;
  readonly colors: {
    readonly background: string;
    readonly foreground: string;
    readonly muted: string;
    readonly buttonBackground: string;
  };
  readonly ref?: Ref<DeviceStreamRef>;
  readonly dom?: DOMProps;
  readonly onUnauthorized: () => Promise<void>;
  readonly onInputConnected: (connected: boolean) => Promise<void>;
}

export default function DeviceStreamDOM({ ref, ...props }: DeviceStreamProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <DeviceStreamBody
      {...props}
      ref={ref ?? null}
      key={attempt}
      onRetry={() => setAttempt((attempt) => attempt + 1)}
    />
  );
}

function DeviceStreamBody({ ref, ...props }: DeviceStreamProps & { readonly onRetry: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clientRef = useRef<DeviceStreamClient | null>(null);
  const pointerId = useRef<number | null>(null);
  const [screen, setScreen] = useState<DeviceScreenSize | null>(null);
  const [status, setStatus] = useState<DeviceStreamStatus>("connecting");
  const [detail, setDetail] = useState<string | undefined>();
  const [mjpegUrl, setMjpegUrl] = useState<string | null>(null);
  const [inputConnected, setInputConnected] = useState(false);
  // Expo DOM recreates object props across the bridge, even when their contents are unchanged.
  const accessKey = JSON.stringify(props.access);
  const onUnauthorized = useEffectEvent(() => void props.onUnauthorized());
  const onInputConnected = useEffectEvent((connected: boolean) => {
    setInputConnected(connected);
    void props.onInputConnected(connected);
  });

  const pressButton = (button: DeviceHardwareButton) => clientRef.current?.pressButton(button);
  useDOMImperativeHandle(ref ?? null, () => ({
    home: () => pressButton("home"),
    back: () => pressButton("back"),
    appSwitcher: () => pressButton("appSwitcher"),
    rotate: () => clientRef.current?.rotate(),
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const client = createDeviceStreamClient(
      {
        access: JSON.parse(accessKey) as DeviceHubAccess,
        platform: props.platform,
        deviceId: props.deviceId,
        preferMjpeg: props.platform === "ios",
      },
      canvas,
      {
        onStatus: (status, detail) => {
          setStatus(status);
          setDetail(detail);
        },
        onScreen: setScreen,
        onMjpegFallback: setMjpegUrl,
        onUnauthorized,
        onInputConnected,
      },
    );
    clientRef.current = client;
    pointerId.current = null;
    setScreen(null);
    setMjpegUrl(null);
    onInputConnected(false);
    client.start();
    return () => {
      client.stop();
      clientRef.current = null;
      pointerId.current = null;
    };
  }, [accessKey, props.platform, props.deviceId]);

  const landscape =
    screen?.orientation === "landscape_left" || screen?.orientation === "landscape_right";
  const aspect = screen
    ? landscape
      ? Math.max(screen.width, screen.height) / Math.min(screen.width, screen.height)
      : Math.min(screen.width, screen.height) / Math.max(screen.width, screen.height)
    : 9 / 19.5;
  const rotation =
    props.platform === "ios" && screen && screen.width <= screen.height
      ? screen.orientation === "landscape_left"
        ? 90
        : screen.orientation === "landscape_right"
          ? -90
          : screen.orientation === "portrait_upside_down"
            ? 180
            : 0
      : 0;
  const sideways = Math.abs(rotation) === 90;
  const mediaStyle: CSSProperties = {
    position: "absolute",
    width: sideways ? `${100 / aspect}%` : "100%",
    height: sideways ? `${100 * aspect}%` : "100%",
    left: "50%",
    top: "50%",
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
    pointerEvents: "none",
  };
  const sendTouch = (
    event: React.PointerEvent<HTMLDivElement>,
    phase: "begin" | "move" | "end",
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    clientRef.current?.sendTouch(
      phase,
      Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    );
  };
  const endTouch = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    sendTouch(event, "end");
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: props.colors.background,
        color: props.colors.foreground,
        fontFamily: "system-ui",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          containerType: "size",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          role="application"
          aria-label={`${props.platform === "ios" ? "iOS Simulator" : "Android Emulator"} screen`}
          tabIndex={0}
          style={{
            position: "relative",
            width: `min(100cqw, ${aspect * 100}cqh)`,
            height: `min(100cqh, ${100 / aspect}cqw)`,
            touchAction: "none",
            userSelect: "none",
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
            outline: "none",
          }}
          onPointerDown={(event) => {
            if (!inputConnected || pointerId.current !== null) return;
            event.preventDefault();
            pointerId.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.focus();
            sendTouch(event, "begin");
          }}
          onPointerMove={(event) => {
            if (pointerId.current === event.pointerId) sendTouch(event, "move");
          }}
          onPointerUp={endTouch}
          onPointerCancel={endTouch}
          onLostPointerCapture={endTouch}
          onKeyDown={(event) => {
            event.preventDefault();
            clientRef.current?.sendKey(event.nativeEvent, "down");
          }}
          onKeyUp={(event) => clientRef.current?.sendKey(event.nativeEvent, "up")}
        >
          <canvas ref={canvasRef} style={{ ...mediaStyle, display: mjpegUrl ? "none" : "block" }} />
          {mjpegUrl ? (
            <img
              src={mjpegUrl}
              alt=""
              draggable={false}
              style={mediaStyle}
              onError={() => void props.onUnauthorized()}
            />
          ) : null}
        </div>
      </div>
      {status !== "streaming" ? (
        <div
          role="status"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: 24,
            textAlign: "center",
            background: props.colors.background,
          }}
        >
          <span>
            {status === "error" ? (detail ?? "Device stream failed.") : "Connecting to device..."}
          </span>
          {status === "error" ? (
            <button
              onClick={props.onRetry}
              style={{
                padding: "12px 24px",
                borderRadius: 20,
                border: 0,
                background: props.colors.buttonBackground,
                color: props.colors.foreground,
                font: "inherit",
              }}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : !inputConnected ? (
        <div
          role="status"
          style={{
            position: "absolute",
            bottom: 12,
            left: 0,
            right: 0,
            textAlign: "center",
            pointerEvents: "none",
            fontSize: 13,
            color: props.colors.muted,
            background: props.colors.background,
          }}
        >
          Reconnecting device controls...
        </div>
      ) : null}
    </div>
  );
}
