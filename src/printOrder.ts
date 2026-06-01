import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import moment from "moment";
import player from "node-wav-player";
import { OrderData } from "./types.js";

const execAsync = promisify(exec);

// Determine execution directory for binaries vs normal dev executions
const isPkg = (process as any).pkg !== undefined;
const appDir = isPkg ? path.dirname(process.execPath) : process.cwd();

/*
|--------------------------------------------------------------------------
| HELPERS & ESC/POS EMBEDDED COMMANDS
|--------------------------------------------------------------------------
*/

const sanitizeText = (text: any): string => {
    if (!text) return "";
    return String(text)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Removes common accents (á -> a, ç -> c)
        .replace(/[–—]/g, "-")           // Fixes invisible dashes
        .replace(/[^a-zA-Z0-9\s.,:#$%&*()_+\-=/]/g, ""); // Removes special chars that crash the printer buffer
};

const money = (value: number = 0): string =>
    Number(value).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL"
    }).replace(/\u00a0/g, " ")
        .replace("R$", "R$");

const line = (width: number = 48): string =>
    "=".repeat(width);

const center = (text: any, width: number = 48): string => {
    const sanitized = sanitizeText(text);
    const left = Math.floor((width - sanitized.length) / 2);
    return " ".repeat(Math.max(left, 0)) + sanitized;
};

const columns = (left: any, right: any, width: number = 48): string => {
    const sanitizedLeft = sanitizeText(left);
    const sanitizedRight = sanitizeText(right);
    const spaces = width - sanitizedLeft.length - sanitizedRight.length;
    return sanitizedLeft + " ".repeat(Math.max(spaces, 1)) + sanitizedRight;
};

const section = (title: string, lines: string[]): string => {
    return [
        "",
        title.toUpperCase(),
        line(),
        ...lines
    ].join("\r\n");
};

/*
|--------------------------------------------------------------------------
| PRINT
|--------------------------------------------------------------------------
*/

export async function printOrder(data: OrderData, socket?: any): Promise<boolean> {
    try {
        const {
            num,
            created_at,
            prods = [],
            withdraw,
            to_table,
            current_fare = 0,
            payType,
            returnTo,
            clientLoad,
            operatorLoad,
            observation,
            addressLoad,
            order
        } = data;

        let subtotal = 0;
        const output: string[] = [];

        /*
         |--------------------------------------------------------------------------
         | PRINTER INITIALIZATION (ESC/POS)
         |--------------------------------------------------------------------------
         */
        output.push("\x1b\x40"); // Initialize/clear the printer

        // Change character table to PC860 (Portuguese) or West Europe
        output.push("\x1b\x74\x03");

        /*
         |--------------------------------------------------------------------------
         | HEADER
         |--------------------------------------------------------------------------
         */
        const withdrawText = withdraw === "Mesa" && to_table 
            ? `MESA ${to_table.split("@").at(-1)}` 
            : sanitizeText(withdraw) || "";

        output.push(center(`PEDIDO #${num} - ${withdrawText}`));
        output.push(center(moment(created_at).format("DD/MM/YYYY [as] HH:mm")));

        if (order?.order_type) {
            output.push(center(order.order_type));
        }

        output.push(line());

        /*
         |--------------------------------------------------------------------------
         | PRODUCTS
         |--------------------------------------------------------------------------
         */
        const productLines: string[] = [];

        for (const item of prods) {
            if (item.removed) continue;

            const amount = Number(item.amount || 0);
            const price = Number(item.price || 0);
            const total = amount * price;
            subtotal += total;

            productLines.push(
                columns(
                    `${amount}x ${item.name}`,
                    money(total)
                )
            );

            if (item.codeRef) {
                productLines.push(sanitizeText(`Cod: ${item.codeRef}`));
            }

            if (item.obs) {
                productLines.push(sanitizeText(`Obs: ${item.obs}`));
            }

            productLines.push("");
        }

        output.push(section("Produtos", productLines));

        /*
         |--------------------------------------------------------------------------
         | PAYMENT
         |--------------------------------------------------------------------------
         */
        const total = subtotal + Number(current_fare || 0);
        const paymentLines: string[] = [];

        if (withdraw === "Entrega") {
            paymentLines.push(columns("Frete", money(current_fare)));
        }

        paymentLines.push(columns("TOTAL", money(total)));

        if (payType) {
            paymentLines.push(sanitizeText(`Pagamento: ${payType}`));
        }

        if (payType === "Dinheiro" && returnTo) {
            paymentLines.push(`Troco para: ${money(returnTo)}`);
        }

        output.push(section("Pagamento", paymentLines));

        /*
         |--------------------------------------------------------------------------
         | CLIENT / OPERATOR
         |--------------------------------------------------------------------------
         */
        if (clientLoad || operatorLoad || observation) {
            const clientLines: string[] = [];

            if (clientLoad) {
                clientLines.push(sanitizeText(`Nome: ${clientLoad.name || "Nao informado"}`));

                if (clientLoad.tel) {
                    clientLines.push(sanitizeText(`Telefone: ${clientLoad.tel}`));
                }
            }

            if (operatorLoad?.name) {
                clientLines.push(sanitizeText(`Atendente: ${operatorLoad.name}`));
            }

            if (observation) {
                clientLines.push(sanitizeText(`Obs: ${observation}`));
            }

            output.push(section("Cliente", clientLines));
        }

        /*
         |--------------------------------------------------------------------------
         | ADDRESS
         |--------------------------------------------------------------------------
         */
        if (withdraw === "Entrega" && addressLoad) {
            const addressLines: string[] = [];
            addressLines.push(sanitizeText(`${addressLoad.road || ""}, ${addressLoad.number || ""}`));

            if (addressLoad.complement) {
                addressLines.push(sanitizeText(addressLoad.complement));
            }

            addressLines.push(sanitizeText(`${addressLoad.neighborhood || ""}`));
            addressLines.push(sanitizeText(`${addressLoad.city || ""}`));

            output.push(section("Endereco", addressLines));
        }

        /*
         |--------------------------------------------------------------------------
         | FOOTER
         |--------------------------------------------------------------------------
         */
        output.push("");
        output.push(line());
        output.push("");
        output.push(center("OBRIGADO PELA PREFERENCIA!"));
        output.push(center("Lais Bolos"));

        output.push("\r\n\r\n\r\n\r\n");
        output.push("\x1d\x56\x41\x00"); // Cut command

        /*
         |--------------------------------------------------------------------------
         | SAVE & PRINT SEND
         |--------------------------------------------------------------------------
         */
        const filePath = path.join(appDir, "print.txt");

        // Write with latin1 encoding to match POS printers expectations
        fs.writeFileSync(filePath, output.join("\r\n"), "latin1");

        const printerName = process.env.PRINTER_NAME || "EPSON-PEDIDOS";
        console.log(`Sending to printer: ${printerName}...`);

        const command = `cmd.exe /c copy /b "${filePath}" "\\\\127.0.0.1\\${printerName}"`;
        await execAsync(command);

        const wavPath = path.join(appDir, "new-order.wav");
        player.play({
            path: wavPath,
        }).catch((err: any) => {
            console.log("Erro ao tocar áudio:", err.message);
        });

        console.log(`[PRINTED] Pedido #${num}`);
        return true;

    } catch (err) {
        console.error("[PRINT ERROR]", err);
        return false;
    }
}
