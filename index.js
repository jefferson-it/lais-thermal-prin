import { config } from "dotenv";
import { io } from "socket.io-client";
import { printOrder } from "./printOrder.js";
import path from "path";
import player from "node-wav-player";

config();

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
        name: process.env.LABEL_NAME,
        mode: process.env.MODE_SECTOR
    });
}

socket.on("connect", () => {
    console.log("connected:", socket.id);
    register();
});

socket.on("disconnect", (reason) => {
    console.log("disconnect:", reason);
});

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

socket.on("test-alarm", async () => {
    console.log("Received test-alarm event");

    try {
        await player.play({
            path: path.resolve("./new-order.wav")
        });
    } catch (err) {
        console.log("Erro ao tocar áudio:", err.message);
    }
});

socket.on("print-order", async (payload) => {
    if (payload.id !== socket.id) return;

    try {
        await printOrder(payload.order);

        socket.emit("order-printed", {
            orderId: payload.order.id
        });
    } catch (err) {
        console.error(err);
    }
});

setInterval(() => {
    socket.emit("printer-ping");
}, 10000);

process.on("uncaughtException", (err) => {
    console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
    console.error("UNHANDLED REJECTION:", reason);
});