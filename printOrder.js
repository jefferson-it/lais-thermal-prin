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
        ...lines // Removido o sanitizeText daqui pois os helpers individuais já o fazem, evitando quebrar o alinhamento do columns()
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
            operatorLoad, // <--- Recebendo o operador aqui
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

            productLines.push(sanitizeText(`${amount}x ${item.name}`));

            if (item.codeRef) {
                productLines.push(sanitizeText(`Cod: ${item.codeRef}`));
            }

            productLines.push(money(total));

            if (item.obs) {
                productLines.push(sanitizeText(`Obs: ${item.obs}`));
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
            paymentLines.push(sanitizeText(`Pagamento: ${payType}`));
        }

        if (payType === "Dinheiro" && returnTo) {
            paymentLines.push(`Troco para: ${money(returnTo)}`);
        }

        output.push(section("Pagamento", paymentLines));

        /*
         |--------------------------------------------------------------------------
         | CLIENTE / ATENDENTE
         |--------------------------------------------------------------------------
         */
        if (clientLoad || operatorLoad) {
            const clientLines = [];

            if (clientLoad) {
                clientLines.push(sanitizeText(`Nome: ${clientLoad?.name || "Nao informado"}`));

                if (clientLoad?.tel) {
                    clientLines.push(sanitizeText(`Telefone: ${clientLoad.tel}`));
                }
            }

            // Adiciona a linha do atendente caso o operatorLoad exista
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
         | ENDERECO
         |--------------------------------------------------------------------------
         */
        if (withdraw === "Entrega" && addressLoad) {
            const addressLines = [];
            addressLines.push(sanitizeText(`${addressLoad?.road || ""}, ${addressLoad?.number || ""}`));

            if (addressLoad?.complement) {
                addressLines.push(sanitizeText(addressLoad.complement));
            }

            addressLines.push(sanitizeText(`${addressLoad?.neighborhood || ""}`));
            addressLines.push(sanitizeText(`${addressLoad?.city || ""}`));

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

        try {
            // Caminho absoluto para o seu arquivo mp3
            const audioPath = path.resolve("./new-order.mp3");

            // Comando PowerShell robusto para tocar MP3 em segundo plano sem travar o terminal
            const soundCommand = `powershell -WindowStyle Hidden -Command "$player = New-Object -ComObject MediaPlayer.MediaPlayer; $player.Open('${audioPath}'); Start-Sleep -s 3"`;

            // Executa o som sem dar "await" para não segurar a API/Impressão enquanto o som toca
            execAsync(soundCommand).catch(e => console.log("Erro assíncrono no som:", e.message));

        } catch (soundErr) {
            console.log("Erro ao inicializar o som:", soundErr.message);
        }

        console.log(`[PRINTED] Pedido #${num}`);
        return true;

    } catch (err) {
        console.error("[PRINT ERROR]", err);
        return false;
    }
}