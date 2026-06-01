import { io } from "socket.io-client";
import { printOrder } from "./printOrder.js";
import path from "path";
import player from "node-wav-player";
import { ensureEnv } from "./envGenerator.js";
import { SocketPrintPayload } from "./types.js";
import { setupLogger } from "./logger.js";

const isPkg = (process as any).pkg !== undefined;
const appDir = isPkg ? path.dirname(process.execPath) : process.cwd();

async function main() {
    // Inicializar gravação de logs em arquivo antes de qualquer ação
    setupLogger();

    // 1. Garantir que as configurações de ambiente (.env) estejam carregadas ou geradas
    await ensureEnv();

    const uri = process.env.URI;
    const labelName = process.env.LABEL_NAME;
    const modeSector = process.env.MODE_SECTOR;

    if (!uri) {
        console.error("❌ ERRO CRÍTICO: URI do Socket.io não está definida no .env");
        process.exit(1);
    }

    console.log(`🔌 Conectando ao servidor Socket.io em: ${uri}...`);

    const socket = io(uri, {
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
        transports: ["websocket"]
    });

    function register() {
        console.log(`📝 Registrando impressora: "${labelName}" | Setor: "${modeSector}"`);
        socket.emit("register_printer", {
            name: labelName,
            mode: modeSector
        });
    }

    socket.on("connect", () => {
        console.log("✅ Conectado ao servidor! ID do Socket:", socket.id);
        register();
    });

    socket.on("disconnect", (reason) => {
        console.log("⚠️ Desconectado do servidor. Motivo:", reason);
    });

    socket.io.on("reconnect", (attempt) => {
        console.log("♻️ Reconectado com sucesso! Tentativa:", attempt);
        register();
    });

    socket.io.on("reconnect_attempt", () => {
        console.log("🔄 Tentando reconectar ao servidor...");
    });

    socket.io.on("reconnect_error", (err) => {
        console.error("❌ Erro na tentativa de reconexão:", err.message);
    });

    socket.on("test-alarm", async () => {
        console.log("🔔 Evento 'test-alarm' recebido! Reproduzindo som de teste...");
        try {
            const wavPath = path.join(appDir, "new-order.wav");
            await player.play({
                path: wavPath
            });
        } catch (err: any) {
            console.log("❌ Erro ao reproduzir som de teste:", err.message);
        }
    });

    socket.on("print-order", async (payload: SocketPrintPayload) => {
        if (payload.id !== socket.id) return;

        console.log(`📦 Novo pedido recebido para impressão. Pedido #${payload.order?.num}`);
        try {
            const success = await printOrder(payload.order, socket);

            if (success) {
                socket.emit("order-printed", {
                    orderId: payload.order.num,
                    clientId: payload.clientId
                });
            }
        } catch (err) {
            console.error("❌ Erro inesperado no fluxo de impressão do pedido:", err);
        }
    });

    // Enviar ping periódico para manter a conexão ativa
    setInterval(() => {
        socket.emit("printer-ping");
    }, 10000);
}

process.on("uncaughtException", (err) => {
    console.error("🔥 EXCEÇÃO NÃO TRATADA (uncaughtException):", err);
});

process.on("unhandledRejection", (reason) => {
    console.error("🔥 REJEIÇÃO NÃO TRATADA (unhandledRejection):", reason);
});

main().catch(err => {
    console.error("🔥 Erro fatal ao iniciar o aplicativo:", err);
});
