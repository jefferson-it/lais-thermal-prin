import fs from "fs";
import path from "path";
import moment from "moment";

const isPkg = (process as any).pkg !== undefined;
const appDir = isPkg ? path.dirname(process.execPath) : process.cwd();
const logFilePath = path.join(appDir, "lais-thermal.log");

// Safe helper to convert arguments to string
function formatArgs(args: any[]): string {
    return args.map(arg => {
        if (arg instanceof Error) {
            return arg.stack || `${arg.name}: ${arg.message}`;
        }
        if (typeof arg === "object") {
            try {
                return JSON.stringify(arg, null, 2);
            } catch {
                return String(arg);
            }
        }
        return String(arg);
    }).join(" ");
}

// Preserve original console methods to prevent infinite recursion
const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn
};

function writeLog(level: string, message: any, ...args: any[]) {
    const timestamp = moment().format("YYYY-MM-DD HH:mm:ss");
    const content = formatArgs([message, ...args]);
    const logLine = `[${timestamp}] [${level}] ${content}\n`;

    // Write to original standard console stream
    if (level === "ERROR") {
        originalConsole.error(logLine.trim());
    } else if (level === "WARN") {
        originalConsole.warn(logLine.trim());
    } else {
        originalConsole.log(logLine.trim());
    }

    // Write/Append to log file
    try {
        fs.appendFileSync(logFilePath, logLine, "utf8");
    } catch (err) {
        originalConsole.error("Erro ao escrever no arquivo de log lais-thermal.log:", err);
    }
}

/**
 * Intercepts all console.log, console.warn, and console.error calls,
 * sending them to the log file as well as the standard output stream.
 */
export function setupLogger() {
    console.log = (message?: any, ...optionalParams: any[]) => {
        writeLog("INFO", message, ...optionalParams);
    };

    console.error = (message?: any, ...optionalParams: any[]) => {
        writeLog("ERROR", message, ...optionalParams);
    };

    console.warn = (message?: any, ...optionalParams: any[]) => {
        writeLog("WARN", message, ...optionalParams);
    };

    console.log("==================================================");
    console.log(`📝 Log de Eventos Ativado: ${logFilePath}`);
    console.log("==================================================");
}
