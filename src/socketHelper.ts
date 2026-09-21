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
    if (!socket) return;

    const payload = {
        ...basePayload(),
        message,
        meta: meta ?? null,
    };

    try {
        // socket.io bufferiza se desconectado — tenta enviar de qualquer forma
        // Evento solicitado com a grafia original (mantém compatibilidade com server legado)
        (socket as any).emit("debug-mensage", payload);
        // Grafia correta em inglês para novos servers
        (socket as any).emit("debug-message", payload);
        if (!socket.connected) {
            // eslint-disable-next-line no-console
            console.warn(`[socketHelper] emitDebug enviado com socket desconectado (será bufferizado): ${message}`);
        }
    } catch {
        // nunca quebrar o fluxo por falha de emit
    }
}

/**
 * Envia erro para o servidor via evento "send-error".
 */
export function emitError(error: unknown, context?: string, meta?: unknown): void {
    const socket = activeSocket;
    if (!socket) return;

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
        (socket as any).emit("send-error", payload);
        if (!socket.connected) {
            // eslint-disable-next-line no-console
            console.warn(`[socketHelper] emitError enviado com socket desconectado (bufferizado) context=${context}: ${err.message.slice(0, 120)}`);
        }
    } catch {
        // nunca quebrar o fluxo por falha de emit
    }
    // Fallback extra: tenta também via socket direto se helper falhar por qualquer motivo
    try {
        if ((socket as any)?.io && !(socket as any).connected) {
            // força emit via manager se possível
            (socket as any).emit("send-error", payload);
        }
    } catch {}
}
