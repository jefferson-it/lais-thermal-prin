import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import moment from "moment";

const execAsync = promisify(exec);

/*
|--------------------------------------------------------------------------
| HELPERS & ESC/POS COMANDOS EMBUTIDOS
|--------------------------------------------------------------------------
*/

// Função para remover ou normalizar acentos antes de enviar para a impressora
const sanitizeText = (text) => {
    if (!text) return "";
    return String(text)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove acentos comuns (á -> a, ç -> c)
        .replace(/[–—]/g, "-")           // Corrige travessões invisíveis
        .replace(/[^a-zA-Z0-9\s.,:#$%&*()_+\-=/]/g, ""); // Remove caracteres especiais que travam o buffer
};

const money = (value = 0) =>
    Number(value).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL"
    }).replace(/\u00a0/g, " ")
        .replace("R$", "R$");

const line = (width = 48) =>
    "=".repeat(width);

const center = (text, width = 48) => {
    text = sanitizeText(text);
    const left = Math.floor((width - text.length) / 2);
    return " ".repeat(Math.max(left, 0)) + text;
};

const columns = (left, right, width = 48) => {
    left = sanitizeText(left);
    right = sanitizeText(right);
    const spaces = width - left.length - right.length;
    return left + " ".repeat(Math.max(spaces, 1)) + right;
};

const section = (title, lines) => {
    return [
        "",
        title.toUpperCase(),
        line(),
        ...lines.map(l => sanitizeText(l))
    ].join("\r\n");
};

/*
|--------------------------------------------------------------------------
| PRINT
|--------------------------------------------------------------------------
*/

export async function printOrder(data) {
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
            observation,
            addressLoad,
            order
        } = data;

        let subtotal = 0;
        const output = [];

        /*
         |--------------------------------------------------------------------------
         | INICIALIZAÇÃO DA IMPRESSORA (ESC/POS)
         |--------------------------------------------------------------------------
         */
        output.push("\x1b\x40"); // Inicializa/limpa a impressora

        // Altera a tabela de caracteres interna da impressora para PC860 (Português) ou West Europe
        // Se ainda sumir texto, altere o último byte para \x02 (PC850) ou \x03 (PC860)
        output.push("\x1b\x74\x03");

        /*
         |--------------------------------------------------------------------------
         | HEADER
         |--------------------------------------------------------------------------
         */
        output.push(center(`PEDIDO #${num} - ${withdraw === "Mesa" ? `MESA ${to_table?.split("@").at(-1)}` : sanitizeText(withdraw) || ''}`));
        output.push(center(moment(created_at).format("DD/MM/YYYY [as] HH:mm")));

        if (order?.order_type) {
            output.push(center(order.order_type));
        }

        output.push(line());

        /*
         |--------------------------------------------------------------------------
         | PRODUTOS
         |--------------------------------------------------------------------------
         */
        const productLines = [];

        for (const item of prods) {
            if (item.removed) continue;

            const amount = Number(item.amount || 0);
            const price = Number(item.price || 0);
            const total = amount * price;
            subtotal += total;

            productLines.push(`${amount}x ${item.name}`);

            if (item.codeRef) {
                productLines.push(`Cod: ${item.codeRef}`);
            }

            productLines.push(money(total));

            if (item.obs) {
                productLines.push(`Obs: ${item.obs}`);
            }

            productLines.push("");
        }

        output.push(section("Produtos", productLines));

        /*
         |--------------------------------------------------------------------------
         | PAGAMENTO
         |--------------------------------------------------------------------------
         */
        const total = subtotal + Number(current_fare || 0);
        const paymentLines = [];

        if (withdraw === "Entrega") {
            paymentLines.push(columns("Frete", money(current_fare)));
        }

        paymentLines.push(columns("TOTAL", money(total)));

        if (payType) {
            paymentLines.push(`Pagamento: ${payType}`);
        }

        if (payType === "Dinheiro" && returnTo) {
            paymentLines.push(`Troco para: ${money(returnTo)}`);
        }

        output.push(section("Pagamento", paymentLines));

        /*
         |--------------------------------------------------------------------------
         | CLIENTE
         |--------------------------------------------------------------------------
         */
        if (clientLoad) {
            const clientLines = [];
            clientLines.push(`Nome: ${clientLoad?.name || "Nao informado"}`);

            if (clientLoad?.tel) {
                clientLines.push(`Telefone: ${clientLoad.tel}`);
            }

            if (observation) {
                clientLines.push(`Obs: ${observation}`);
            }

            output.push(section("Cliente", clientLines));
        }

        /*
         |--------------------------------------------------------------------------
         | ENDERECO
         |--------------------------------------------------------------------------
         */
        if (withdraw === "Entrega" && addressLoad) {
            const addressLines = [];
            addressLines.push(`${addressLoad?.road || ""}, ${addressLoad?.number || ""}`);

            if (addressLoad?.complement) {
                addressLines.push(addressLoad.complement);
            }

            addressLines.push(`${addressLoad?.neighborhood || ""}`);
            addressLines.push(`${addressLoad?.city || ""}`);

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
        output.push("\x1d\x56\x41\x00"); // Comando de corte

        /*
         |--------------------------------------------------------------------------
         | SALVAMENTO E ENVIO
         |--------------------------------------------------------------------------
         */
        const filePath = path.resolve("./print.txt");

        // Salvando explicitamente tratado e sem quebras corrompidas
        fs.writeFileSync(filePath, output.join("\r\n"), "latin1");

        const printerName = process.env.PRINTER_NAME || "EPSON-PEDIDOS";
        console.log(`Sending to printer: ${printerName}...`);

        const command = `cmd.exe /c copy /b "${filePath}" "\\\\127.0.0.1\\${printerName}"`;
        await execAsync(command);

        console.log(`[PRINTED] Pedido #${num}`);
        return true;

    } catch (err) {
        console.error("[PRINT ERROR]", err);
        return false;
    }
}