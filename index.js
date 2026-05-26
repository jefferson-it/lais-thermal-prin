import { config } from "dotenv";
import { io } from "socket.io-client";
import { printOrder } from "./printOrder.js";

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

socket.on("print-order", async (payload) => {
    if (payload.id !== socket.id) return;

    try {
        await printOrder(payload.order);
    } catch (err) {
        console.error(err);
    }
});