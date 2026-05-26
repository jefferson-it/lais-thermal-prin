import {
    printer as Printer,
    types
} from "node-thermal-printer";

import moment from "moment";

export async function printOrder(data) {
    const {
        num,
        created_at,
        prods,
        withdraw,
        to_table,
        current_fare,
        payType,
        returnTo,
        clientLoad,
        observation,
        addressLoad,
        order
    } = data;

    const printer = new Printer({
        type: types.EPSON,
        interface: "printer:EPSON TM-T20X Receipt",
        options: {
            timeout: 5000
        },
        characterSet: "SLOVENIA",
        removeSpecialCharacters: false,
        lineCharacter: "-"
    });

    printer.clear();

    // TÍTULO
    printer.alignCenter();
    printer.bold(true);
    printer.setTextDoubleHeight();
    printer.println(`PEDIDO #${num}`);
    printer.setTextNormal();

    printer.bold(false);
    printer.println(
        moment(created_at).format("DD/MM/YYYY [às] HH:mm")
    );

    printer.drawLine();

    // PRODUTOS
    printer.alignLeft();

    for (const item of prods) {
        if (item.removed) continue;

        printer.bold(true);

        printer.println(
            `${item.amount}x ${item.name}`
        );

        printer.bold(false);

        if (item.codeRef) {
            printer.println(`Cod: ${item.codeRef}`);
        }

        printer.rightLeft(
            "Valor:",
            `R$ ${(item.price * item.amount).toFixed(2)}`
        );

        if (item.obs) {
            printer.println(`Obs: ${item.obs}`);
        }

        printer.drawLine();
    }

    // ENTREGA / MESA
    printer.bold(true);

    if (withdraw === "Mesa") {
        printer.println(
            `Mesa ${to_table?.split("@").at(-1)}`
        );
    } else {
        printer.println(withdraw);
    }

    printer.bold(false);

    if (withdraw === "Entrega") {
        printer.rightLeft(
            "Frete:",
            `R$ ${(current_fare || 0).toFixed(2)}`
        );
    }

    // TOTAL
    const total = prods.reduce((acc, item) => {
        if (item.removed) return acc;

        return acc + (item.price * item.amount);
    }, current_fare || 0);

    printer.drawLine();

    printer.bold(true);

    printer.rightLeft(
        "TOTAL:",
        `R$ ${total.toFixed(2)}`
    );

    printer.bold(false);

    // PAGAMENTO
    if (!to_table && payType) {
        printer.println(`Pagamento: ${payType}`);
    }

    if (payType === "Dinheiro" && returnTo) {
        printer.println(
            `Troco para: R$ ${returnTo.toFixed(2)}`
        );
    }

    // CLIENTE
    if (clientLoad) {
        printer.drawLine();

        printer.bold(true);
        printer.println("CLIENTE");
        printer.bold(false);

        printer.println(
            `Nome: ${clientLoad.name || "Nao informado"}`
        );

        if (clientLoad.tel) {
            printer.println(
                `Tel: ${clientLoad.tel}`
            );
        }

        if (observation) {
            printer.println(
                `Obs: ${observation}`
            );
        }
    }

    // ENDEREÇO
    if (withdraw === "Entrega") {
        printer.drawLine();

        printer.bold(true);
        printer.println("ENDERECO");
        printer.bold(false);

        printer.println(
            `${addressLoad?.road || ""}, ${addressLoad?.number || ""}`
        );

        printer.println(
            `${addressLoad?.neighborhood || ""}`
        );

        printer.println(
            `${addressLoad?.city || ""}`
        );
    }

    printer.drawLine();

    printer.alignCenter();
    printer.println("Obrigado!");

    printer.cut();

    const ok = await printer.execute();

    console.log("printed:", ok);
}