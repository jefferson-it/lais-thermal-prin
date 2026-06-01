import fs from "fs";
import path from "path";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { config } from "dotenv";

/**
 * Ensures that the .env file exists.
 * If it doesn't, prompts the user for the necessary environment variables and writes the file.
 * Automatically loads the variables into process.env.
 */
export async function ensureEnv(): Promise<void> {
  // Let's resolve the .env path relative to the application's running directory.
  // When bundled as an executable with pkg, process.cwd() is standard,
  // but let's check for process.pkg and use the executable's folder.
  const isPkg = (process as any).pkg !== undefined;
  const appDir = isPkg ? path.dirname(process.execPath) : process.cwd();
  const envPath = path.join(appDir, ".env");

  if (fs.existsSync(envPath)) {
    // If it exists, just load it
    config({ path: envPath });
    return;
  }

  console.log("\n========================================================");
  console.log("   LAIS THERMAL - CONFIGURAÇÃO INICIAL (.env)");
  console.log("   Parece ser a primeira vez que você executa este app.");
  console.log("   Responda às perguntas abaixo para configurá-lo:");
  console.log("========================================================\n");

  const rl = readline.createInterface({ input, output });

  try {
    const uri = await rl.question("1. URL do Servidor Socket.io [http://localhost:5000]: ");
    const finalUri = uri.trim() || "http://localhost:5000";

    const labelName = await rl.question("2. Nome de Identificação do Painel [Cafeteria]: ");
    const finalLabelName = labelName.trim() || "Cafeteria";

    const modeSector = await rl.question("3. Setor correspondente [cafeteria]: ");
    const finalModeSector = modeSector.trim() || "cafeteria";

    const printerName = await rl.question("4. Nome de compartilhamento da Impressora [EPSON-PEDIDOS]: ");
    const finalPrinterName = printerName.trim() || "EPSON-PEDIDOS";

    const envContent = [
      `URI=${finalUri}`,
      `LABEL_NAME=${finalLabelName}`,
      `MODE_SECTOR=${finalModeSector}`,
      `PRINTER_NAME=${finalPrinterName}`
    ].join("\n") + "\n";

    fs.writeFileSync(envPath, envContent, "utf8");

    console.log("\n========================================================");
    console.log(`✅ Arquivo .env criado com sucesso em:`);
    console.log(`   ${envPath}`);
    console.log("========================================================\n");

    // Load the newly created file into process.env
    config({ path: envPath });

  } catch (error) {
    console.error("❌ Erro ao gerar o arquivo .env:", error);
    process.exit(1);
  } finally {
    rl.close();
  }
}
