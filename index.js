import { config } from "dotenv";
import { io } from "socket.io-client";
import { printOrder } from "./printOrder.js";
import { promisify } from "util";
import { exec } from "child_process";
import path from "path";

config();
const execAsync = promisify(exec);

const socket = io(process.env.URI, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
    transports: ["websocket"]
});

function register() {
    socket.emit("register_printer", {
        name: process.env.LABEL_NAME
    });
}

socket.on("connect", () => {
    console.log("connected:", socket.id);
    register();
});

socket.on("disconnect", (reason) => {
    console.log("disconnect:", reason);
});

socket.on('test-alarm', () => {
    console.log('Received test-alarm event');

    try {
        const audioPath = path.resolve("./new-order.mp3");

        // Comando que funcionou no seu teste manual (com WindowStyle Hidden para não atrapalhar a tela)
        const soundCommand = `powershell -WindowStyle Hidden -Command "Add-Type -AssemblyName PresentationCore; $mediaPlayer = New-Object System.Windows.Media.MediaPlayer; $mediaPlayer.Open('${audioPath}'); Start-Sleep -s 1; $mediaPlayer.Play(); Start-Sleep -s 3"`;

        // Executa em background, sem await, para a Lais receber o feedback do pedido na hora
        execAsync(soundCommand).catch(e => console.log("Erro assíncrono no som:", e.message));

    } catch (soundErr) {
        console.log("Erro ao inicializar o som:", soundErr.message);
    }
})

socket.io.on("reconnect", (attempt) => {
    console.log("reconnected:", attempt);
    register();
});

socket.io.on("reconnect_attempt", () => {
    console.log("trying reconnect...");
});

socket.io.on("reconnect_error", (err) => {
    console.error("reconnect error:", err.message);
});

setInterval(() => {
    socket.emit("printer-ping");
}, 10000);

socket.on("print-order", async (payload) => {
    if (payload.id !== socket.id) return;

    try {
        await printOrder(payload.order);
    } catch (err) {
        console.error(err);
    }
});