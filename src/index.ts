import { io, Socket } from "socket.io-client";
import { printOrder } from "./printOrder.js";
import path from "path";
import player from "node-wav-player";
import { ensureEnv } from "./envGenerator.js";
import { SocketPrintPayload } from "./types.js";
import { setupLogger } from "./logger.js";

const isPkg = (process as any).pkg !== undefined;
const appDir = isPkg ? path.dirname(process.execPath) : process.cwd();

// Inicializar gravação de logs em arquivo antes de qualquer ação
setupLogger();

/*
 * Estado global do app (para permitir reinício/quebra seguro)
 */
let socket: Socket | null = null;
let pingInterval: NodeJS.Timeout | null = null;
let shuttingDown = false;
let bootAttempt = 0;
let bootLoopActive = false;
let restartQueued = false;
let restartTimer: NodeJS.Timeout | null = null;

const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

// Backoff exponencial: 1s, 2s, 4s, 8s, 16s, ... até 30s (máx)
const backoffDelay = (attempt: number): number =>
    Math.min(1000 * 2 ** Math.min(attempt - 1, 5), 30000);

async function startApp(): Promise<void> {
    // 1. Garantir que as configurações de ambiente (.env) estejam carregadas ou geradas
    await ensureEnv();

    const uri = process.env.URI;
    const labelName = process.env.LABEL_NAME;
    const modeSector = process.env.MODE_SECTOR;
    const storeCode = process.env.STORE;

    if (!uri) {
        throw new Error("URI do Socket.io não está definida no .env");
    }

    if (!storeCode) {
        throw new Error("Código da loja (STORE) não está definido no .env");
    }

    console.log(`🔌 Conectando ao servidor Socket.io em: ${uri}...`);

    socket = io(uri, {
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
        transports: ["websocket"]
    });

    function register() {
        console.log(`📝 Registrando impressora: "${labelName}" | Setor: "${modeSector}" | Loja: "${storeCode}"`);
        socket?.emit("register_printer", {
            name: labelName,
            mode: modeSector,
            store: storeCode
        });
    }

    socket.on("connect", () => {
        console.log("✅ Conectado ao servidor! ID do Socket:", socket?.id);
        register();
    });

    socket.on("disconnect", (reason) => {
        console.log("⚠️ Desconectado do servidor. Motivo:", reason);
    });

    socket.on("connect_error", (err) => {
        const detail = err instanceof Error ? err.message : String(err);
        console.error("❌ Erro de conexão:", detail);
    });

    socket.io.on("reconnect", (attempt) => {
        console.log("♻️ Reconectado com sucesso! Tentativa:", attempt);
        register();
    });

    socket.io.on("reconnect_attempt", () => {
        console.log("🔄 Tentando reconectar ao servidor...");
    });

    socket.io.on("reconnect_error", (err) => {
        const detail = err instanceof Error ? err.message : String(err);
        console.error("❌ Erro na tentativa de reconexão:", detail);
    });

    socket.on("test-alarm", async (id: string) => {
        if (id !== socket?.id) return;
        console.log("🔔 Evento 'test-alarm' recebido! Reproduzindo som de teste...");
        try {
            const wavPath = path.join(appDir, "new-order.wav");

            await player.play({
                path: wavPath
            });
        } catch (err: any) {
            console.log("❌ Erro ao reproduzir som de teste:", err?.message ?? err);
        }
    });

    socket.on("print-order", async (payload: SocketPrintPayload) => {
        if (payload.id !== socket?.id) return;

        console.log(`📦 Novo pedido recebido para impressão. Pedido #${payload.order?.num}`);
        try {
            const success = await printOrder(payload.order, socket);

            if (success) {
                socket?.emit("order-printed", {
                    orderId: payload.order.num,
                    clientId: payload.clientId
                });
            }
        } catch (err) {
            console.error("❌ Erro inesperado no fluxo de impressão do pedido:", err);
        }
    });

    // Enviar ping periódico para manter a conexão ativa
    // (também mantém o event loop vivo, evitando que o processo "morra sozinho")
    pingInterval = setInterval(() => {
        socket?.emit("printer-ping");
    }, 10000);
}

/**
 * Loop de inicialização: se a configuração/arranque falhar,
 * espera com backoff e tenta de novo em vez de encerrar o processo.
 */
async function bootLoop(): Promise<void> {
    if (bootLoopActive) return;
    bootLoopActive = true;
    try {
        while (!shuttingDown) {
            bootAttempt++;
            try {
                await startApp();
                break; // arranque OK: app segue rodando (socket + ping mantêm o processo vivo)
            } catch (err) {
                const delay = backoffDelay(bootAttempt);
                console.error(`💥 Inicialização falhou (tentativa #${bootAttempt}). Reiniciando em ${delay / 1000}s...`, err);
                await sleep(delay);
            }
        }
    } finally {
        bootLoopActive = false;
    }
}

/**
 * Reinício automático após erro crítico (uncaughtException/unhandledRejection).
 * Limpa o estado atual e reconstrói a conexão, mantendo o processo de pé.
 */
function hardRestart(reason: unknown): void {
    if (shuttingDown || restartQueued || bootLoopActive) return;

    restartQueued = true;
    console.error("🔁 Reinício automático agendado após erro crítico.", reason);

    // Limpar estado anterior
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
    if (socket) {
        try {
            socket.removeAllListeners();
            socket.disconnect();
        } catch { /* ignore */ }
        socket = null;
    }

    const delay = backoffDelay(bootAttempt++);
    restartTimer = setTimeout(() => {
        restartQueued = false;
        restartTimer = null;
        bootLoop().catch((err) => {
            console.error("🔥 Falha no ciclo de reinício:", err);
        });
    }, delay);
}

process.on("uncaughtException", (err) => {
    console.error("🔥 EXCEÇÃO NÃO TRATADA (uncaughtException):", err);
    hardRestart(err);
});

process.on("unhandledRejection", (reason) => {
    console.error("🔥 REJEIÇÃO NÃO TRATADA (unhandledRejection):", reason);
    hardRestart(reason);
});

/**
 * Encerramento controlado via sinais do sistema.
 * O primeiro sinal encerra com segurança; um segundo sinal força a saída.
 */
function gracefulShutdown(signal: NodeJS.Signals): void {
    if (shuttingDown) {
        console.warn(`👋 Segundo sinal ${signal} recebido. Encerrando imediatamente.`);
        process.exit(1);
    }

    shuttingDown = true;
    console.log(`🛑 Recebido sinal ${signal}. Encerrando de forma segura...`);

    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
    if (socket) {
        try {
            socket.removeAllListeners();
            socket.disconnect();
        } catch { /* ignore */ }
        socket = null;
    }
    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }

    // Pequeno atraso para garantir que o(s) log(s) sejam gravados
    setTimeout(() => process.exit(0), 300);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// Sessão/terminal encerrado: em vez de morrer, apenas reconecta (útil para kiosk)
process.on("SIGHUP", () => {
    console.warn("🔁 Sinal SIGHUP recebido (sessão caiu). Reiniciando conexão...");
    hardRestart("SIGHUP");
});

bootLoop().catch((err) => {
    console.error("🔥 Erro fatal no ciclo inicial do aplicativo:", err);
    hardRestart(err);
});