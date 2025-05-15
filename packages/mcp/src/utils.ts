import { execSync } from "child_process";

export function getVersion(executablePath: string) {
    try {
        const output = execSync(`${executablePath} --version`, { encoding: "utf-8" });
        const versionMatch = output.match(/\d+\.\d+\.\d+/);
        if (versionMatch) {
            return versionMatch[0];
        } else {
            throw new Error("Failed to extract version from output");
        }
    } catch (error) {
        throw new Error("Failed to get version");
    }
}
