import type { Socket } from "socket.io-client";

/**
 * Helper centralizado para envio de eventos de debug e erro via Socket.IO
 * mantendo referência ao socket ativo sem criar dependência circular.
 */

let activeSocket: Socket | null = null;

export function setSocket(socket: Socket | null): void {
    activeSocket = socket;
}

export function getSocket(): Socket | null {
    return activeSocket;
}

interface BasePayload {
    store?: string;
    printer?: string;
    mode?: string;
    socketId?: string;
    timestamp: string;
}

function basePayload(): BasePayload {
    return {
        store: process.env.STORE || undefined,
        printer: process.env.LABEL_NAME || undefined,
        mode: process.env.MODE_SECTOR || undefined,
        socketId: activeSocket?.id || undefined,
        timestamp: new Date().toISOString(),
    };
}

function toErrorPayload(error: unknown) {
    if (error instanceof Error) {
        return {
            message: error.message,
            name: error.name,
            stack: error.stack,
        };
    }
    if (typeof error === "string") {
        return { message: error, name: "Error", stack: undefined };
    }
    try {
        return { message: JSON.stringify(error), name: "Error", stack: undefined, raw: error };
    } catch {
        return { message: String(error), name: "Error", stack: undefined, raw: String(error) };
    }
}

/**
 * Envia mensagem de debug para o servidor via evento "debug-mensage".
 * Também emite "debug-message" (grafia correta) para compatibilidade.
 */
export function emitDebug(message: string, meta?: unknown): void {
    const socket = activeSocket;
    if (!socket?.connected) return;

    const payload = {
        ...basePayload(),
        message,
        meta: meta ?? null,
    };

    try {
        // Evento solicitado com a grafia original (mantém compatibilidade com server legado)
        socket.emit("debug-mensage", payload);
        // Grafia correta em inglês para novos servers
        socket.emit("debug-message", payload);
    } catch {
        // nunca quebrar o fluxo por falha de emit
    }
}

/**
 * Envia erro para o servidor via evento "send-error".
 */
export function emitError(error: unknown, context?: string, meta?: unknown): void {
    const socket = activeSocket;
    if (!socket?.connected) return;

    const err = toErrorPayload(error);

    const payload = {
        ...basePayload(),
        context: context || "unknown",
        error: err.message,
        name: err.name,
        stack: err.stack,
        meta: meta ?? null,
        raw: (err as any).raw ?? undefined,
    };

    try {
        socket.emit("send-error", payload);
    } catch {
        // nunca quebrar o fluxo por falha de emit
    }
}
