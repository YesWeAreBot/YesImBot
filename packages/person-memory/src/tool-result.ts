import * as core from "koishi-plugin-yesimbot";

// Older core versions may not expose the structured error helpers.
const errors: Partial<Pick<typeof core, "isAppError" | "toToolError">> = core;

export const personMemoryFailure = (error: unknown) => ({
    status: "error",
    error:
        typeof errors.isAppError === "function" && typeof errors.toToolError === "function" && errors.isAppError(error)
            ? errors.toToolError(error)
            : { name: "PersonMemoryError", message: error instanceof Error ? error.message : String(error) },
});
