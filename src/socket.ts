import * as WebSocket from "ws";

import * as ha from "home-assistant-js-websocket";

/**
 * Create a web socket connection with a Home Assistant instance.
 */

export const ERR_CANNOT_CONNECT = 1;
export const ERR_INVALID_AUTH = 2;
export const ERR_CONNECTION_LOST = 3;
export const ERR_HASS_HOST_REQUIRED = 4;

const DEBUG = false;

const MSG_TYPE_AUTH_REQUIRED = "auth_required";
const MSG_TYPE_AUTH_INVALID = "auth_invalid";
const MSG_TYPE_AUTH_OK = "auth_ok";

type Constructor<T> = {
    new (...args: unknown[]): T;
  };

export declare type ConnectionOptions = {
    setupRetry: number;
    auth?: ha.Auth;
    createSocket: (options: ConnectionOptions) => Promise<WebSocket>;
    WebSocket?: Constructor<WebSocket>;
    webSocketClientOptions: any
};

export function createSocket(options: ConnectionOptions): Promise<WebSocket> {
    if (!options.auth) {
        throw ERR_HASS_HOST_REQUIRED;
      }
      const auth = options.auth;
      const wsConstructor = options.WebSocket || WebSocket;
    

    // Start refreshing expired tokens even before the WS connection is open.
    // We know that we will need auth anyway.
    let authRefreshTask = auth.expired
        ? auth.refreshAccessToken().then(
            () => {
                authRefreshTask = undefined;
            },
            () => {
                authRefreshTask = undefined;
            }
        )
        : undefined;

    // Convert from http:// -> ws://, https:// -> wss://
    const url = auth.wsUrl;

    if (DEBUG) {
        console.log("[Auth phase] Initializing", url);
    }

    function connect(
        triesLeft: number,
        promResolve: (socket: WebSocket) => void,
        promReject: (err: number) => void
    ) {
        if (DEBUG) {
            console.log("[Auth Phase] New connection", url);
        }

        // @ts-ignore
        const socket = new wsConstructor(url, options.webSocketClientOptions);

        // If invalid auth, we will not try to reconnect.
        let invalidAuth = false;

        const closeMessage = (mess: {
            wasClean: boolean; code: number;
            reason: string; target: WebSocket
        }) => {
            // If we are in error handler make sure close handler doesn't also fire.
            socket.removeEventListener("close", closeMessage);
            if (invalidAuth) {
                promReject(ERR_INVALID_AUTH);
                return;
            }

            // Reject if we no longer have to retry
            if (triesLeft === 0) {
                // We never were connected and will not retry
                promReject(ERR_CANNOT_CONNECT);
                return;
            }

            const newTries = triesLeft === -1 ? -1 : triesLeft - 1;
            // Try again in a second
            setTimeout(
                () =>
                    connect(
                        newTries,
                        promResolve,
                        promReject
                    ),
                1000
            );
        };

        const errMessage = (event?: { data: any; type: string; target: WebSocket, error: Error }) => {
            // If we are in error handler make sure close handler doesn't also fire.
            socket.removeEventListener("close", closeMessage);
            if (invalidAuth) {
                promReject(ERR_INVALID_AUTH);
                return;
            }
            
            if (event && event.error){
                console.error("[Auth phase] ", event.error);
                promReject(1);
                return;
            }
            // Reject if we no longer have to retry
            if (triesLeft === 0) {
                // We never were connected and will not retry
                promReject(ERR_CANNOT_CONNECT);
                return;
            }

            const newTries = triesLeft === -1 ? -1 : triesLeft - 1;
            // Try again in a second
            setTimeout(
                () =>
                    connect(
                        newTries,
                        promResolve,
                        promReject
                    ),
                1000
            );
        };

        // Auth is mandatory, so we can send the auth message right away.
        const handleOpen = async (event: { target: WebSocket }) => {
            try {
                if (auth.expired) {
                    await (authRefreshTask ? authRefreshTask : auth.refreshAccessToken());
                }
                socket.send(JSON.stringify({
                    type: "auth",
                    access_token: auth.accessToken
                }));
            } catch (err) {
                // Refresh token failed
                invalidAuth = err === ERR_INVALID_AUTH;
                socket.close();
            }
        };

        const handleMessage = async (event: { data: any; type: string; target: WebSocket }) => {
            const message = JSON.parse(event.data);

            if (DEBUG) {
                console.log("[Auth phase] Received", message);
            }
            switch (message.type) {
                case MSG_TYPE_AUTH_INVALID:
                    invalidAuth = true;
                    socket.close();
                    break;

                case MSG_TYPE_AUTH_OK:
                    socket.removeEventListener("open", handleOpen);
                    socket.removeEventListener("message", handleMessage);
                    socket.removeEventListener("close", closeMessage);
                    socket.removeEventListener("error", errMessage);
                    promResolve(socket);
                    break;

                default:
                    if (DEBUG) {
                        // We already send this message when socket opens
                        if (message.type !== MSG_TYPE_AUTH_REQUIRED) {
                            console.warn("[Auth phase] Unhandled message", message);
                        }
                    }
            }
        };

        socket.addEventListener("open", handleOpen);
        socket.addEventListener("message", handleMessage);
        socket.addEventListener("close", closeMessage);
        socket.addEventListener("error", errMessage);
    }

    return new Promise((resolve, reject) =>
        connect(
            1,
            resolve,
            reject
        )
    );
}
